import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Logger,
  UseGuards,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConnectedUsersService } from './connected-users.service';
import { WsJwtGuard } from './ws-jwt.guard';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/notifications',
})
@UseGuards(WsJwtGuard)
export class NotificationsGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    @Inject(ConnectedUsersService)
    private readonly connectedUsersService: ConnectedUsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.cleanupInterval = setInterval(() => {
      this.checkExpiredTokens();
    }, 60000);

    this.logger.log(
      '⏰ Servidor WebSocket inicializado con chequeo de expiración JWT (cada 60 segundos)',
    );
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  // =========================
  // FIX CRÍTICO AQUÍ
  // =========================
  private checkExpiredTokens() {
    try {
      const sockets = this.server?.sockets?.sockets;

      if (!sockets) {
        this.logger.warn('No hay sockets activos para validar expiración');
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      let disconnectCount = 0;

      sockets.forEach((socket: Socket) => {
        const user = socket.data?.user;

        if (user?.exp && now >= user.exp) {
          this.logger.warn(
            `🔒 Sesión expirada usuario ${user.email || 'desconocido'} (ID: ${
              user.sub
            }) - Socket: ${socket.id}`,
          );

          socket.emit('session_expired', {
            message:
              'Tu sesión ha expirado. Por favor, inicia sesión nuevamente.',
          });

          socket.disconnect(true);
          disconnectCount++;
        }
      });

      if (disconnectCount > 0) {
        this.logger.log(
          `⏰ Sockets desconectados por expiración JWT: ${disconnectCount}`,
        );
      }
    } catch (error) {
      this.logger.error('Error al verificar expiración de tokens', error);
    }
  }

  handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.query?.token ||
        this.extractTokenFromSocket(client);

      if (!token) {
        this.logger.warn(`Conexión sin token. Socket: ${client.id}`);
        client.emit('connection_error', { message: 'Auth token missing' });
        client.disconnect(true);
        return;
      }

      const jwtSecret = this.configService.get<string>('JWT_SECRET');
      const decoded = this.jwtService.verify(token, { secret: jwtSecret });

      client.data.user = decoded;
      client.data.userId = decoded.sub;
      client.data.email = decoded.email;

      const userId = client.data.userId as number;
      const email = client.data.email as string;

      if (!userId) {
        this.logger.warn(`Token inválido sin userId. Socket: ${client.id}`);
        client.emit('connection_error', {
          message: 'Invalid token payload',
        });
        client.disconnect(true);
        return;
      }

      this.connectedUsersService.registerConnection(
        userId,
        client.id,
        email || 'unknown',
      );

      client.emit('connection_established', {
        ok: true,
        userId,
        socketId: client.id,
      });

      this.logger.log(
        `🔌 Usuario conectado: ${email} (${userId}) - Socket: ${client.id}`,
      );
    } catch (error) {
      this.logger.error('Error en handleConnection', error);
      client.emit('connection_error', { message: 'Auth error' });
      client.disconnect(true);
    }
  }

  private extractTokenFromSocket(client: Socket): string | undefined {
    const authHeader = client.handshake.headers
      ?.authorization as string | undefined;

    if (!authHeader) return undefined;

    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      return parts[1];
    }

    return undefined;
  }

  handleDisconnect(client: Socket) {
    try {
      const userId = client.data.userId;
      const email = client.data.email;

      const wasConnected =
        this.connectedUsersService.disconnectBySocket(client.id);

      if (wasConnected) {
        client.broadcast.emit('user_disconnected', {
          userId,
          email,
          disconnectedAt: new Date(),
          totalConnected:
            this.connectedUsersService.getTotalConnected(),
        });

        this.logger.log(
          `❌ Desconexión usuario ${email} (${userId}) - Socket: ${client.id}`,
        );
      }
    } catch (error) {
      this.logger.error('Error en handleDisconnect', error);
    }
  }

  // =========================
  // EVENTS
  // =========================

  @SubscribeMessage('ping')
  handlePing(client: Socket) {
    return {
      event: 'pong',
      data: `pong-${Date.now()}`,
    };
  }

  @SubscribeMessage('get_connection_status')
  handleGetConnectionStatus(client: Socket) {
    const userId = client.data.userId;
    const connectionInfo =
      this.connectedUsersService.getConnectionInfo(userId);

    return {
      event: 'connection_status',
      data: {
        userId,
        socketId: client.id,
        isConnected: true,
        connectedAt:
          connectionInfo?.connectedAt || new Date(),
      },
    };
  }

  // =========================
  // NOTIFICATIONS
  // =========================

  notifyTransferSent(fromUserId: number, transactionData: any) {
    const socketIds =
      this.connectedUsersService.getSocketIds(fromUserId);

    socketIds.forEach((socketId) => {
      this.server.to(socketId).emit('transfer_sent', {
        ...transactionData,
        message: 'Transferencia enviada exitosamente',
      });
    });
  }

  notifyTransferReceived(toUserId: number, transactionData: any) {
    const socketIds =
      this.connectedUsersService.getSocketIds(toUserId);

    socketIds.forEach((socketId) => {
      this.server.to(socketId).emit('transfer_received', {
        ...transactionData,
        message: '¡Has recibido una transferencia!',
      });
    });
  }

  sendNotificationToUser(userId: number, eventName: string, data: any) {
    const socketIds =
      this.connectedUsersService.getSocketIds(userId);

    if (!socketIds.length) {
      this.logger.warn(`USER NOT CONNECTED: ${userId}`);
      return;
    }

    socketIds.forEach((socketId) => {
      this.server.to(socketId).emit(eventName, data);
    });
  }

  isUserConnected(userId: number): boolean {
    return this.connectedUsersService.isConnected(userId);
  }
}