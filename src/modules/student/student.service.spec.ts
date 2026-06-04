import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentService } from './student.service';
import { Student } from '../../entities/student/student.entity';
import { CreateStudentDto } from '../../dtos/student/create-student.dto';
import { BadRequestException } from '@nestjs/common';

type MockRepository<T = any> = Partial<Record<keyof Repository<T>, jest.Mock>>;

const createMockRepository = <T = any>(): MockRepository<T> => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
});

describe('StudentService', () => {
  let studentService: StudentService;
  let studentRepository: MockRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentService,
        {
          provide: getRepositoryToken(Student),
          useValue: createMockRepository(),
        },
      ],
    }).compile();

    studentService = module.get<StudentService>(StudentService);
    studentRepository = module.get<MockRepository>(getRepositoryToken(Student));
  });

  it('should create a new student when the code does not exist', async () => {
    const createStudentDto: CreateStudentDto = {
      codigo: 'EST1001',
      nombre: 'María',
      apellido: 'Gómez',
    };

    studentRepository.findOne.mockResolvedValue(undefined);
    studentRepository.create.mockReturnValue(createStudentDto);
    studentRepository.save.mockResolvedValue({ id: 1, ...createStudentDto });

    const student = await studentService.create(createStudentDto);

    expect(studentRepository.findOne).toHaveBeenCalledWith({ where: { codigo: 'EST1001' } });
    expect(studentRepository.create).toHaveBeenCalledWith(createStudentDto);
    expect(studentRepository.save).toHaveBeenCalledWith(createStudentDto);
    expect(student).toEqual({ id: 1, ...createStudentDto });
  });

  it('should throw BadRequestException when the student code already exists', async () => {
    const createStudentDto: CreateStudentDto = {
      codigo: 'EST1002',
      nombre: 'Luis',
      apellido: 'Pérez',
    };

    studentRepository.findOne.mockResolvedValue({ id: 2, ...createStudentDto });

    await expect(studentService.create(createStudentDto)).rejects.toThrow(BadRequestException);
    expect(studentRepository.findOne).toHaveBeenCalledWith({ where: { codigo: 'EST1002' } });
    expect(studentRepository.create).not.toHaveBeenCalled();
    expect(studentRepository.save).not.toHaveBeenCalled();
  });

  it('should return all students', async () => {
    const students = [
      { id: 1, codigo: 'EST1001', nombre: 'Ana', apellido: 'Lopez' },
      { id: 2, codigo: 'EST1002', nombre: 'Pedro', apellido: 'Ruiz' },
    ];

    studentRepository.find.mockResolvedValue(students);

    const result = await studentService.findAll();

    expect(studentRepository.find).toHaveBeenCalled();
    expect(result).toEqual(students);
  });
});
