import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { TransformResponseInterceptor } from './transform-response.interceptor';

describe('TransformResponseInterceptor', () => {
  let interceptor: TransformResponseInterceptor<unknown>;
  let reflector: Reflector;

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  const handlerReturning = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TransformResponseInterceptor(reflector);
  });

  it('wraps a plain payload into { success, data }', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(context, handlerReturning({ id: '1' })),
    );
    expect(result).toEqual({ success: true, data: { id: '1' } });
  });

  it('wraps arrays without treating them as envelope-shaped', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(context, handlerReturning([1, 2, 3])),
    );
    expect(result).toEqual({ success: true, data: [1, 2, 3] });
  });

  it('lifts meta from paginated results instead of double-nesting', async () => {
    const meta = { page: 1, limit: 20, total: 2, totalPages: 1 };
    const result = await lastValueFrom(
      interceptor.intercept(
        context,
        handlerReturning({ data: [{ id: '1' }, { id: '2' }], meta }),
      ),
    );
    expect(result).toEqual({
      success: true,
      data: [{ id: '1' }, { id: '2' }],
      meta,
    });
  });

  it('lifts message when handler returns { data, message }', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(
        context,
        handlerReturning({ data: null, message: 'Deleted' }),
      ),
    );
    expect(result).toEqual({ success: true, data: null, message: 'Deleted' });
  });

  it('normalizes undefined to data: null', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(context, handlerReturning(undefined)),
    );
    expect(result).toEqual({ success: true, data: null });
  });

  it('does not lift a payload that merely contains a data key among others', async () => {
    const payload = { data: 'x', other: 'y' };
    const result = await lastValueFrom(
      interceptor.intercept(context, handlerReturning(payload)),
    );
    expect(result).toEqual({ success: true, data: payload });
  });

  it('passes through untouched when @SkipEnvelope is set', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const payload = { status: 'ok', details: {} };
    const result = await lastValueFrom(
      interceptor.intercept(context, handlerReturning(payload)),
    );
    expect(result).toBe(payload);
  });
});
