import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { AssignmentPolicyService } from './assignment-policy.service';

const SCHOOL = 'school-1';
const SLOT = {
  sessionId: 'session-1',
  sectionId: 'section-8b',
  subjectId: 'subject-physics',
};

const actorOf = (
  over: Partial<AccessTokenPayload> = {},
): AccessTokenPayload => ({
  sub: 'user-teacher',
  schoolId: SCHOOL,
  userType: UserType.TEACHER,
  ...over,
});

/** The one shape these tests read back off the `findMany` mock. */
interface FindManyArgs {
  where: {
    teacherId: string;
    schoolId: string;
    sessionId?: string;
  };
  select?: unknown;
}

interface Harness {
  service: AssignmentPolicyService;
  prisma: {
    teacher: { findFirst: jest.Mock };
    teacherSectionSubject: {
      findFirst: jest.Mock;
      findMany: jest.Mock<Promise<unknown[]>, [FindManyArgs]>;
    };
  };
  permissions: { getUserPermissionCodes: jest.Mock };
}

function harness(options: {
  teacherId?: string | null;
  codes?: string[];
  teaches?: boolean;
  slots?: Array<typeof SLOT>;
}): Harness {
  const prisma = {
    teacher: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.teacherId === null || options.teacherId === undefined
            ? null
            : { id: options.teacherId },
        ),
    },
    teacherSectionSubject: {
      findFirst: jest
        .fn()
        .mockResolvedValue(options.teaches ? { id: 'tss-1' } : null),
      // Typed so `.mock.calls` is inspectable without an `any` hop.
      findMany: jest
        .fn<Promise<unknown[]>, [FindManyArgs]>()
        .mockResolvedValue(options.slots ?? []),
    },
  };
  const permissions = {
    getUserPermissionCodes: jest.fn().mockResolvedValue(options.codes ?? []),
  };
  return {
    service: new AssignmentPolicyService(prisma as never, permissions as never),
    prisma,
    permissions,
  };
}

describe('AssignmentPolicyService.resolveActor', () => {
  it('finds the teacher behind the account', async () => {
    const { service } = harness({ teacherId: 'teacher-1' });
    await expect(service.resolveActor(actorOf())).resolves.toEqual({
      teacherId: 'teacher-1',
      seesAll: false,
    });
  });

  it('reports seesAll for a holder of assignment.all', async () => {
    const { service } = harness({
      teacherId: 'teacher-1',
      codes: ['assignment.all'],
    });
    const resolved = await service.resolveActor(actorOf());
    expect(resolved.seesAll).toBe(true);
  });

  it('gives a Super Admin seesAll without consulting the role grants', async () => {
    const { service, permissions } = harness({ teacherId: null });
    const resolved = await service.resolveActor(
      actorOf({ userType: UserType.SUPER_ADMIN }),
    );
    expect(resolved.seesAll).toBe(true);
    expect(permissions.getUserPermissionCodes).not.toHaveBeenCalled();
  });
});

describe('AssignmentPolicyService.assertMayActOn', () => {
  it('lets a teacher act on a slot they hold, and returns their id', async () => {
    const { service } = harness({ teacherId: 'teacher-1', teaches: true });
    await expect(service.assertMayActOn(actorOf(), SLOT)).resolves.toBe(
      'teacher-1',
    );
  });

  it('refuses a teacher who does not hold the slot', async () => {
    const { service } = harness({ teacherId: 'teacher-1', teaches: false });
    await expect(service.assertMayActOn(actorOf(), SLOT)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses an account with no teacher profile and no assignment.all', async () => {
    const { service } = harness({ teacherId: null, teaches: true });
    await expect(service.assertMayActOn(actorOf(), SLOT)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses a teacher naming somebody else as the author', async () => {
    const { service } = harness({ teacherId: 'teacher-1', teaches: true });
    await expect(
      service.assertMayActOn(actorOf(), SLOT, 'teacher-2'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets an assignment.all holder file on another teacher’s behalf', async () => {
    const { service, prisma } = harness({
      teacherId: 'teacher-1',
      codes: ['assignment.all'],
      teaches: false,
    });
    prisma.teacher.findFirst
      .mockResolvedValueOnce({ id: 'teacher-1' })
      .mockResolvedValueOnce({ id: 'teacher-9' });

    await expect(
      service.assertMayActOn(actorOf(), SLOT, 'teacher-9'),
    ).resolves.toBe('teacher-9');
    // The duty roster is never consulted for a holder of assignment.all.
    expect(prisma.teacherSectionSubject.findFirst).not.toHaveBeenCalled();
  });

  it('404s when an assignment.all holder names a teacher that does not exist', async () => {
    const { service, prisma } = harness({
      teacherId: 'teacher-1',
      codes: ['assignment.all'],
    });
    prisma.teacher.findFirst
      .mockResolvedValueOnce({ id: 'teacher-1' })
      .mockResolvedValueOnce(null);

    await expect(
      service.assertMayActOn(actorOf(), SLOT, 'ghost'),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s when an office account with assignment.all names nobody', async () => {
    const { service } = harness({
      teacherId: null,
      codes: ['assignment.all'],
    });
    await expect(service.assertMayActOn(actorOf(), SLOT)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('AssignmentPolicyService.assertMayTouch', () => {
  const existing = { ...SLOT, teacherId: 'teacher-1' };

  it('lets the current holder of the section-subject act', async () => {
    // The point of the whole design: the INCOMING teacher may mark, with
    // no data migration, because the roster is read live (roadmap §8).
    const { service } = harness({ teacherId: 'teacher-9', teaches: true });
    await expect(
      service.assertMayTouch(actorOf(), existing),
    ).resolves.toMatchObject({ teacherId: 'teacher-9' });
  });

  it('keeps the ORIGINAL author in, even after they lose the slot', async () => {
    // A teacher who set work on Monday and was reassigned on Tuesday must
    // still be able to read the marks they already gave.
    const { service, prisma } = harness({
      teacherId: 'teacher-1',
      teaches: false,
    });
    await expect(
      service.assertMayTouch(actorOf(), existing),
    ).resolves.toMatchObject({ teacherId: 'teacher-1' });
    expect(prisma.teacherSectionSubject.findFirst).not.toHaveBeenCalled();
  });

  it('refuses an unrelated teacher', async () => {
    const { service } = harness({ teacherId: 'teacher-7', teaches: false });
    await expect(service.assertMayTouch(actorOf(), existing)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets an assignment.all holder touch anything', async () => {
    const { service } = harness({
      teacherId: null,
      codes: ['assignment.all'],
    });
    await expect(
      service.assertMayTouch(actorOf(), existing),
    ).resolves.toMatchObject({ seesAll: true });
  });
});

describe('AssignmentPolicyService.slotsFor', () => {
  it('returns the teacher’s section-subject pairs for a session', async () => {
    const { service, prisma } = harness({
      teacherId: 'teacher-1',
      slots: [SLOT, { ...SLOT, sectionId: 'section-9a' }],
    });
    const slots = await service.slotsFor('teacher-1', SCHOOL, 'session-1');
    expect(slots).toHaveLength(2);

    // Read the call args rather than nesting an `objectContaining` — the
    // matcher is typed `any`, and the point here is that the session
    // filter reaches the query at all.
    const args = prisma.teacherSectionSubject.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      teacherId: 'teacher-1',
      schoolId: SCHOOL,
      sessionId: 'session-1',
    });
  });

  it('omits the session filter when none is given', async () => {
    const { service, prisma } = harness({ teacherId: 'teacher-1', slots: [] });
    await service.slotsFor('teacher-1', SCHOOL);
    const args = prisma.teacherSectionSubject.findMany.mock.calls[0][0];
    expect(args.where).not.toHaveProperty('sessionId');
  });
});
