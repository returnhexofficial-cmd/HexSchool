import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * The cross-module aggregate reads the executive dashboard needs, over
 * **PrismaService alone**.
 *
 * The M12 `EmployeeDirectoryRepository` / M17 `AudienceRepository` / M18
 * `DashboardRepository` / M19 `PublicSiteRepository` / M22 policy-query /
 * M23 `LibraryDirectoryRepository` / M24 `InventoryDirectoryRepository` /
 * M28 `CommunityDirectoryRepository` precedent, **ninth use** — and the
 * one where it matters most, because the alternative is an analytics
 * module that imports twelve feature modules to pull one number each.
 *
 * **The three materialized-view reads are the reason this file uses raw
 * SQL at all.** Prisma has no model for a materialized view; there is
 * nothing to generate. `$queryRaw` with tagged-template parameters is
 * therefore the honest tool here rather than a shortcut — the values are
 * still bound, never interpolated.
 */

export interface MonthlyAttendanceRow {
  sessionId: string;
  classId: string;
  sectionId: string;
  month: string;
  marked: number;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  students: number;
}

export interface MonthlyCollectionRow {
  month: string;
  billed: number;
  fined: number;
  invoices: number;
  collected: number;
  payments: number;
}

export interface ResultSummaryRow {
  examId: string;
  sessionId: string;
  examName: string;
  examDate: string;
  candidates: number;
  passed: number;
  avgGpa: number | null;
  avgPercentage: number | null;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── materialized views ───────────────────────────────────────────────

  async attendanceMonthly(
    schoolId: string,
    sessionId?: string,
  ): Promise<MonthlyAttendanceRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        session_id: string;
        class_id: string;
        section_id: string;
        month: Date;
        marked: number;
        present: number;
        late: number;
        half_day: number;
        absent: number;
        students: number;
      }>
    >`
      SELECT "session_id", "class_id", "section_id", "month",
             "marked", "present", "late", "half_day", "absent", "students"
      FROM "mv_attendance_monthly"
      WHERE "school_id" = ${schoolId}::uuid
        AND (${sessionId ?? null}::uuid IS NULL OR "session_id" = ${sessionId ?? null}::uuid)
      ORDER BY "month" ASC
    `;
    return rows.map((row) => ({
      sessionId: row.session_id,
      classId: row.class_id,
      sectionId: row.section_id,
      month: row.month.toISOString().slice(0, 7),
      marked: Number(row.marked),
      present: Number(row.present),
      late: Number(row.late),
      halfDay: Number(row.half_day),
      absent: Number(row.absent),
      students: Number(row.students),
    }));
  }

  async collectionMonthly(
    schoolId: string,
    months = 24,
  ): Promise<MonthlyCollectionRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        month: Date;
        billed: Prisma.Decimal;
        fined: Prisma.Decimal;
        invoices: number;
        collected: Prisma.Decimal;
        payments: number;
      }>
    >`
      SELECT "month", "billed", "fined", "invoices", "collected", "payments"
      FROM "mv_collection_monthly"
      WHERE "school_id" = ${schoolId}::uuid
      ORDER BY "month" DESC
      LIMIT ${months}
    `;
    return rows
      .map((row) => ({
        month: row.month.toISOString().slice(0, 7),
        billed: Number(row.billed),
        fined: Number(row.fined),
        invoices: Number(row.invoices),
        collected: Number(row.collected),
        payments: Number(row.payments),
      }))
      .reverse();
  }

  async resultSummary(
    schoolId: string,
    sessionId?: string,
  ): Promise<ResultSummaryRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        exam_id: string;
        session_id: string;
        exam_name: string;
        exam_date: Date;
        candidates: number;
        passed: number;
        avg_gpa: Prisma.Decimal | null;
        avg_percentage: Prisma.Decimal | null;
      }>
    >`
      SELECT "exam_id", "session_id", "exam_name", "exam_date",
             "candidates", "passed", "avg_gpa", "avg_percentage"
      FROM "mv_result_summary"
      WHERE "school_id" = ${schoolId}::uuid
        AND (${sessionId ?? null}::uuid IS NULL OR "session_id" = ${sessionId ?? null}::uuid)
      ORDER BY "exam_date" ASC
    `;
    return rows.map((row) => ({
      examId: row.exam_id,
      sessionId: row.session_id,
      examName: row.exam_name,
      examDate: row.exam_date.toISOString().slice(0, 10),
      candidates: Number(row.candidates),
      passed: Number(row.passed),
      avgGpa: row.avg_gpa === null ? null : Number(row.avg_gpa),
      avgPercentage:
        row.avg_percentage === null ? null : Number(row.avg_percentage),
    }));
  }

  /**
   * Roadmap §4's MV refresh. CONCURRENTLY needs the unique index each view
   * carries — without it the rebuild takes an ACCESS EXCLUSIVE lock and
   * every dashboard reading the view blocks for its duration.
   *
   * The view names are a **closed literal list**, never a parameter: this
   * is one of the few places raw DDL is unavoidable, and an identifier
   * cannot be bound, so the only safe design is one where no caller can
   * supply a name at all.
   */
  async refreshView(view: MaterializedView): Promise<void> {
    const statement = REFRESH_SQL[view];
    await this.prisma.$executeRawUnsafe(statement);
  }

  // ── narrow cross-module reads ────────────────────────────────────────

  /**
   * Enrollment on the roll per month — roadmap §4's "enrollment trends
   * (YoY)".
   *
   * **An enrollment has no leaving date**, so "on the roll in February"
   * has to be reconstructed rather than read. The window used is
   * `[enrollment_date, session end]`, and a CANCELLED enrollment is
   * excluded outright because a cancellation means the student was never
   * on that roll (the M11 rule the partial unique indexes already encode).
   *
   * The alternative — filtering on `status = 'ACTIVE'` — is the reading to
   * avoid, and it is worth being explicit about why: `status` is *now* and
   * a trend is *then*. Everybody promoted at the end of last year is
   * PROMOTED today, so an ACTIVE filter would report last year's roll as
   * empty and draw a chart claiming the school had no students until
   * April.
   */
  async enrollmentByMonth(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ month: string; count: number }>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ month: Date; count: bigint }>
    >`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', ${from}::timestamptz),
          date_trunc('month', ${to}::timestamptz),
          interval '1 month'
        )::date AS month
      )
      SELECT m."month", count(e."id") AS "count"
      FROM months m
      LEFT JOIN "enrollments" e
        ON e."school_id" = ${schoolId}::uuid
       AND e."deleted_at" IS NULL
       AND e."status" <> 'CANCELLED'
       AND e."enrollment_date" <= (m."month" + interval '1 month' - interval '1 day')
      LEFT JOIN "academic_sessions" s ON s."id" = e."session_id"
      WHERE e."id" IS NULL OR s."end_date" >= m."month"
      GROUP BY m."month"
      ORDER BY m."month" ASC
    `;
    return rows.map((row) => ({
      month: row.month.toISOString().slice(0, 7),
      count: Number(row.count),
    }));
  }

  /** Live headcount split by class, for the executive stat row. */
  async headcountByClass(
    schoolId: string,
    sessionId: string,
  ): Promise<Array<{ className: string; level: number; count: number }>> {
    const grouped = await this.prisma.enrollment.groupBy({
      by: ['classId'],
      where: { schoolId, sessionId, status: 'ACTIVE', deletedAt: null },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];
    const classes = await this.prisma.schoolClass.findMany({
      where: { id: { in: grouped.map((g) => g.classId) } },
      select: { id: true, name: true, numericLevel: true },
    });
    const byId = new Map(classes.map((c) => [c.id, c]));
    return grouped
      .map((g) => ({
        className: byId.get(g.classId)?.name ?? '—',
        level: byId.get(g.classId)?.numericLevel ?? 0,
        count: g._count._all,
      }))
      .sort((a, b) => a.level - b.level);
  }

  /** Section and class names, for labelling the heatmap rows. */
  async sectionLabels(
    schoolId: string,
    sessionId?: string,
  ): Promise<Map<string, string>> {
    const sections = await this.prisma.section.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(sessionId ? { sessionId } : {}),
      },
      select: {
        id: true,
        name: true,
        class: { select: { name: true, numericLevel: true } },
      },
    });
    return new Map(
      sections
        .sort(
          (a, b) =>
            a.class.numericLevel - b.class.numericLevel ||
            a.name.localeCompare(b.name),
        )
        .map((s) => [s.id, `${s.class.name} ${s.name}`]),
    );
  }

  /**
   * Outstanding invoices with their age in days — the input to the aging
   * buckets. Cancelled invoices are excluded: a cancelled bill is not a
   * debt, and counting one would put money in a bucket nobody can collect.
   */
  async outstandingInvoices(
    schoolId: string,
    asOf: Date,
  ): Promise<Array<{ daysOverdue: number; amount: number }>> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId,
        deletedAt: null,
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      },
      select: { dueDate: true, payable: true, paidTotal: true },
    });
    return invoices
      .map((invoice) => ({
        daysOverdue: Math.floor(
          (asOf.getTime() - invoice.dueDate.getTime()) / 86_400_000,
        ),
        amount:
          Math.round(
            (Number(invoice.payable) - Number(invoice.paidTotal)) * 100,
          ) / 100,
      }))
      .filter((row) => row.amount > 0);
  }

  /** Roadmap §4's "SMS spend" and the delivery log behind it. */
  async messageSpend(
    schoolId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      channel: string;
      status: string;
      messages: number;
      segments: number;
      cost: number;
    }>
  > {
    const grouped = await this.prisma.notification.groupBy({
      by: ['channel', 'status'],
      where: { schoolId, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
      _sum: { segments: true, cost: true },
    });
    return grouped.map((row) => ({
      channel: row.channel,
      status: row.status,
      messages: row._count._all,
      segments: row._sum.segments ?? 0,
      cost: Math.round(Number(row._sum.cost ?? 0) * 10000) / 10000,
    }));
  }

  /** The delivery log rows behind the `communication.log` report. */
  async deliveryLog(
    schoolId: string,
    from: Date,
    to: Date,
    take = 20_000,
  ): Promise<
    Array<{
      createdAt: Date;
      channel: string;
      templateCode: string | null;
      destination: string | null;
      subject: string | null;
      status: string;
      segments: number | null;
      cost: number | null;
      error: string | null;
      sentAt: Date | null;
    }>
  > {
    const rows = await this.prisma.notification.findMany({
      where: { schoolId, createdAt: { gte: from, lte: to } },
      select: {
        createdAt: true,
        channel: true,
        templateCode: true,
        destination: true,
        subject: true,
        status: true,
        segments: true,
        cost: true,
        error: true,
        sentAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return rows.map((row) => ({
      ...row,
      cost: row.cost === null ? null : Number(row.cost),
    }));
  }

  /**
   * A user's type and school — the two facts the engine needs about a
   * principal it only has an id for.
   *
   * A **scheduled** run has no request and no token, so `userType` cannot
   * come from a JWT the way it does everywhere else in this system. It has
   * to be read, and it has to be read here rather than by importing
   * AuthModule or StaffModule for one column (the narrow-repository rule
   * this whole file exists for).
   */
  async principal(
    userId: string,
  ): Promise<{ userType: string; schoolId: string; status: string } | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { userType: true, schoolId: true, status: true },
    });
  }

  /** Teacher workload and leave, for the executive "operations" panel. */
  async teacherLoad(
    schoolId: string,
    sessionId: string,
  ): Promise<{ teachers: number; assignments: number; onLeaveToday: number }> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [teachers, assignments, onLeaveToday] = await Promise.all([
      this.prisma.teacher.count({ where: { schoolId, deletedAt: null } }),
      this.prisma.teacherSectionSubject.count({
        where: { schoolId, sessionId },
      }),
      this.prisma.leaveApplication.count({
        where: {
          schoolId,
          deletedAt: null,
          status: 'APPROVED',
          fromDate: { lte: today },
          toDate: { gte: today },
        },
      }),
    ]);
    return { teachers, assignments, onLeaveToday };
  }

  /** The one-line operational counts the executive dashboard tops out with. */
  async operationsSnapshot(schoolId: string): Promise<{
    booksOnLoan: number;
    booksOverdue: number;
    transportRiders: number;
    hostelResidents: number;
    openTickets: number;
    lowStockItems: number;
  }> {
    const now = new Date();
    const [
      booksOnLoan,
      booksOverdue,
      transportRiders,
      hostelResidents,
      openTickets,
    ] = await Promise.all([
      this.prisma.bookIssue.count({
        where: { schoolId, returnedAt: null },
      }),
      this.prisma.bookIssue.count({
        where: { schoolId, returnedAt: null, dueAt: { lt: now } },
      }),
      this.prisma.transportAssignment.count({
        where: { schoolId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.hostelAllocation.count({
        where: { schoolId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.ticket.count({
        where: {
          schoolId,
          deletedAt: null,
          status: { in: ['OPEN', 'IN_PROGRESS', 'REOPENED'] },
        },
      }),
    ]);

    // Reorder level is per item and nullable — "do not tell me" is not the
    // same as zero (the M24 rule), so the comparison has to happen in SQL
    // against the item's own column rather than against a constant.
    const lowStock = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS "count"
      FROM "items" i
      WHERE i."school_id" = ${schoolId}::uuid
        AND i."deleted_at" IS NULL
        AND i."reorder_level" IS NOT NULL
        AND COALESCE((
          SELECT l."balance_after"
          FROM "stock_ledger" l
          WHERE l."item_id" = i."id"
          ORDER BY l."created_at" DESC, l."id" DESC
          LIMIT 1
        ), 0) <= i."reorder_level"
    `;

    return {
      booksOnLoan,
      booksOverdue,
      transportRiders,
      hostelResidents,
      openTickets,
      lowStockItems: Number(lowStock[0]?.count ?? 0),
    };
  }
}

export type MaterializedView =
  'mv_attendance_monthly' | 'mv_collection_monthly' | 'mv_result_summary';

export const MATERIALIZED_VIEWS: readonly MaterializedView[] = [
  'mv_attendance_monthly',
  'mv_collection_monthly',
  'mv_result_summary',
];

const REFRESH_SQL: Record<MaterializedView, string> = {
  mv_attendance_monthly:
    'REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_attendance_monthly"',
  mv_collection_monthly:
    'REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_collection_monthly"',
  mv_result_summary:
    'REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_result_summary"',
};
