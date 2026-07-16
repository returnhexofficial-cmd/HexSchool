import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SectionsService } from './sections.service';

describe('SectionsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };
  const classSix = { id: 'class-6', name: 'Class 6', numericLevel: 6 };
  const classNine = { id: 'class-9', name: 'Class 9', numericLevel: 9 };
  const science = { id: 'grp-sci', name: 'Science', applicableFromLevel: 9 };

  let sections: Record<string, jest.Mock>;
  let classes: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let shifts: Record<string, jest.Mock>;
  let groups: Record<string, jest.Mock>;
  let service: SectionsService;

  beforeEach(() => {
    sections = {
      paginateWithRelations: jest.fn(),
      findByIdentity: jest.fn().mockResolvedValue(null),
      findByIdOrFail: jest.fn(),
      create: jest
        .fn()
        .mockImplementation((data: object) =>
          Promise.resolve({ id: 'sec-new', ...data }),
        ),
      update: jest
        .fn()
        .mockImplementation((_id: string, data: object) =>
          Promise.resolve({ id: _id, ...data }),
        ),
      softDelete: jest.fn(),
    };
    classes = { findByIdOrFail: jest.fn().mockResolvedValue(classNine) };
    sessions = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 'sess' }) };
    shifts = { findByIdOrFail: jest.fn() };
    groups = { findByIdOrFail: jest.fn().mockResolvedValue(science) };
    service = new SectionsService(
      sections as never,
      classes as never,
      sessions as never,
      shifts as never,
      groups as never,
      { set: jest.fn() } as never,
    );
  });

  it('a group below its applicable level is rejected (BD: streams from 9)', async () => {
    classes.findByIdOrFail.mockResolvedValue(classSix);
    await expect(
      service.create(
        {
          classId: classSix.id,
          sessionId: 'sess',
          name: 'A',
          groupId: science.id,
        },
        actor,
      ),
    ).rejects.toThrow(/applies from class level 9/);
  });

  it('a group at/above its level is accepted', async () => {
    await expect(
      service.create(
        {
          classId: classNine.id,
          sessionId: 'sess',
          name: 'A',
          groupId: science.id,
        },
        actor,
      ),
    ).resolves.toMatchObject({ id: 'sec-new' });
  });

  it('identity duplicates → 409', async () => {
    sections.findByIdentity.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create(
        { classId: classNine.id, sessionId: 'sess', name: 'A' },
        actor,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('update re-checks identity excluding itself', async () => {
    sections.findByIdOrFail.mockResolvedValue({
      id: 'sec-1',
      classId: classNine.id,
      sessionId: 'sess',
      name: 'A',
      shiftId: null,
      groupId: null,
    });
    await service.update('sec-1', { name: 'B' }, actor);
    expect(sections.findByIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'B', excludeId: 'sec-1' }),
    );
  });

  it('update can clear the group with null', async () => {
    sections.findByIdOrFail.mockResolvedValue({
      id: 'sec-1',
      classId: classNine.id,
      sessionId: 'sess',
      name: 'A',
      shiftId: null,
      groupId: science.id,
    });
    await service.update('sec-1', { groupId: null }, actor);
    expect(groups.findByIdOrFail).not.toHaveBeenCalled();
    expect(sections.update).toHaveBeenCalledWith(
      'sec-1',
      expect.objectContaining({ groupId: null }),
    );
  });

  it('group-level violations on update are rejected too', async () => {
    sections.findByIdOrFail.mockResolvedValue({
      id: 'sec-1',
      classId: classSix.id,
      sessionId: 'sess',
      name: 'A',
      shiftId: null,
      groupId: null,
    });
    classes.findByIdOrFail.mockResolvedValue(classSix);
    await expect(
      service.update('sec-1', { groupId: science.id }, actor),
    ).rejects.toThrow(BadRequestException);
  });
});
