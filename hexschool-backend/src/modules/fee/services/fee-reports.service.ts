import { BadRequestException, Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod } from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { SessionsService } from '../../academic/services/sessions.service';
import { agingBucket } from '../calc/fine.engine';
import { money } from '../calc/money.util';
import { FeeReportQueryDto } from '../dto';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentsRepository } from '../repositories/payments.repository';

export interface DailyCollection {
  from: string;
  to: string;
  total: number;
  byMethod: Array<{ method: PaymentMethod; amount: number; count: number }>;
  byCollector: Array<{ collectorId: string; amount: number; count: number }>;
  byDay: Array<{ date: string; amount: number; count: number }>;
  rows: Array<{
    paymentNo: string;
    paidAt: string;
    studentName: string;
    studentUid: string;
    className: string;
    invoiceNo: string;
    method: PaymentMethod;
    amount: number;
  }>;
}

export interface DuesReport {
  totalOutstanding: number;
  buckets: Array<{ bucket: string; amount: number; invoices: number }>;
  byClass: Array<{
    classId: string;
    className: string;
    outstanding: number;
    students: number;
  }>;
  defaulters: Array<{
    enrollmentId: string;
    studentUid: string;
    studentName: string;
    className: string;
    sectionName: string;
    rollNo: number;
    outstanding: number;
    oldestDueDate: string;
    bucket: string;
  }>;
}

export interface HeadWiseIncome {
  rows: Array<{
    feeHeadId: string | null;
    feeHeadName: string;
    billed: number;
    discounted: number;
    net: number;
  }>;
  totalBilled: number;
  totalDiscounted: number;
  totalNet: number;
}

/**
 * The money reports (roadmap M16 §4).
 *
 * Report SHAPES live here; the file renderers are
 * `FeeExportService` — the M12 split, so an XLSX column change cannot
 * alter what the API returns.
 *
 * One accounting decision runs through all of them: **collection is
 * counted from `payments`, dues from `invoices`.** They are different
 * questions — money received in July against a June bill is July's
 * collection and was June's due — and conflating them is how a fee
 * report stops reconciling.
 */
@Injectable()
export class FeeReportsService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly payments: PaymentsRepository,
    private readonly sessions: SessionsService,
  ) {}

  /** Daily / range collection, split by method and by collector. */
  async collection(
    query: FeeReportQueryDto,
    schoolId: string,
  ): Promise<DailyCollection> {
    const today = isoDate(new Date());
    const from = parseDate(query.from ?? today);
    const to = endOfDay(parseDate(query.to ?? query.from ?? today));

    const [rows, byMethod] = await Promise.all([
      this.payments.findCollections(schoolId, from, to),
      this.payments.sumByMethod(schoolId, from, to),
    ]);

    const byCollector = new Map<string, { amount: number; count: number }>();
    const byDay = new Map<string, { amount: number; count: number }>();

    for (const payment of rows) {
      const collector = payment.receivedBy ?? 'online';
      const c = byCollector.get(collector) ?? { amount: 0, count: 0 };
      byCollector.set(collector, {
        amount: money(c.amount + Number(payment.amount)),
        count: c.count + 1,
      });

      const day = isoDate(payment.paidAt ?? payment.createdAt);
      const d = byDay.get(day) ?? { amount: 0, count: 0 };
      byDay.set(day, {
        amount: money(d.amount + Number(payment.amount)),
        count: d.count + 1,
      });
    }

    return {
      from: isoDate(from),
      to: isoDate(to),
      total: money(rows.reduce((sum, p) => sum + Number(p.amount), 0)),
      byMethod,
      byCollector: [...byCollector.entries()].map(([collectorId, v]) => ({
        collectorId,
        ...v,
      })),
      byDay: [...byDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      rows: rows.map((payment) => ({
        paymentNo: payment.paymentNo,
        paidAt: isoDate(payment.paidAt ?? payment.createdAt),
        studentName:
          `${payment.invoice.enrollment.student.firstName} ${payment.invoice.enrollment.student.lastName}`.trim(),
        studentUid: payment.invoice.enrollment.student.studentUid,
        className: `${payment.invoice.enrollment.class.name} — ${payment.invoice.enrollment.section.name}`,
        invoiceNo: payment.invoice.invoiceNo,
        method: payment.method,
        amount: Number(payment.amount),
      })),
    };
  }

  /** Dues with aging buckets, plus the defaulter list. */
  async dues(query: FeeReportQueryDto, schoolId: string): Promise<DuesReport> {
    const sessionId = await this.resolveSession(query.sessionId, schoolId);
    const invoices = await this.invoices.findMany(
      schoolId,
      {
        sessionId,
        classId: query.classId,
        sectionId: query.sectionId,
        overdueOnly: true,
      },
      5000,
    );
    const today = isoDate(new Date());

    const buckets = new Map<string, { amount: number; invoices: number }>();
    const byClass = new Map<
      string,
      { className: string; outstanding: number; students: Set<string> }
    >();
    const byEnrollment = new Map<
      string,
      {
        outstanding: number;
        oldest: string;
        row: (typeof invoices)[number];
      }
    >();

    for (const invoice of invoices) {
      const due = money(Number(invoice.payable) - Number(invoice.paidTotal));
      if (due <= 0) continue;

      const dueDate = isoDate(invoice.dueDate);
      const bucket = agingBucket(dueDate, today);

      const b = buckets.get(bucket) ?? { amount: 0, invoices: 0 };
      buckets.set(bucket, {
        amount: money(b.amount + due),
        invoices: b.invoices + 1,
      });

      const classId = invoice.enrollment.classId;
      const c = byClass.get(classId) ?? {
        className: invoice.enrollment.class.name,
        outstanding: 0,
        students: new Set<string>(),
      };
      c.outstanding = money(c.outstanding + due);
      c.students.add(invoice.enrollmentId);
      byClass.set(classId, c);

      const e = byEnrollment.get(invoice.enrollmentId);
      byEnrollment.set(invoice.enrollmentId, {
        outstanding: money((e?.outstanding ?? 0) + due),
        oldest:
          e && e.oldest < dueDate ? e.oldest : dueDate,
        row: invoice,
      });
    }

    return {
      totalOutstanding: money(
        [...byEnrollment.values()].reduce((sum, e) => sum + e.outstanding, 0),
      ),
      buckets: [...buckets.entries()]
        .map(([bucket, v]) => ({ bucket, ...v }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket)),
      byClass: [...byClass.entries()].map(([classId, v]) => ({
        classId,
        className: v.className,
        outstanding: v.outstanding,
        students: v.students.size,
      })),
      defaulters: [...byEnrollment.entries()]
        .map(([enrollmentId, v]) => ({
          enrollmentId,
          studentUid: v.row.enrollment.student.studentUid,
          studentName:
            `${v.row.enrollment.student.firstName} ${v.row.enrollment.student.lastName}`.trim(),
          className: v.row.enrollment.class.name,
          sectionName: v.row.enrollment.section.name,
          rollNo: v.row.enrollment.rollNo,
          outstanding: v.outstanding,
          oldestDueDate: v.oldest,
          bucket: agingBucket(v.oldest, today),
        }))
        .sort((a, b) => b.outstanding - a.outstanding),
    };
  }

  /** What each head earned — the income breakdown. */
  async headWise(
    query: FeeReportQueryDto,
    schoolId: string,
  ): Promise<HeadWiseIncome> {
    const sessionId = await this.resolveSession(query.sessionId, schoolId);
    const invoices = await this.invoices.findMany(
      schoolId,
      { sessionId, classId: query.classId, sectionId: query.sectionId },
      5000,
    );

    const byHead = new Map<
      string,
      { name: string; billed: number; discounted: number }
    >();

    for (const invoice of invoices) {
      if (invoice.status === InvoiceStatus.CANCELLED) continue;
      for (const item of invoice.items) {
        const key = item.feeHeadId ?? 'unmapped';
        const row = byHead.get(key) ?? {
          name: item.description,
          billed: 0,
          discounted: 0,
        };
        row.billed = money(row.billed + Number(item.amount));
        row.discounted = money(row.discounted + Number(item.discount));
        byHead.set(key, row);
      }
    }

    const rows = [...byHead.entries()].map(([key, v]) => ({
      feeHeadId: key === 'unmapped' ? null : key,
      feeHeadName: v.name,
      billed: v.billed,
      discounted: v.discounted,
      net: money(v.billed - v.discounted),
    }));

    return {
      rows: rows.sort((a, b) => b.net - a.net),
      totalBilled: money(rows.reduce((sum, r) => sum + r.billed, 0)),
      totalDiscounted: money(rows.reduce((sum, r) => sum + r.discounted, 0)),
      totalNet: money(rows.reduce((sum, r) => sum + r.net, 0)),
    };
  }

  /** Month-by-month billed vs collected — the collection-trend chart. */
  async monthly(
    query: FeeReportQueryDto,
    schoolId: string,
  ): Promise<Array<{ month: string; billed: number; collected: number }>> {
    const sessionId = await this.resolveSession(query.sessionId, schoolId);
    const session = await this.sessions.getById(sessionId, schoolId);

    const invoices = await this.invoices.findMany(
      schoolId,
      { sessionId },
      5000,
    );
    const payments = await this.payments.findCollections(
      schoolId,
      session.startDate,
      endOfDay(session.endDate),
    );

    const months = new Map<string, { billed: number; collected: number }>();
    const touch = (month: string) =>
      months.get(month) ?? { billed: 0, collected: 0 };

    for (const invoice of invoices) {
      if (invoice.status === InvoiceStatus.CANCELLED) continue;
      const month = isoDate(invoice.billingMonth ?? invoice.issueDate).slice(0, 7);
      const row = touch(month);
      row.billed = money(row.billed + Number(invoice.payable));
      months.set(month, row);
    }

    for (const payment of payments) {
      const month = isoDate(payment.paidAt ?? payment.createdAt).slice(0, 7);
      const row = touch(month);
      row.collected = money(row.collected + Number(payment.amount));
      months.set(month, row);
    }

    return [...months.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private async resolveSession(
    sessionId: string | undefined,
    schoolId: string,
  ): Promise<string> {
    if (sessionId) return sessionId;
    const current = await this.sessions.getCurrent(schoolId);
    if (!current) {
      throw new BadRequestException(
        'No current academic session — pass sessionId explicitly',
      );
    }
    return current.id;
  }
}

/** Inclusive upper bound for a date range over timestamps. */
function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}
