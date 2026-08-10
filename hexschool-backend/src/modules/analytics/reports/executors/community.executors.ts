import { Injectable } from '@nestjs/common';
import { CertificateReportsService } from '../../../document/services/certificate-reports.service';
import { CommunityReportsService } from '../../../community/services/community-reports.service';
import type { ReportRow, ReportTable } from '../../calc/types';
import {
  defaultWindow,
  money,
  type ReportContext,
  type ReportExecutor,
  type ReportExecutorProvider,
} from '../executor.types';

/**
 * M27's certificate register and M28's complaints / visitors / alumni
 * reports, in one provider because both modules answer the same kind of
 * question: what happened at the front desk, over a window.
 *
 * The complaints register is where the module-level and column-level
 * permissions meet. `CommunityReportsService` already takes an
 * `includeSensitive` flag and shapes the **query** with it (M28's rule:
 * §8's restriction has to shape the query, not gate the endpoint), and
 * the report it returns carries `excludesSensitive` so it can say what it
 * could not see. That flag is passed straight into the sheet's notes —
 * "42 complaints this term" that quietly omits the ones about staff is
 * exactly the number that ends up in a governors' pack meaning something
 * other than what it says.
 */
@Injectable()
export class CommunityReportExecutors implements ReportExecutorProvider {
  constructor(
    private readonly community: CommunityReportsService,
    private readonly certificates: CertificateReportsService,
  ) {}

  executors(): Record<string, ReportExecutor> {
    return {
      'ticket.register': (ctx) => this.ticketRegister(ctx),
      'ticket.summary': (ctx) => this.ticketSummary(ctx),
      'visitor.register': (ctx) => this.visitorRegister(ctx),
      'donation.register': (ctx) => this.donationRegister(ctx),
      'donation.summary': (ctx) => this.donationSummary(ctx),
      'alumni.directory': (ctx) => this.alumniDirectory(ctx),
      'certificate.register': (ctx) => this.certificateRegister(ctx),
      'certificate.summary': (ctx) => this.certificateSummary(ctx),
    };
  }

  private sensitive(ctx: ReportContext): boolean {
    return ctx.isSuperAdmin || ctx.held.has('ticket.sensitive.view');
  }

  private async ticketRegister(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.community.ticketRegister(
      window,
      ctx.schoolId,
      this.sensitive(ctx),
    );

    return {
      title: `Complaints register — ${report.from} to ${report.to}`,
      columns: [
        { key: 'ticketNo', label: 'Ticket no' },
        { key: 'createdAt', label: 'Raised' },
        { key: 'type', label: 'Type' },
        { key: 'category', label: 'Category' },
        { key: 'subject', label: 'Subject', width: 40 },
        { key: 'raisedByType', label: 'From' },
        { key: 'priority', label: 'Priority' },
        { key: 'status', label: 'Status' },
        { key: 'resolvedAt', label: 'Resolved' },
        { key: 'rating', label: 'Rating', type: 'number' },
      ],
      rows: report.rows.map((row) => ({
        ticketNo: row.ticketNo,
        createdAt: row.createdAt,
        type: row.type,
        category: row.category,
        subject: row.subject,
        raisedByType: row.raisedByType,
        priority: row.priority,
        status: row.status,
        resolvedAt: row.resolvedAt,
        rating: row.satisfactionRating,
      })),
      summary: [{ label: 'Tickets', value: report.rows.length }],
      notes: report.excludesSensitive
        ? [
            'Restricted complaints are NOT in this register — the requester does not hold ticket.sensitive.view, so the count is of what they may read rather than of everything raised.',
          ]
        : [],
    };
  }

  private async ticketSummary(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.community.ticketSummary(
      window,
      ctx.schoolId,
      this.sensitive(ctx),
    );

    const rows: ReportRow[] = [
      ...report.byStatus.map((row) => ({
        dimension: 'Status',
        value: row.status,
        count: row.count,
      })),
      ...report.byCategory.map((row) => ({
        dimension: 'Category',
        value: row.category,
        count: row.count,
      })),
      ...report.byPriority.map((row) => ({
        dimension: 'Priority',
        value: row.priority,
        count: row.count,
      })),
    ];

    return {
      title: `Complaints summary — ${report.from} to ${report.to}`,
      columns: [
        { key: 'dimension', label: 'Dimension' },
        { key: 'value', label: 'Value', width: 22 },
        { key: 'count', label: 'Tickets', type: 'number' },
      ],
      rows,
      summary: [
        { label: 'Total', value: report.total },
        { label: 'Resolved', value: report.resolution.resolved },
        {
          label: 'Avg resolution (h)',
          value: report.resolution.avgResolutionHours,
        },
        {
          label: 'Avg first response (h)',
          value: report.resolution.avgFirstResponseHours,
        },
        {
          label: 'SLA compliance',
          value: `${report.resolution.slaCompliancePercent}%`,
        },
        { label: 'Breached now', value: report.breachedNow },
        { label: 'Satisfaction', value: report.satisfaction.average },
      ],
      notes: [
        'Only resolved tickets count towards the averages; the live backlog is reported separately as "breached now".',
        ...(report.excludesSensitive
          ? [
              'Restricted complaints are excluded — this is a summary of what the requester may read.',
            ]
          : []),
      ],
    };
  }

  private async visitorRegister(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.community.visitorRegister(window, ctx.schoolId);
    return {
      title: `Visitor register — ${report.from} to ${report.to}`,
      columns: [
        { key: 'checkIn', label: 'Arrived' },
        { key: 'name', label: 'Visitor', width: 26 },
        { key: 'phone', label: 'Phone' },
        { key: 'purpose', label: 'Purpose' },
        { key: 'whomToMeet', label: 'To see', width: 24 },
        { key: 'gatePassNo', label: 'Gate pass' },
        { key: 'checkOut', label: 'Left' },
        { key: 'minutes', label: 'Minutes', type: 'number' },
        { key: 'autoCheckedOut', label: 'Auto checked out' },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Visits', value: report.stats.total },
        { label: 'Still inside', value: report.stats.inside },
        { label: 'Auto checked out', value: report.stats.autoCheckedOut },
        { label: 'Average stay (min)', value: report.stats.avgStayMinutes },
      ],
      notes: [
        'In arrival order, with the auto-checkout flag as its own column: it says which departures the school witnessed and which the system wrote at nine o’clock because nobody signed out.',
      ],
    };
  }

  private async donationRegister(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.community.donationRegister(window, ctx.schoolId);
    return {
      title: `Donation register — ${report.from} to ${report.to}`,
      columns: [
        { key: 'receiptNo', label: 'Receipt no' },
        { key: 'receivedAt', label: 'Received' },
        { key: 'donorName', label: 'Donor', width: 28 },
        { key: 'donorPhone', label: 'Phone' },
        { key: 'purpose', label: 'Purpose', width: 24 },
        { key: 'method', label: 'Method' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'cancelled', label: 'Cancelled' },
        { key: 'cancelledReason', label: 'Cancellation reason', width: 28 },
      ],
      rows: report.rows.map((row) => ({
        receiptNo: row.receiptNo,
        receivedAt: row.receivedAt,
        donorName: row.donorName,
        donorPhone: row.donorPhone,
        purpose: row.purpose,
        method: row.method,
        amount: money(row.amount),
        cancelled: row.cancelledAt !== null,
        cancelledReason: row.cancelledReason,
      })),
      notes: [
        'A receipt is immutable: a mistake is CANCELLED with a reason and stays in the register, out of the money and in the count.',
      ],
    };
  }

  private async donationSummary(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.community.donationSummary(window, ctx.schoolId);

    const rows: ReportRow[] = [
      ...report.byPurpose.map((row) => ({
        dimension: 'Purpose',
        label: row.label,
        count: row.count,
        amount: row.amount,
        percent: row.percent,
      })),
      ...report.byMethod.map((row) => ({
        dimension: 'Method',
        label: row.label,
        count: row.count,
        amount: row.amount,
        percent: row.percent,
      })),
      ...report.byMonth.map((row) => ({
        dimension: 'Month',
        label: row.label,
        count: row.count,
        amount: row.amount,
        percent: row.percent,
      })),
      ...report.topDonors.map((row) => ({
        dimension: 'Top donor',
        label: row.name,
        count: row.count,
        amount: row.amount,
        percent: null,
      })),
    ];

    return {
      title: `Donation summary — ${report.from} to ${report.to}`,
      columns: [
        { key: 'dimension', label: 'Dimension' },
        { key: 'label', label: 'Value', width: 28 },
        { key: 'count', label: 'Gifts', type: 'number' },
        { key: 'amount', label: 'Amount', type: 'money' },
        { key: 'percent', label: 'Share', type: 'percent' },
      ],
      rows,
      summary: [
        { label: 'Received', value: report.totals.received },
        { label: 'Total', value: report.totals.total },
        { label: 'Largest', value: report.totals.largest },
        { label: 'Average', value: report.totals.average },
        { label: 'Cancelled', value: report.totals.cancelled },
        { label: 'From alumni', value: report.totals.fromAlumniAmount },
      ],
    };
  }

  private async alumniDirectory(ctx: ReportContext): Promise<ReportTable> {
    const report = await this.community.alumniDirectory(ctx.schoolId);
    return {
      title: 'Alumni directory',
      columns: [
        { key: 'batchYear', label: 'Batch', type: 'number' },
        { key: 'name', label: 'Name', width: 28 },
        { key: 'lastClass', label: 'Last class' },
        { key: 'profession', label: 'Profession', width: 24 },
        { key: 'organization', label: 'Organization', width: 26 },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email', width: 28 },
        { key: 'isPublicProfile', label: 'Public profile' },
      ],
      rows: report.rows.map((row) => ({
        batchYear: row.batchYear,
        name: row.name,
        lastClass: row.lastClass,
        profession: row.profession,
        organization: row.organization,
        phone: row.phone,
        email: row.email,
        isPublicProfile: row.isPublicProfile,
      })),
      summary: [{ label: 'Approved alumni', value: report.total }],
      notes: [
        'The internal directory: it carries contact details, which the public one deliberately never does.',
      ],
    };
  }

  private async certificateRegister(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.certificates.register(window, ctx.schoolId);
    return {
      title: `Certificate issuance register — ${report.from} to ${report.to}`,
      columns: [
        { key: 'certificateNo', label: 'Certificate no' },
        { key: 'issueDate', label: 'Issued', type: 'date' },
        { key: 'type', label: 'Type' },
        { key: 'studentUid', label: 'Student ID' },
        { key: 'studentName', label: 'Student', width: 26 },
        { key: 'className', label: 'Class' },
        { key: 'session', label: 'Session' },
        { key: 'issueKind', label: 'Kind' },
        { key: 'status', label: 'Status' },
        { key: 'originalNo', label: 'Duplicate of' },
        { key: 'clearanceWaived', label: 'Clearance waived' },
        { key: 'isLegacy', label: 'Legacy' },
        { key: 'revokedReason', label: 'Revocation reason', width: 30 },
      ],
      rows: report.rows.map((row) => ({ ...row })),
      summary: [
        { label: 'Issued', value: report.totals.issued },
        { label: 'Duplicates', value: report.totals.duplicates },
        { label: 'Revoked', value: report.totals.revoked },
        { label: 'Legacy backfill', value: report.totals.legacy },
      ],
      notes: [
        'Class and session come from the frozen snapshot, not from the live enrollment — a register records what was issued, not what the school currently believes.',
      ],
    };
  }

  private async certificateSummary(ctx: ReportContext): Promise<ReportTable> {
    const window = defaultWindow(ctx.params);
    const report = await this.certificates.summary(window, ctx.schoolId);
    return {
      title: `Certificates by type — ${report.from} to ${report.to}`,
      columns: [
        { key: 'type', label: 'Type', width: 28 },
        { key: 'issued', label: 'Issued', type: 'number' },
        { key: 'revoked', label: 'Revoked', type: 'number' },
        { key: 'total', label: 'Total', type: 'number' },
      ],
      rows: report.byType.map((row) => ({ ...row })),
      summary: [
        { label: 'Issued', value: report.totals.issued },
        { label: 'Revoked', value: report.totals.revoked },
        { label: 'Total', value: report.totals.total },
      ],
    };
  }
}
