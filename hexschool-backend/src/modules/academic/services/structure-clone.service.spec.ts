import { BadRequestException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StructureCloneService } from './structure-clone.service';

describe('StructureCloneService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };
  const from = { id: 'sess-a', name: '2026' };
  const to = { id: 'sess-b', name: '2027' };

  const section = (classId: string, name: string, shiftId: string | null) => ({
    classId,
    name,
    shiftId,
    groupId: null,
    capacity: 40,
    roomNo: null,
  });
  const map = (classId: string, subjectId: string) => ({
    classId,
    subjectId,
    groupId: null,
    isOptional: false,
    fullMarksDefault: 100,
    displayOrder: 0,
  });

  let sessions: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let classSubjects: Record<string, jest.Mock>;
  let txSectionCreate: jest.Mock;
  let txMapCreateMany: jest.Mock;
  let service: StructureCloneService;

  beforeEach(() => {
    sessions = {
      findByIdOrFail: jest
        .fn()
        .mockImplementation((id: string) =>
          Promise.resolve(id === from.id ? from : to),
        ),
    };
    txSectionCreate = jest.fn();
    txMapCreateMany = jest.fn();
    sections = {
      findForSession: jest.fn().mockResolvedValue([]),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<void>) =>
          fn({
            section: { create: txSectionCreate },
            classSubject: { createMany: txMapCreateMany },
          }),
        ),
    };
    classSubjects = { findForSession: jest.fn().mockResolvedValue([]) };
    service = new StructureCloneService(
      sessions as never,
      sections as never,
      classSubjects as never,
      { set: jest.fn() } as never,
    );
  });

  it('source and target must differ', async () => {
    await expect(
      service.clone({ fromSessionId: from.id, toSessionId: from.id }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  it('preview reports counts without writing', async () => {
    sections.findForSession.mockImplementation((_s: string, sid: string) =>
      Promise.resolve(
        sid === from.id
          ? [section('c1', 'A', null), section('c1', 'B', null)]
          : [],
      ),
    );
    classSubjects.findForSession.mockImplementation((_s: string, sid: string) =>
      Promise.resolve(sid === from.id ? [map('c1', 'sub-1')] : []),
    );

    const report = await service.clone(
      { fromSessionId: from.id, toSessionId: to.id, preview: true },
      actor,
    );
    expect(report).toMatchObject({
      preview: true,
      sections: { toCreate: 2, alreadyPresent: 0 },
      classSubjects: { toCreate: 1, alreadyPresent: 0 },
    });
    expect(sections.withTransaction).not.toHaveBeenCalled();
  });

  it('clone skips identities already present in the target (idempotent)', async () => {
    sections.findForSession.mockImplementation((_s: string, sid: string) =>
      Promise.resolve(
        sid === from.id
          ? [section('c1', 'A', null), section('c1', 'B', null)]
          : [section('c1', 'a', null)], // target already has "A" (case-insensitive)
      ),
    );
    classSubjects.findForSession.mockImplementation((_s: string, sid: string) =>
      Promise.resolve(
        sid === from.id
          ? [map('c1', 'sub-1'), map('c1', 'sub-2')]
          : [map('c1', 'sub-1')],
      ),
    );

    const report = await service.clone(
      { fromSessionId: from.id, toSessionId: to.id },
      actor,
    );
    expect(report.sections).toEqual({ toCreate: 1, alreadyPresent: 1 });
    expect(report.classSubjects).toEqual({ toCreate: 1, alreadyPresent: 1 });
    expect(txSectionCreate).toHaveBeenCalledTimes(1);
    const [{ data: created }] = txSectionCreate.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(created).toMatchObject({ name: 'B', sessionId: to.id });
    expect('classTeacherId' in created).toBe(false); // never copied
    expect(txMapCreateMany).toHaveBeenCalledTimes(1);
  });
});
