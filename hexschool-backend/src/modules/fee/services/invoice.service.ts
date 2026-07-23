import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  FeeHeadType,
  InvoiceStatus,
  SessionStatus,
} from '../../../common/constants';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { SessionsService } from '../../academic/services/sessions.service';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  EnrollmentsRepository,
  EnrollmentWithRelations,
} from '../../enrollment/repositories/enrollments.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import {
  BillableHead,
  buildInvoice,
  Concession,
  prorationFactor,
} from '../calc/invoice.engine';
import { deriveStatus } from '../calc/fine.engine';
import { money } from '../calc/money.util';
import {
  CancelInvoiceDto,
  GenerateInvoicesDto,
  InvoiceQueryDto,
} from '../dto';
import { FeeOverridesRepository } from '../repositories/fee-overrides.repository';
import { FeeStructuresRepository } from '../repositories/fee-structures.repository';
import {
  InvoiceDetail,
  InvoicesRepository,
  InvoiceWithRelations,
} from '../repositories/invoices.repository';
import { FeeSettingsService } from './fee-settings.service';

export interface GenerationPreviewRow {
  enrollmentId: string;
  studentUid: string;
  studentName: string;
  rollNo: number;
  className: string;
  subtotal: number;
  discountTotal: number;
  payable: number;
  prorated: boolean;
  skipped?: string;
}

export interface GenerationResult {
  dryRun: boolean;
  billingMonth: string | null;
  generated: number;
  skipped: number;
  totalPayable: number;
  rows: GenerationPreviewRow[];
}

/**
 * Invoice generation (roadmap M16 §4).
 *
 * Two modes behind one endpoint:
 *
 *   - **the monthly batch** (`billingMonth` present) — every
 *     RECURRING_MONTHLY head of the candidate's class, prorated for a
 *     mid-month joiner, idempotent per (enrollment, month);
 *   - **an ad-hoc run** (`lines` present) — bill exactly what was asked
 *     for, as often as needed. An exam fee for class 8 is not a monthly
 *     charge and must not collide with one.
 *
 * **Idempotency is the rule that matters.** A monthly batch re-run must
 * never double-bill, so it is guarded twice: the service skips
 * candidates who already have an invoice for the month, and
 * `uq_invoices_enrollment_month` refuses one anyway if two runs race.
 *
 * `dryRun` returns exactly what would be written, which is what the
 * generation wizard previews ("N invoices, total ৳X").
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly structures: FeeStructuresRepository,
    private readonly overrides: FeeOverridesRepository,
    private readonly enrollments: EnrollmentsRepository,
    private readonly sessions: SessionsService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly config: FeeSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(
    query: InvoiceQueryDto,
    schoolId: string,
  ): Promise<InvoiceWithRelations[]> {
    const sessionId = await this.resolveSession(query.sessionId, schoolId);
    return this.invoices.findMany(schoolId, {
      sessionId,
      classId: query.classId,
      sectionId: query.sectionId,
      enrollmentId: query.enrollmentId,
      status: query.status,
      search: query.search,
      billingMonth: query.billingMonth
        ? parseDate(`${query.billingMonth}-01`)
        : undefined,
    });
  }

  async getDetail(id: string, schoolId: string): Promise<InvoiceDetail> {
    const invoice = await this.invoices.findDetail(id, schoolId);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  async summary(schoolId: string, sessionId?: string) {
    const resolved = await this.resolveSession(sessionId, schoolId);
    const byStatus = await this.invoices.countByStatus(schoolId, resolved);
    const total = byStatus.reduce((sum, row) => sum + row.count, 0);
    return { sessionId: resolved, total, byStatus };
  }

  // ── generation ──────────────────────────────────────────────────────

  async generate(
    dto: GenerateInvoicesDto,
    actor: AccessTokenPayload,
  ): Promise<GenerationResult> {
    const schoolId = actor.schoolId;
    const sessionId = await this.resolveSession(dto.sessionId, schoolId);
    const session = await this.sessions.getById(sessionId, schoolId);
    this.assertSessionWritable(session);

    const adHoc = !dto.billingMonth;
    if (adHoc && (!dto.lines || dto.lines.length === 0)) {
      throw new BadRequestException(
        'Provide a billingMonth for the monthly batch, or lines for an ad-hoc invoice',
      );
    }

    const config = await this.config.load(schoolId);
    const billingMonth = dto.billingMonth
      ? parseDate(`${dto.billingMonth}-01`)
      : null;

    const candidates = await this.resolveCandidates(dto, sessionId, schoolId);
    if (candidates.length === 0) {
      throw new BadRequestException('No active candidates match that scope');
    }

    // One query for every concession in force, rather than one per
    // candidate — a 2,000-student batch would otherwise be 2,000 reads.
    const effectiveOn = billingMonth ?? new Date();
    const allOverrides = await this.overrides.findEffective(
      candidates.map((c) => c.id),
      effectiveOn,
    );
    const overridesByEnrollment = new Map<string, Concession[]>();
    for (const row of allOverrides) {
      overridesByEnrollment.set(row.enrollmentId, [
        ...(overridesByEnrollment.get(row.enrollmentId) ?? []),
        {
          feeHeadId: row.feeHeadId,
          type: row.type,
          value: Number(row.value),
          reason: row.reason,
        },
      ]);
    }

    const dueDate = dto.dueDate
      ? parseDate(dto.dueDate)
      : this.defaultDueDate(billingMonth, config.dueDayOfMonth);
    const issueDate = billingMonth ?? new Date();
    if (dueDate < issueDate) {
      throw new BadRequestException('Due date must be on or after the issue date');
    }

    const rows: GenerationPreviewRow[] = [];
    const writes: Array<{
      enrollment: EnrollmentWithRelations;
      items: Prisma.InvoiceItemUncheckedCreateInput[];
      subtotal: number;
      discountTotal: number;
      payable: number;
    }> = [];

    for (const enrollment of candidates) {
      const base = {
        enrollmentId: enrollment.id,
        studentUid: enrollment.student.studentUid,
        studentName:
          `${enrollment.student.firstName} ${enrollment.student.lastName}`.trim(),
        rollNo: enrollment.rollNo,
        className: enrollment.class.name,
      };

      // Idempotency: never bill the same month twice.
      if (billingMonth) {
        const exists = await this.invoices.existsForMonth(
          enrollment.id,
          billingMonth,
        );
        if (exists) {
          rows.push({
            ...base,
            subtotal: 0,
            discountTotal: 0,
            payable: 0,
            prorated: false,
            skipped: 'Already invoiced for this month',
          });
          continue;
        }
      }

      const heads = await this.billableHeads(
        dto,
        enrollment,
        sessionId,
        schoolId,
      );
      if (heads.length === 0) {
        rows.push({
          ...base,
          subtotal: 0,
          discountTotal: 0,
          payable: 0,
          prorated: false,
          skipped: 'No fee structure applies to this class',
        });
        continue;
      }

      const proration = this.prorationFor(
        enrollment,
        billingMonth,
        config.prorateEnabled,
        config.prorateIncludeJoinDay,
      );

      const built = buildInvoice(
        heads,
        overridesByEnrollment.get(enrollment.id) ?? [],
        proration,
      );

      if (built.lines.length === 0) {
        rows.push({
          ...base,
          subtotal: 0,
          discountTotal: 0,
          payable: 0,
          prorated: proration < 1,
          skipped: 'Nothing billable after proration and concessions',
        });
        continue;
      }

      rows.push({
        ...base,
        subtotal: built.subtotal,
        discountTotal: built.discountTotal,
        payable: built.payable,
        prorated: proration < 1,
      });

      writes.push({
        enrollment,
        subtotal: built.subtotal,
        discountTotal: built.discountTotal,
        payable: built.payable,
        items: built.lines.map((line) => ({
          schoolId,
          invoiceId: '', // set by the repository
          feeHeadId: line.feeHeadId,
          description: line.description,
          amount: line.amount,
          discount: line.discount,
          note: line.note,
        })),
      });
    }

    const totalPayable = money(
      writes.reduce((sum, write) => sum + write.payable, 0),
    );

    if (dto.dryRun) {
      return {
        dryRun: true,
        billingMonth: dto.billingMonth ?? null,
        generated: writes.length,
        skipped: rows.length - writes.length,
        totalPayable,
        rows,
      };
    }

    const school = await this.schools.findByIdOrFail(schoolId);
    // The counter is keyed per month, matching the `{YY}{MM}` in the
    // pattern — otherwise January's INV-2601-000001 and February's would
    // collide on the sequence rather than on the rendered number.
    const counterKey = `invoice:${issueDate.getUTCFullYear()}${String(
      issueDate.getUTCMonth() + 1,
    ).padStart(2, '0')}`;

    // The whole batch is one transaction: the sequence service claims
    // gap-free numbers inside it, so a rollback returns them (M07).
    await this.invoices.withTransaction(async (tx) => {
      for (const write of writes) {
        const invoiceNo = await this.sequences.nextDocumentNumber({
          schoolId,
          counterKey,
          pattern: config.invoicePrefix,
          schoolCode: school.code,
          date: issueDate,
          tx,
        });

        await this.invoices.create(
          {
            schoolId,
            invoiceNo,
            enrollmentId: write.enrollment.id,
            sessionId,
            billingMonth,
            issueDate,
            dueDate,
            subtotal: write.subtotal,
            discountTotal: write.discountTotal,
            fineTotal: 0,
            paidTotal: 0,
            payable: write.payable,
            status: InvoiceStatus.UNPAID,
            remarks: dto.remarks ?? null,
            createdBy: actor.sub,
            updatedBy: actor.sub,
          },
          write.items,
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'Invoice',
      entityId: sessionId,
      newValues: {
        action: 'GENERATE',
        sessionId,
        billingMonth: dto.billingMonth ?? null,
        generated: writes.length,
        skipped: rows.length - writes.length,
        totalPayable,
      },
    });

    this.logger.log(
      `Generated ${writes.length} invoice(s) totalling ${totalPayable} for ${
        dto.billingMonth ?? 'ad-hoc'
      }`,
    );

    return {
      dryRun: false,
      billingMonth: dto.billingMonth ?? null,
      generated: writes.length,
      skipped: rows.length - writes.length,
      totalPayable,
      rows,
    };
  }

  /**
   * Cancel an invoice. Refused while money is on it — the roadmap's
   * rule is that a PAID invoice must be refunded first, and a partially
   * paid one is the same problem in miniature.
   */
  async cancel(
    id: string,
    dto: CancelInvoiceDto,
    actor: AccessTokenPayload,
  ): Promise<InvoiceDetail> {
    const invoice = await this.getDetail(id, actor.schoolId);

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new ConflictException('This invoice is already cancelled');
    }
    if (Number(invoice.paidTotal) > 0) {
      throw new ConflictException(
        `${invoice.invoiceNo} has ${Number(invoice.paidTotal)} BDT against it — refund the payment before cancelling`,
      );
    }

    await this.invoices.update(id, {
      status: InvoiceStatus.CANCELLED,
      cancelledAt: new Date(),
      cancelReason: dto.reason.trim(),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Invoice',
      entityId: id,
      oldValues: { status: invoice.status },
      newValues: { status: InvoiceStatus.CANCELLED, reason: dto.reason },
    });

    return this.getDetail(id, actor.schoolId);
  }

  /**
   * Recompute an invoice's paid total and status from its payments.
   * Every money path funnels through here so a refund and a payment can
   * never disagree about what PARTIAL means.
   */
  async refreshStatus(
    invoice: {
      id: string;
      payable: Prisma.Decimal | number;
      dueDate: Date;
      status: InvoiceStatus;
    },
    paidTotal: number,
    fullyRefunded: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<InvoiceStatus> {
    const status = deriveStatus({
      payable: Number(invoice.payable),
      paidTotal,
      dueDate: isoDate(invoice.dueDate),
      today: isoDate(new Date()),
      cancelled: invoice.status === InvoiceStatus.CANCELLED,
      fullyRefunded,
    });

    await this.invoices.update(
      invoice.id,
      { paidTotal: money(paidTotal), status },
      tx,
    );
    return status;
  }

  // ── internals ───────────────────────────────────────────────────────

  private async resolveCandidates(
    dto: GenerateInvoicesDto,
    sessionId: string,
    schoolId: string,
  ): Promise<EnrollmentWithRelations[]> {
    if (dto.enrollmentIds && dto.enrollmentIds.length > 0) {
      const found: EnrollmentWithRelations[] = [];
      for (const id of dto.enrollmentIds) {
        const enrollment = await this.enrollments.findDetail(id, schoolId);
        if (enrollment) found.push(enrollment);
      }
      return found;
    }
    if (dto.sectionId) {
      return this.enrollments.findSectionRoster(dto.sectionId, schoolId);
    }
    if (dto.classId) {
      return this.enrollments.findClassRoster(dto.classId, sessionId, schoolId);
    }
    return this.enrollments.findLiveForSession(sessionId, schoolId);
  }

  /**
   * The heads to bill this candidate. A monthly run takes every
   * RECURRING_MONTHLY structure; an ad-hoc run bills exactly the lines
   * it was given, priced from the structure when no amount was passed.
   */
  private async billableHeads(
    dto: GenerateInvoicesDto,
    enrollment: EnrollmentWithRelations,
    sessionId: string,
    schoolId: string,
  ): Promise<BillableHead[]> {
    const structures = await this.structures.findBillable(
      schoolId,
      sessionId,
      enrollment.classId,
      enrollment.groupId,
    );

    if (dto.lines && dto.lines.length > 0) {
      return dto.lines.map((line) => {
        const structure = structures.find(
          (s) => s.feeHeadId === line.feeHeadId,
        );
        return {
          feeHeadId: line.feeHeadId,
          feeHeadName:
            line.description?.trim() ||
            structure?.feeHead.name ||
            'Fee',
          amount: money(line.amount),
          // An ad-hoc charge is never prorated — it is not a monthly fee.
          prorated: false,
        };
      });
    }

    return structures
      .filter((s) => s.feeHead.type === FeeHeadType.RECURRING_MONTHLY)
      .map((s) => ({
        feeHeadId: s.feeHeadId,
        feeHeadName: s.feeHead.name,
        amount: Number(s.amount),
        prorated: true,
      }));
  }

  /**
   * How much of the month this candidate owes. Only ever less than 1
   * for someone who enrolled *during* the month being billed — which is
   * finally what `enrollments.enrollment_date` is for on the fee side
   * (M11 left it for us).
   */
  private prorationFor(
    enrollment: EnrollmentWithRelations,
    billingMonth: Date | null,
    enabled: boolean,
    includeJoinDay: boolean,
  ): number {
    if (!enabled || !billingMonth) return 1;

    const joined = enrollment.enrollmentDate;
    const monthStart = billingMonth;
    const year = monthStart.getUTCFullYear();
    const month = monthStart.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    // Joined before this month → full month. Joined after it → the
    // caller should not be billing them at all, but 0 is the honest
    // answer rather than a full charge.
    if (
      joined.getUTCFullYear() < year ||
      (joined.getUTCFullYear() === year && joined.getUTCMonth() < month)
    ) {
      return 1;
    }
    if (
      joined.getUTCFullYear() > year ||
      (joined.getUTCFullYear() === year && joined.getUTCMonth() > month)
    ) {
      return 0;
    }

    return prorationFactor({
      daysInMonth,
      billableFromDay: joined.getUTCDate(),
      includeJoinDay,
    });
  }

  private defaultDueDate(billingMonth: Date | null, dueDay: number): Date {
    const base = billingMonth ?? new Date();
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(dueDay, daysInMonth)));
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

  private assertSessionWritable(session: {
    name: string;
    status: SessionStatus;
  }): void {
    if (
      session.status === SessionStatus.COMPLETED ||
      session.status === SessionStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        `Session ${session.name} is ${session.status} — invoices are read-only`,
      );
    }
  }
}
