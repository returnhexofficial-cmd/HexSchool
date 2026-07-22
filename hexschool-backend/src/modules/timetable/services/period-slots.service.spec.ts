import { BadRequestException, ConflictException } from '@nestjs/common';
import { PeriodSlotType, UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PeriodSlotsService } from './period-slots.service';

/** A TIME(0) column round-trips as a 1970-01-01 Date. */
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

describe('PeriodSlotsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let slots: Record<string, jest.Mock>;
  let shifts: Record<string, jest.Mock>;
  let service: PeriodSlotsService;

  const existing = [
    {
      id: 'slot-1',
      shiftId: 'shift-1',
      name: 'Period 1',
      startTime: time('08:00'),
      endTime: time('08:45'),
      type: PeriodSlotType.CLASS,
      displayOrder: 1,
    },
    {
      id: 'slot-2',
      shiftId: 'shift-1',
      name: 'Tiffin',
      startTime: time('08:45'),
      endTime: time('09:05'),
      type: PeriodSlotType.BREAK,
      displayOrder: 2,
    },
  ];

  beforeEach(() => {
    slots = {
      findForShift: jest.fn().mockResolvedValue(existing),
      findById: jest.fn().mockResolvedValue(existing[0]),
      findByIdentity: jest.fn().mockResolvedValue(null),
      countEntries: jest.fn().mockResolvedValue(0),
      countAttendance: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'new-slot', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((id: string, data: object) =>
          Promise.resolve({ ...existing[0], ...data, id }),
        ),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    shifts = {
      findById: jest.fn().mockResolvedValue({
        id: 'shift-1',
        name: 'Morning',
        startTime: time('08:00'),
        endTime: time('13:00'),
      }),
    };
    service = new PeriodSlotsService(
      slots as never,
      shifts as never,
      { set: jest.fn() } as never,
    );
  });

  const dto = (overrides: object = {}) => ({
    shiftId: 'shift-1',
    name: 'Period 2',
    startTime: '09:05',
    endTime: '09:50',
    ...overrides,
  });

  it('creates a slot that fits the shift and the gaps', async () => {
    const created = await service.create(dto(), actor);
    expect(created.startTime).toBe('09:05');
    expect(created.endTime).toBe('09:50');
    // Appended after the highest existing position.
    expect(slots.create).toHaveBeenCalledWith(
      expect.objectContaining({ displayOrder: 3 }),
    );
  });

  it('rejects a slot that overlaps a sibling', async () => {
    await expect(
      service.create(dto({ startTime: '08:30', endTime: '09:15' }), actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(slots.create).not.toHaveBeenCalled();
  });

  it('accepts a slot flush against the previous one (half-open windows)', async () => {
    // Tiffin ends at 09:05 — a period starting exactly then is legal.
    await expect(
      service.create(dto({ startTime: '09:05', endTime: '09:50' }), actor),
    ).resolves.toMatchObject({ startTime: '09:05' });
  });

  it('rejects a slot running past the end of the shift', async () => {
    await expect(
      service.create(dto({ startTime: '12:40', endTime: '13:30' }), actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a slot starting before the shift opens', async () => {
    await expect(
      service.create(dto({ startTime: '07:30', endTime: '08:00' }), actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inverted time range', async () => {
    await expect(
      service.create(dto({ startTime: '10:00', endTime: '09:00' }), actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate name within the shift', async () => {
    slots.findByIdentity.mockImplementation((params: { name?: string }) =>
      Promise.resolve(params.name ? existing[0] : null),
    );
    await expect(
      service.create(dto({ name: 'Period 1' }), actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a position already taken in the shift', async () => {
    slots.findByIdentity.mockImplementation(
      (params: { displayOrder?: number }) =>
        Promise.resolve(params.displayOrder ? existing[1] : null),
    );
    await expect(
      service.create(dto({ displayOrder: 2 }), actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to move the times of a period that has attendance', async () => {
    slots.findForShift.mockResolvedValue([existing[1]]);
    slots.countAttendance.mockResolvedValue(31);
    await expect(
      service.update('slot-1', { startTime: '08:10' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(slots.update).not.toHaveBeenCalled();
  });

  it('allows renaming a period that has attendance (no history moves)', async () => {
    slots.findForShift.mockResolvedValue([existing[1]]);
    slots.countAttendance.mockResolvedValue(31);
    await expect(
      service.update('slot-1', { name: 'First period' }, actor),
    ).resolves.toMatchObject({ name: 'First period' });
  });

  it('blocks deleting a period still used by routine cells', async () => {
    slots.countEntries.mockResolvedValue(4);
    await expect(service.remove('slot-1', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(slots.softDelete).not.toHaveBeenCalled();
  });

  it('blocks deleting a period that backs attendance rows', async () => {
    slots.countAttendance.mockResolvedValue(9);
    await expect(service.remove('slot-1', actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('soft-deletes an unused period', async () => {
    await service.remove('slot-1', actor);
    expect(slots.softDelete).toHaveBeenCalledWith('slot-1');
  });
});
