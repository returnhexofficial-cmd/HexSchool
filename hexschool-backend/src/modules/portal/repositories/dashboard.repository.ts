import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma/prisma.service';
import {
  countByStatus,
  presentEquivalent,
} from '../../attendance/calc/percentage.util';
import { isoDate } from '../../academic/calendar/date.util';

/**
 * Narrow read repository for the dashboards (roadmap M18 §4). One place
 * for the cross-module aggregate queries a dashboard needs, over
 * PrismaService only (the M12/M17 `AudienceRepository`/`EmployeeDirectory`
 * precedent) — the alternative, importing six report services to pull one
 * number each, would bloat the module for no gain. The `DashboardService`
 * caches the assembled result.
 */
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async studentTotals(schoolId: string, sessionId: string | null) {
    const total = await this.prisma.student.count({
      where: { schoolId, deletedAt: null, status: 'ACTIVE' },
    });
    if (!sessionId) return { total, byClass: [] };

    const grouped = await this.prisma.enrollment.groupBy({
      by: ['classId'],
      where: { schoolId, sessionId, status: 'ACTIVE', deletedAt: null },
      _count: { _all: true },
    });
    const classes = await this.prisma.schoolClass.findMany({
      where: { id: { in: grouped.map((g) => g.classId) } },
      select: { id: true, name: true, numericLevel: true },
    });
    const nameById = new Map(classes.map((c) => [c.id, c]));
    const byClass = grouped
      .map((g) => ({
        classId: g.classId,
        className: nameById.get(g.classId)?.name ?? '—',
        level: nameById.get(g.classId)?.numericLevel ?? 0,
        count: g._count._all,
      }))
      .sort((a, b) => a.level - b.level);
    return { total, byClass };
  }

  /** Today's student attendance %: present-equivalent over marked rows. */
  async todayAttendance(schoolId: string): Promise<number | null> {
    const today = new Date(`${isoDate(new Date())}T00:00:00.000Z`);
    const rows = await this.prisma.studentAttendance.findMany({
      where: { schoolId, date: today, deletedAt: null },
      select: { status: true },
    });
    if (rows.length === 0) return null;
    const counts = countByStatus(rows);
    const marked = rows.length - counts.HOLIDAY;
    if (marked === 0) return null;
    return Math.round((presentEquivalent(counts) / marked) * 10000) / 100;
  }

  async teacherAttendanceToday(schoolId: string) {
    const today = new Date(`${isoDate(new Date())}T00:00:00.000Z`);
    const [totalTeachers, present] = await Promise.all([
      this.prisma.teacher.count({
        where: { schoolId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.staffAttendance.count({
        where: {
          schoolId,
          date: today,
          personType: 'TEACHER',
          status: { in: ['PRESENT', 'LATE'] },
        },
      }),
    ]);
    return { present, total: totalTeachers };
  }

  async feeCollection(schoolId: string) {
    const now = new Date();
    const todayStart = new Date(`${isoDate(now)}T00:00:00.000Z`);
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const [todayAgg, monthAgg, dues] = await Promise.all([
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { schoolId, status: 'SUCCESS', paidAt: { gte: todayStart } },
      }),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: { schoolId, status: 'SUCCESS', paidAt: { gte: monthStart } },
      }),
      this.prisma.invoice.aggregate({
        _sum: { payable: true, paidTotal: true },
        where: {
          schoolId,
          deletedAt: null,
          status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
        },
      }),
    ]);
    const duesTotal =
      Number(dues._sum.payable ?? 0) - Number(dues._sum.paidTotal ?? 0);
    return {
      today: Number(todayAgg._sum.amount ?? 0),
      month: Number(monthAgg._sum.amount ?? 0),
      duesTotal: Math.max(0, Math.round(duesTotal * 100) / 100),
    };
  }

  /** Today's collection grouped by method (accountant dashboard). */
  async collectionByMethod(schoolId: string) {
    const todayStart = new Date(`${isoDate(new Date())}T00:00:00.000Z`);
    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { schoolId, status: 'SUCCESS', paidAt: { gte: todayStart } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return grouped.map((g) => ({
      method: g.method,
      amount: Number(g._sum.amount ?? 0),
      count: g._count._all,
    }));
  }

  /** Last `months` calendar months of successful collection. */
  async monthlyCollectionTrend(schoolId: string, months = 6) {
    const now = new Date();
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    );
    const payments = await this.prisma.payment.findMany({
      where: { schoolId, status: 'SUCCESS', paidAt: { gte: from } },
      select: { amount: true, paidAt: true },
    });
    const buckets = new Map<string, number>();
    for (let i = 0; i < months; i++) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1) + i, 1),
      );
      buckets.set(d.toISOString().slice(0, 7), 0);
    }
    for (const p of payments) {
      if (!p.paidAt) continue;
      const key = p.paidAt.toISOString().slice(0, 7);
      if (buckets.has(key))
        buckets.set(key, buckets.get(key)! + Number(p.amount));
    }
    return [...buckets.entries()].map(([month, amount]) => ({
      month,
      amount: Math.round(amount * 100) / 100,
    }));
  }

  async pendingInvoices(schoolId: string) {
    return this.prisma.invoice.count({
      where: {
        schoolId,
        deletedAt: null,
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      },
    });
  }

  async pendingAdmissions(schoolId: string) {
    return this.prisma.admissionApplication.count({
      where: {
        schoolId,
        deletedAt: null,
        status: {
          in: [
            'SUBMITTED',
            'UNDER_REVIEW',
            'TEST_SCHEDULED',
            'PASSED',
            'SELECTED',
          ],
        },
      },
    });
  }

  async upcomingEvents(schoolId: string, take = 5) {
    const today = new Date(`${isoDate(new Date())}T00:00:00.000Z`);
    const rows = await this.prisma.calendarEvent.findMany({
      where: { schoolId, deletedAt: null, startDate: { gte: today } },
      orderBy: { startDate: 'asc' },
      take,
      select: { id: true, title: true, startDate: true, type: true },
    });
    return rows.map((e) => ({
      id: e.id,
      title: e.title,
      date: isoDate(e.startDate),
      type: e.type,
    }));
  }

  /** invoiceId → owning studentId, for portal Pay-Now ownership checks. */
  async invoiceStudentIds(
    invoiceIds: string[],
    schoolId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, schoolId },
      select: { id: true, enrollment: { select: { studentId: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.enrollment.studentId]));
  }

  /**
   * Outstanding-dues rows for a session with each student's primary
   * guardian phone — the dues-reminder blast's audience.
   */
  async defaultersForSession(schoolId: string, sessionId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        sessionId,
        deletedAt: null,
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      },
      select: {
        enrollmentId: true,
        payable: true,
        paidTotal: true,
        enrollment: {
          select: {
            studentId: true,
            student: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    const byStudent = new Map<
      string,
      { studentId: string; name: string; outstanding: number }
    >();
    for (const inv of invoices) {
      const out = Number(inv.payable) - Number(inv.paidTotal);
      if (out <= 0) continue;
      const existing = byStudent.get(inv.enrollment.studentId);
      const name =
        `${inv.enrollment.student.firstName} ${inv.enrollment.student.lastName}`.trim();
      byStudent.set(inv.enrollment.studentId, {
        studentId: inv.enrollment.studentId,
        name,
        outstanding: (existing?.outstanding ?? 0) + out,
      });
    }
    if (byStudent.size === 0) return [];

    const links = await this.prisma.studentGuardian.findMany({
      where: { studentId: { in: [...byStudent.keys()] }, isPrimary: true },
      select: { studentId: true, guardian: { select: { phone: true } } },
    });
    const phoneByStudent = new Map(
      links.map((l) => [l.studentId, l.guardian.phone]),
    );

    return [...byStudent.values()]
      .map((s) => ({
        ...s,
        outstanding: Math.round(s.outstanding * 100) / 100,
        phone: phoneByStudent.get(s.studentId) ?? null,
      }))
      .filter((s): s is typeof s & { phone: string } => s.phone !== null);
  }

  /** The most-recently-published exam's headline result stats. */
  async latestResultStats(schoolId: string) {
    const publication = await this.prisma.resultPublication.findFirst({
      where: { schoolId, isActive: true },
      orderBy: { publishedAt: 'desc' },
      select: { examId: true, exam: { select: { name: true } } },
    });
    if (!publication) return null;
    const results = await this.prisma.result.findMany({
      where: { schoolId, examId: publication.examId },
      select: { status: true, gpa: true },
    });
    if (results.length === 0) return null;
    const passed = results.filter((r) => r.status === 'PASSED');
    const avgGpa =
      passed.length === 0
        ? 0
        : Math.round(
            (passed.reduce((s, r) => s + Number(r.gpa), 0) / passed.length) *
              100,
          ) / 100;
    return {
      examName: publication.exam.name,
      candidates: results.length,
      passed: passed.length,
      passRate: Math.round((passed.length / results.length) * 10000) / 100,
      averageGpa: avgGpa,
    };
  }
}
