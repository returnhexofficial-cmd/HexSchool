import { BadRequestException, ConflictException } from '@nestjs/common';
import { PromotionDecision } from '../../../common/constants';
import { UserType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PromotionService } from './promotion.service';

describe('PromotionService', () => {
  const actor: AccessTokenPayload = {
    sub: 'actor-1',
    schoolId: 'school-1',
    userType: UserType.ADMIN,
  };

  let batches: Record<string, jest.Mock>;
  let items: Record<string, jest.Mock>;
  let enrollments: Record<string, jest.Mock>;
  let sections: Record<string, jest.Mock>;
  let sessions: Record<string, jest.Mock>;
  let students: Record<string, jest.Mock>;
  let statusHistory: Record<string, jest.Mock>;
  let service: PromotionService;

  beforeEach(() => {
    batches = {
      create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      findDetail: jest.fn().mockResolvedValue({
        id: 'batch-1',
        status: 'DRAFT',
        toSessionId: 's2',
      }),
      paginateList: jest.fn(),
      update: jest.fn(),
      hardDelete: jest.fn(),
      withTransaction: jest
        .fn()
        .mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
    };
    items = {
      createMany: jest.fn().mockResolvedValue(0),
      findForBatch: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      findById: jest.fn(),
      deleteForBatch: jest.fn(),
    };
    enrollments = {
      findLiveForSession: jest.fn().mockResolvedValue([]),
      maxRoll: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'new-enr' }),
      update: jest.fn(),
      hardDelete: jest.fn(),
    };
    sections = {
      findForSession: jest.fn().mockResolvedValue([{ id: 'sec-7' }]),
      findByIdOrFail: jest.fn().mockResolvedValue({
        id: 'sec-7',
        classId: 'class-7',
        sessionId: 's2',
        groupId: null,
        shiftId: null,
      }),
    };
    sessions = { findByIdOrFail: jest.fn().mockResolvedValue({ id: 's' }) };
    students = {
      findByIdOrFail: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      update: jest.fn(),
    };
    statusHistory = { append: jest.fn() };

    service = new PromotionService(
      batches as never,
      items as never,
      enrollments as never,
      sections as never,
      sessions as never,
      students as never,
      statusHistory as never,
      { set: jest.fn() } as never,
    );
  });

  describe('create', () => {
    it('rejects when from and to session are equal', async () => {
      await expect(
        service.create({ fromSessionId: 's1', toSessionId: 's1' }, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the target session has no sections', async () => {
      sections.findForSession.mockResolvedValue([]);
      await expect(
        service.create({ fromSessionId: 's1', toSessionId: 's2' }, actor),
      ).rejects.toThrow(/clone the academic structure/);
    });

    it('builds items with mapping-driven default decisions', async () => {
      enrollments.findLiveForSession.mockResolvedValue([
        { id: 'e1', studentId: 'st1', classId: 'class-6' }, // mapped → PROMOTE
        { id: 'e2', studentId: 'st2', classId: 'class-10' }, // no toClass → GRADUATE
        { id: 'e3', studentId: 'st3', classId: 'class-99' }, // unmapped → EXCLUDE
      ]);
      type Row = {
        studentId: string;
        decision: PromotionDecision;
        toClassId: string | null;
      };
      let rows: Row[] = [];
      items.createMany.mockImplementation((data: Row[]) => {
        rows = data;
        return Promise.resolve(data.length);
      });
      await service.create(
        {
          fromSessionId: 's1',
          toSessionId: 's2',
          mappings: [
            {
              fromClassId: 'class-6',
              toClassId: 'class-7',
              toSectionId: 'sec-7',
            },
            { fromClassId: 'class-10' }, // final class
          ],
        },
        actor,
      );
      expect(rows).toHaveLength(3);
      expect(rows.find((r) => r.studentId === 'st1')?.decision).toBe('PROMOTE');
      expect(rows.find((r) => r.studentId === 'st1')?.toClassId).toBe(
        'class-7',
      );
      expect(rows.find((r) => r.studentId === 'st2')?.decision).toBe(
        'GRADUATE',
      );
      expect(rows.find((r) => r.studentId === 'st3')?.decision).toBe('EXCLUDE');
    });
  });

  describe('execute', () => {
    it('promotes, graduates, and skips excluded students', async () => {
      items.findForBatch.mockResolvedValue([
        {
          id: 'i1',
          studentId: 'st1',
          fromEnrollmentId: 'e1',
          decision: 'PROMOTE',
          toClassId: 'class-7',
          toSectionId: 'sec-7',
        },
        {
          id: 'i2',
          studentId: 'st2',
          fromEnrollmentId: 'e2',
          decision: 'GRADUATE',
          toClassId: null,
          toSectionId: null,
        },
        {
          id: 'i3',
          studentId: 'st3',
          fromEnrollmentId: 'e3',
          decision: 'EXCLUDE',
          toClassId: null,
          toSectionId: null,
        },
      ]);

      const result = await service.execute('batch-1', {}, actor);
      expect(result).toEqual({
        promoted: 1,
        retained: 0,
        graduated: 1,
        excluded: 1,
      });
      // New enrollment created for the promoted student.
      expect(enrollments.create).toHaveBeenCalledTimes(1);
      // Graduating student's status flipped.
      expect(students.update).toHaveBeenCalledWith(
        'st2',
        expect.objectContaining({ status: 'GRADUATED' }),
        expect.anything(),
      );
      // Batch marked EXECUTED.
      expect(batches.update).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ status: 'EXECUTED' }),
        expect.anything(),
      );
    });

    it('refuses to execute a non-DRAFT batch', async () => {
      batches.findDetail.mockResolvedValue({
        id: 'batch-1',
        status: 'EXECUTED',
        toSessionId: 's2',
      });
      await expect(service.execute('batch-1', {}, actor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('fails before writing when a PROMOTE target is missing', async () => {
      items.findForBatch.mockResolvedValue([
        {
          id: 'i1',
          studentId: 'st1',
          fromEnrollmentId: 'e1',
          decision: 'PROMOTE',
          toClassId: null,
          toSectionId: null,
        },
      ]);
      await expect(service.execute('batch-1', {}, actor)).rejects.toThrow(
        /require a target class and section/,
      );
      expect(enrollments.create).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('deletes new enrollments, reactivates old ones, and reverts graduations', async () => {
      batches.findDetail.mockResolvedValue({
        id: 'batch-1',
        status: 'EXECUTED',
        toSessionId: 's2',
      });
      items.findForBatch.mockResolvedValue([
        {
          id: 'i1',
          studentId: 'st1',
          fromEnrollmentId: 'e1',
          toEnrollmentId: 'new-1',
          decision: 'PROMOTE',
        },
        {
          id: 'i2',
          studentId: 'st2',
          fromEnrollmentId: 'e2',
          toEnrollmentId: null,
          decision: 'GRADUATE',
        },
      ]);
      students.findByIdOrFail.mockResolvedValue({ status: 'GRADUATED' });

      await service.rollback('batch-1', actor);

      expect(enrollments.hardDelete).toHaveBeenCalledWith(
        'new-1',
        expect.anything(),
      );
      expect(enrollments.update).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ status: 'ACTIVE' }),
        expect.anything(),
      );
      expect(students.update).toHaveBeenCalledWith(
        'st2',
        expect.objectContaining({ status: 'ACTIVE' }),
        expect.anything(),
      );
      expect(batches.update).toHaveBeenCalledWith(
        'batch-1',
        expect.objectContaining({ status: 'ROLLED_BACK' }),
        expect.anything(),
      );
    });

    it('refuses to roll back a batch that is not EXECUTED', async () => {
      batches.findDetail.mockResolvedValue({
        id: 'batch-1',
        status: 'DRAFT',
        toSessionId: 's2',
      });
      await expect(service.rollback('batch-1', actor)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
