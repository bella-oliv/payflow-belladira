import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StudentService } from './student.service';
import { CreateStudentDto } from '../../dtos/student/create-student.dto';

@ApiTags('Estudiantes')
@Controller('estudiantes')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un estudiante' })
  async create(@Body() createStudentDto: CreateStudentDto) {
    return this.studentService.create(createStudentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los estudiantes' })
  async findAll() {
    return this.studentService.findAll();
  }
}
