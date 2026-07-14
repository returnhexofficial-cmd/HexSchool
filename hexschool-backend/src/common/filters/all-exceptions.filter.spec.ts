import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter, ErrorEnvelope } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let statusMock: jest.Mock;
  let jsonMock: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({ method: 'GET', url: '/api/v1/test' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('shapes an HttpException into the error envelope', () => {
    filter.catch(new NotFoundException('Student not found'), host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Student not found' },
    });
  });

  it('maps class-validator failures to VALIDATION_ERROR with details', () => {
    filter.catch(
      new BadRequestException(['name must be a string', 'age must be an int']),
      host,
    );

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: ['name must be a string', 'age must be an int'],
      },
    });
  });

  it('keeps custom code/details from structured exception bodies', () => {
    filter.catch(
      new ConflictException({
        code: 'DUPLICATE_SECTION',
        message: 'Section A already exists',
        details: { classId: 'x' },
      }),
      host,
    );

    expect(statusMock).toHaveBeenCalledWith(409);
    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'DUPLICATE_SECTION',
        message: 'Section A already exists',
        details: { classId: 'x' },
      },
    });
  });

  it('hides internals of unknown exceptions behind an opaque 500', () => {
    filter.catch(new Error('connection string leaked secret'), host);

    expect(statusMock).toHaveBeenCalledWith(500);
    const body = (jsonMock.mock.calls[0] as [ErrorEnvelope])[0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
