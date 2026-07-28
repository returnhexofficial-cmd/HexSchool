import { DashboardRepository } from './dashboard.repository';
import type { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The M18 dashboard aggregates the charts read. Three behaviours are worth
 * pinning because getting them wrong produces a *plausible but false*
 * picture rather than an error: an unmarked day must be a gap and not a
 * zero, the GPA bands must be the NCTB boundaries (not even fifths), and
 * the BIGSERIAL audit id must leave as a string.
 */
describe('DashboardRepository', () => {
  const prismaWith = (overrides: Record<string, unknown>) =>
    overrides as unknown as PrismaService;

  describe('attendanceTrend', () => {
    it('reports an unmarked day as null, not 0%', async () => {
      const repo = new DashboardRepository(
        prismaWith({
          studentAttendance: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

      const out = await repo.attendanceTrend('school-1', 5);

      expect(out).toHaveLength(5);
      // Nobody marked anything, so every day is unknown — a run of zeroes
      // would claim the whole school was absent all week.
      expect(out.every((d) => d.percentage === null)).toBe(true);
    });

    it('computes present-equivalent over marked rows, excluding holidays', async () => {
      // Must sit inside the rolling window, so anchor it on today.
      const key = new Date().toISOString().slice(0, 10);
      const day = new Date(`${key}T00:00:00.000Z`);
      const repo = new DashboardRepository(
        prismaWith({
          studentAttendance: {
            findMany: jest.fn().mockResolvedValue([
              { date: day, status: 'PRESENT' },
              { date: day, status: 'PRESENT' },
              { date: day, status: 'ABSENT' },
              { date: day, status: 'HOLIDAY' },
            ]),
          },
        }),
      );

      const out = await repo.attendanceTrend('school-1', 30);
      const marked = out.find((d) => d.date === key);

      // 2 present of 3 marked (the HOLIDAY row leaves the denominator).
      expect(marked?.percentage).toBeCloseTo(66.67, 1);
    });

    it('returns the window oldest-first so a line reads left to right', async () => {
      const repo = new DashboardRepository(
        prismaWith({
          studentAttendance: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      );

      const out = await repo.attendanceTrend('school-1', 7);
      const dates = out.map((d) => d.date);

      expect([...dates].sort()).toEqual(dates);
    });
  });

  describe('gpaDistribution', () => {
    const publication = {
      examId: 'exam-1',
      exam: { name: 'Annual 2026' },
    };

    it('buckets on the NCTB grade boundaries', async () => {
      const repo = new DashboardRepository(
        prismaWith({
          resultPublication: {
            findFirst: jest.fn().mockResolvedValue(publication),
          },
          result: {
            findMany: jest.fn().mockResolvedValue([
              { gpa: 5, status: 'PASSED' },
              { gpa: 4.5, status: 'PASSED' },
              { gpa: 3.5, status: 'PASSED' },
              { gpa: 0, status: 'FAILED' },
            ]),
          },
        }),
      );

      const out = await repo.gpaDistribution('school-1');
      const counts = Object.fromEntries(
        out!.buckets.map((b) => [b.label, b.count]),
      );

      expect(out!.examName).toBe('Annual 2026');
      expect(counts['A+ (5.00)']).toBe(1);
      expect(counts['A (4.00–4.99)']).toBe(1);
      expect(counts['A− (3.50–3.99)']).toBe(1);
      expect(counts['F (0.00)']).toBe(1);
      // Every candidate landed in exactly one band.
      expect(out!.buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
    });

    it('returns null when nothing is published, rather than empty bands', async () => {
      const repo = new DashboardRepository(
        prismaWith({
          resultPublication: { findFirst: jest.fn().mockResolvedValue(null) },
        }),
      );

      await expect(repo.gpaDistribution('school-1')).resolves.toBeNull();
    });
  });

  describe('recentActivity', () => {
    it('stringifies the BIGSERIAL id and resolves the actor separately', async () => {
      const repo = new DashboardRepository(
        prismaWith({
          auditLog: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 42n,
                userId: 'u1',
                action: 'UPDATE',
                entityType: 'Student',
                entityId: 's1',
                createdAt: new Date('2026-05-01'),
              },
              {
                id: 43n,
                userId: null,
                action: 'CREATE',
                entityType: 'Invoice',
                entityId: 'i1',
                createdAt: new Date('2026-05-02'),
              },
            ]),
          },
          user: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                { id: 'u1', email: 'clerk@school.test', phone: null },
              ]),
          },
        }),
      );

      const out = await repo.recentActivity('school-1');

      expect(out[0].id).toBe('42');
      expect(out[0].actor).toBe('clerk@school.test');
      // A job-written row has no user; it is System, not "Unknown".
      expect(out[1].actor).toBe('System');
      // The diffs stay in the M03 audit viewer.
      expect(out[0]).not.toHaveProperty('oldValues');
      expect(out[0]).not.toHaveProperty('newValues');
    });
  });
});
