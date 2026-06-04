import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('estudiantes')
export class Student {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  codigo: string;

  @Column()
  nombre: string;

  @Column()
  apellido: string;
}
