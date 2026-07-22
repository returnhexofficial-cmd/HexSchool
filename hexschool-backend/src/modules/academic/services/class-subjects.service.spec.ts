import { BadRequestException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { ClassSubjectsService } from './class-subjects.service';

describe('ClassSubjectsService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };
  const classNine = { id: 'class-9', name: 'Class 9', numericLevel: 9 };
  const row = (subjectId: string, groupId?: string) => ({
    subjectId,
    ...(groupId ? { groupId } : {}),
  });

  let repo: Record<string, jest.Mock>;
  let classes: Record<string, jest.Mock>;
  let subjects: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let groups: Record<string, jest.Mock>;
  let service: ClassSubjectsService;

  beforeEach(() => {
    repo = {
      findForClassSession: jest.fn().mockResolvedValue([]),
      replaceForClassSession: jest.fn(),
    };
    classes = { findByIdOrFail: jest.fn().mockResolvedValue(classNine) };
    subjects = {
      findAll: jest
        .fn()
        .mockImplementation((where: { id: { in: string[] } }) =>
          Promise.resolve(where.id.in.map((id: string) => ({ id }))),
        ),
    };
    sessions = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 'sess' }) };
    groups = {
      findByIdOrFail: jest.fn().mockResolvedValue({
        id: 'grp',
        name: 'Science',
        applicableFromLevel: 9,
      }),
    };
    service = new ClassSubjectsService(
      repo as never,
      classes as never,
      subjects as never,
      sessions as never,
      groups as never,
      { set: jest.fn() } as never,
      // M15 marks guard — no marks by default; the removal-guard case
      // overrides it.
      { countForClassSubject: jest.fn().mockResolvedValue(0) } as never,
    );
  });

  it('rejects duplicate subject/group pairs in the payload', async () => {
    await expect(
      service.replaceForClass(
        classNine.id,
        { sessionId: 'sess', subjects: [row('sub-1'), row('sub-1')] },
        actor,
      ),
    ).rejects.toThrow(/Duplicate subject/);
  });

  it('same subject twice with different groups is allowed', async () => {
    await expect(
      service.replaceForClass(
        classNine.id,
        { sessionId: 'sess', subjects: [row('sub-1'), row('sub-1', 'grp')] },
        actor,
      ),
    ).resolves.toBeDefined();
  });

  it('rejects unknown subject ids', async () => {
    subjects.findAll.mockResolvedValue([{ id: 'sub-1' }]);
    await expect(
      service.replaceForClass(
        classNine.id,
        { sessionId: 'sess', subjects: [row('sub-1'), row('sub-missing')] },
        actor,
      ),
    ).rejects.toThrow(/sub-missing/);
  });

  it('rejects group rows below the applicable class level', async () => {
    classes.findByIdOrFail.mockResolvedValue({
      ...classNine,
      numericLevel: 6,
    });
    await expect(
      service.replaceForClass(
        classNine.id,
        { sessionId: 'sess', subjects: [row('sub-1', 'grp')] },
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('payload order becomes display order when omitted', async () => {
    await service.replaceForClass(
      classNine.id,
      { sessionId: 'sess', subjects: [row('sub-b'), row('sub-a')] },
      actor,
    );
    const [, rows] = repo.replaceForClassSession.mock.calls[0] as [
      unknown,
      Array<{ subjectId: string; displayOrder: number }>,
    ];
    expect(rows.map((r) => [r.subjectId, r.displayOrder])).toEqual([
      ['sub-b', 0],
      ['sub-a', 1],
    ]);
  });
});
