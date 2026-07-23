import { Injectable } from '@nestjs/common';
import { InvoiceStatus } from '../../../common/constants';
import { isoDate } from '../../academic/calendar/date.util';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { agingBucket } from '../calc/fine.engine';
import { money } from '../calc/money.util';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { PaymentsRepository } from '../repositories/payments.repository';

export interface DuesSummary {
  enrollmentId: string;
  outstanding: number;
  invoiceCount: number;
  oldestDueDate: string | null;
  bucket: string;
}

export interface LedgerEntry {
  date: string;
  type: 'INVOICE' | 'PAYMENT' | 'REFUND';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface StudentLedger {
  studentId: string;
  enrollments: string[];
  entries: LedgerEntry[];
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
}

/**
 * The dues ledger and the clearance check every other module asks
 * about money (roadmap M16 §4).
 *
 * This is the service `EXAM_DUES_GATE` binds to, and the one M09's
 * exit-status check and M27's certificate clearance will use. It is
 * therefore deliberately cheap: `outstandingFor` is one grouped query
 * however many candidates are passed, because the admit-card batch asks
 * about a whole class at once.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly payments: PaymentsRepository,
    private readonly enrollments: EnrollmentsRepository,
  ) {}

  /**
   * Outstanding per enrollment. One query — the admit-card gate calls
   * this with a class's worth of ids.
   */
  async outstandingFor(
    enrollmentIds: string[],
    schoolId: string,
  ): Promise<Map<string, number>> {
    return this.invoices.outstandingByEnrollment(enrollmentIds, schoolId);
  }

  /** Dues detail for a set of candidates — the defaulter list's source. */
  async duesFor(
    enrollmentIds: string[],
    schoolId: string,
  ): Promise<DuesSummary[]> {
    const invoices = await this.invoices.findOutstanding(
      enrollmentIds,
      schoolId,
    );
    const today = isoDate(new Date());

    const byEnrollment = new Map<string, typeof invoices>();
    for (const invoice of invoices) {
      byEnrollment.set(invoice.enrollmentId, [
        ...(byEnrollment.get(invoice.enrollmentId) ?? []),
        invoice,
      ]);
    }

    return [...byEnrollment.entries()].map(([enrollmentId, rows]) => {
      const total = money(
        rows.reduce(
          (sum, row) => sum + (Number(row.payable) - Number(row.paidTotal)),
          0,
        ),
      );
      const oldest = rows
        .map((row) => isoDate(row.dueDate))
        .sort()
        .at(0) ?? null;

      return {
        enrollmentId,
        outstanding: total,
        invoiceCount: rows.length,
        oldestDueDate: oldest,
        bucket: oldest ? agingBucket(oldest, today) : 'CURRENT',
      };
    });
  }

  /**
   * A student's whole money history, across every enrollment they have
   * held — a running balance the office reads down the page.
   *
   * Keyed on the student rather than one enrollment on purpose: dues
   * follow the person across a promotion, and "what does this family
   * owe" is the question actually being asked.
   */
  async studentLedger(
    studentId: string,
    schoolId: string,
    sessionId?: string,
  ): Promise<StudentLedger> {
    const enrollments = await this.enrollments.findAll(
      { studentId, ...(sessionId ? { sessionId } : {}) },
      schoolId,
    );
    const enrollmentIds = enrollments.map((e) => e.id);

    const invoices = await this.invoices.findMany(
      schoolId,
      { enrollmentId: undefined },
      1000,
    );
    const theirs = invoices.filter((invoice) =>
      enrollmentIds.includes(invoice.enrollmentId),
    );

    const entries: LedgerEntry[] = [];

    for (const invoice of theirs) {
      if (invoice.status === InvoiceStatus.CANCELLED) continue;
      entries.push({
        date: isoDate(invoice.issueDate),
        type: 'INVOICE',
        reference: invoice.invoiceNo,
        description:
          invoice.billingMonth === null
            ? 'Ad-hoc invoice'
            : `Fees for ${isoDate(invoice.billingMonth).slice(0, 7)}`,
        debit: Number(invoice.payable),
        credit: 0,
        balance: 0,
      });

      const payments = await this.payments.findForInvoice(invoice.id);
      for (const payment of payments) {
        if (payment.status === 'FAILED' || payment.status === 'CANCELLED') {
          continue;
        }
        entries.push({
          date: isoDate(payment.paidAt ?? payment.createdAt),
          type: 'PAYMENT',
          reference: payment.paymentNo,
          description: `${payment.method} against ${invoice.invoiceNo}`,
          debit: 0,
          credit: Number(payment.amount),
          balance: 0,
        });

        for (const refund of payment.refunds) {
          entries.push({
            date: isoDate(refund.refundedAt),
            type: 'REFUND',
            reference: payment.paymentNo,
            description: `Refund — ${refund.reason}`,
            debit: Number(refund.amount),
            credit: 0,
            balance: 0,
          });
        }
      }
    }

    entries.sort(
      (a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type),
    );

    let balance = 0;
    for (const entry of entries) {
      balance = money(balance + entry.debit - entry.credit);
      entry.balance = balance;
    }

    const totalBilled = money(
      entries.reduce((sum, e) => sum + e.debit, 0),
    );
    const totalPaid = money(entries.reduce((sum, e) => sum + e.credit, 0));

    return {
      studentId,
      enrollments: enrollmentIds,
      entries,
      totalBilled,
      totalPaid,
      outstanding: money(totalBilled - totalPaid),
    };
  }

  /**
   * Clearance for one candidate — the shape M09 exit statuses, M14
   * admit cards and M27 certificates all ask for.
   */
  async clearance(
    enrollmentId: string,
    schoolId: string,
  ): Promise<{ cleared: boolean; outstanding: number; invoiceCount: number }> {
    const dues = await this.duesFor([enrollmentId], schoolId);
    const row = dues.at(0);
    return {
      cleared: !row || row.outstanding <= 0,
      outstanding: row?.outstanding ?? 0,
      invoiceCount: row?.invoiceCount ?? 0,
    };
  }
}
