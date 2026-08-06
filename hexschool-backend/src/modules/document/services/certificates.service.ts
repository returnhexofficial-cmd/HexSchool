import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CertificateIssueKind,
  CertificateStatus,
  CertificateType,
  StudentStatus,
  UserType,
} from '../../../common/constants';
import type { PrismaClientLike } from '../../../common/database/base.repository';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { renderTemplate } from '../../communication/calc/template.engine';
import { PermissionsService } from '../../rbac/services/permissions.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import { StudentsService } from '../../student/services/students.service';
import {
  counterKey,
  isUsableCertificateNumber,
  normalizeLegacyNumber,
  resolvePattern,
} from '../calc/certificate-number.util';
import {
  canIssue,
  canReissue,
  canRevoke,
  type LifecycleVerdict,
} from '../calc/certificate.engine';
import type { ClearanceVerdict } from '../calc/clearance.engine';
import { generateVerifyCode, verifyUrl } from '../calc/verify-code.util';
import type {
  CertificateQueryDto,
  CreateCertificateDto,
  LegacyCertificateDto,
  ReissueCertificateDto,
  RevokeCertificateDto,
} from '../dto';
import {
  CertificatesRepository,
  type CertificateWithRelations,
} from '../repositories/certificates.repository';
import { CertificateTemplatesRepository } from '../repositories/certificate-templates.repository';
import { ClearanceService } from './clearance.service';
import { DocumentNotificationsService } from './document-notifications.service';
import { DocumentSettingsService } from './document-settings.service';
import { SnapshotBuilderService } from './snapshot-builder.service';

export interface CertificateResult {
  certificate: CertificateWithRelations;
  clearance: ClearanceVerdict | null;
  warnings: string[];
}

/** How many fresh codes to try before giving up — see `claimVerifyCode`. */
const VERIFY_CODE_ATTEMPTS = 5;

/**
 * Issuing, revoking and re-issuing certificates — the register.
 *
 * **The single rule the whole service is built around**: once a
 * certificate is ISSUED, nothing in this file edits it. Its number, its
 * verify code, its snapshot and the markup it was rendered through are all
 * written in one transaction and never touched again, because the document
 * is a physical object in somebody else's possession (roadmap §6, and the
 * M15/M20 immutability rule in a third ledger). A wrong name is a revoke
 * plus a CORRECTION; a lost original is a DUPLICATE. Both stay in the
 * register, linked.
 *
 * The **number is claimed inside the transaction** so a rolled-back issue
 * returns it (SequenceService's gap-free guarantee) — which is what makes
 * "sequential per type/year, never reused" true rather than aspirational.
 */
@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly certificates: CertificatesRepository,
    private readonly templates: CertificateTemplatesRepository,
    private readonly snapshots: SnapshotBuilderService,
    private readonly clearance: ClearanceService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly students: StudentsService,
    private readonly permissions: PermissionsService,
    private readonly notifications: DocumentNotificationsService,
    private readonly config: DocumentSettingsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────

  async list(query: CertificateQueryDto, actor: AccessTokenPayload) {
    const { rows, total } = await this.certificates.findMany(
      actor.schoolId,
      {
        type: query.type,
        status: query.status,
        studentId: query.studentId,
        sessionId: query.sessionId,
        from: query.from ? parseDate(query.from) : undefined,
        to: query.to ? this.endOfDay(parseDate(query.to)) : undefined,
        search: query.search,
      },
      query.page,
      query.limit,
    );
    return {
      data: rows,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async get(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<CertificateWithRelations> {
    const certificate = await this.certificates.findDetail(id, actor.schoolId);
    if (!certificate) {
      throw new NotFoundException(`Certificate ${id} not found`);
    }
    return certificate;
  }

  /** The wizard's clearance panel, before anything is written. */
  async checkClearance(
    studentId: string,
    type: CertificateType,
    actor: AccessTokenPayload,
  ): Promise<ClearanceVerdict> {
    return this.clearance.check({
      schoolId: actor.schoolId,
      studentId,
      type: type,
      override: await this.hasOverride(actor),
    });
  }

  // ── issue ───────────────────────────────────────────────────────────

  async create(
    dto: CreateCertificateDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateResult> {
    const config = await this.config.load(actor.schoolId);
    if (!config.enabled) {
      throw new ConflictException(
        'Certificate issuing is switched off (documents.enabled).',
      );
    }

    const template = dto.templateId
      ? await this.loadTemplate(dto.templateId, actor.schoolId)
      : null;

    const existingIssued = await this.certificates.countIssuedOfType(
      actor.schoolId,
      dto.studentId,
      dto.type,
    );

    const verdict = canIssue({
      status: 'DRAFT',
      type: dto.type,
      existingIssued,
      studentDeleted: false,
      templateType: template?.type ?? null,
      templateActive: template?.isActive,
    });
    this.assertVerdict(verdict);

    // A DRAFT carries no number and no code (`chk_certificates_status_
    // evidence`), so a save-for-later costs the school nothing and burns
    // no sequence value.
    if (dto.issue !== true) {
      return this.createDraft(dto, actor, verdict.warnings);
    }

    return this.issue(dto, actor, {
      template,
      config,
      warnings: verdict.warnings,
      kind: CertificateIssueKind.ORIGINAL,
      originalId: null,
    });
  }

  /** Issue an existing draft (the wizard's confirm step on a saved row). */
  async issueDraft(
    id: string,
    dto: CreateCertificateDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateResult> {
    const draft = await this.get(id, actor);
    const verdict = canIssue({
      status: draft.status,
      type: draft.type,
      existingIssued: await this.certificates.countIssuedOfType(
        actor.schoolId,
        draft.studentId,
        draft.type,
      ),
      studentDeleted: draft.student.deletedAt !== null,
      templateType: draft.template?.type ?? null,
      templateActive: draft.template?.isActive,
    });
    this.assertVerdict(verdict);

    const config = await this.config.load(actor.schoolId);
    return this.issue(
      {
        ...dto,
        studentId: draft.studentId,
        type: draft.type,
        templateId: draft.templateId ?? undefined,
        enrollmentId: draft.enrollmentId ?? undefined,
      },
      actor,
      {
        template: draft.templateId
          ? await this.loadTemplate(draft.templateId, actor.schoolId)
          : null,
        config,
        warnings: verdict.warnings,
        kind: CertificateIssueKind.ORIGINAL,
        originalId: null,
        replaceDraftId: id,
      },
    );
  }

  /**
   * Roadmap §8's two re-issue cases. A DUPLICATE reprints a still-valid
   * certificate under its own number, watermarked and referencing the
   * original; a CORRECTION replaces one that has been revoked.
   */
  async reissue(
    id: string,
    dto: ReissueCertificateDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateResult> {
    const original = await this.get(id, actor);
    const verdict = canReissue({
      kind: dto.kind,
      originalStatus: original.status,
    });
    this.assertVerdict(verdict);

    const config = await this.config.load(actor.schoolId);
    return this.issue(
      {
        studentId: original.studentId,
        type: original.type,
        templateId: original.templateId ?? undefined,
        enrollmentId: original.enrollmentId ?? undefined,
        remarks: dto.remarks,
        notify: dto.notify,
        clearanceOverrideReason: dto.clearanceOverrideReason,
        issue: true,
        // The consequence has already happened — a student who was marked
        // TRANSFERRED by the original TC must not be marked again, and a
        // duplicate must not re-trigger it.
        confirmTransfer: false,
      },
      actor,
      {
        template: original.templateId
          ? await this.loadTemplate(original.templateId, actor.schoolId)
          : null,
        config,
        warnings: verdict.warnings,
        kind:
          dto.kind === 'DUPLICATE'
            ? CertificateIssueKind.DUPLICATE
            : CertificateIssueKind.CORRECTION,
        originalId: original.id,
        originalNo: original.certificateNo,
        skipTransfer: true,
      },
    );
  }

  /**
   * Roadmap §8's legacy backfill: a certificate the school issued on paper
   * before this system existed, entered with **its own number**.
   *
   * It bypasses the sequence deliberately — the number is a fact about a
   * document that already exists, not one this system is choosing — which
   * is exactly why `certificate.legacy` is a separate permission the office
   * does not hold. It still gets a verify code, because the point of
   * entering it is that somebody can check it.
   */
  async createLegacy(
    dto: LegacyCertificateDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateResult> {
    const number = normalizeLegacyNumber(dto.certificateNo);
    if (!isUsableCertificateNumber(number)) {
      throw new BadRequestException('That certificate number is not usable');
    }
    if (await this.certificates.numberTaken(actor.schoolId, number)) {
      throw new ConflictException(
        `Certificate number ${number} is already in the register. A number is never reused, even for a pre-system document.`,
      );
    }

    const config = await this.config.load(actor.schoolId);
    const issueDate = isoDate(parseDate(dto.issueDate));

    const created = await this.certificates.withTransaction(async (tx) => {
      const code = await this.claimVerifyCode();
      const built = await this.snapshots.build({
        schoolId: actor.schoolId,
        studentId: dto.studentId,
        type: dto.type,
        conduct: config.conductDefault,
        extra: dto.extra,
        issue: {
          certificateNo: number,
          verifyCode: code,
          verifyUrl: verifyUrl(config.verifyUrlBase, code),
          issueDate,
        },
      });

      return this.certificates.create(
        {
          schoolId: actor.schoolId,
          studentId: dto.studentId,
          enrollmentId: built.enrollmentId,
          sessionId: dto.sessionId ?? built.sessionId,
          templateId: null,
          type: dto.type,
          certificateNo: number,
          verifyCode: code,
          status: CertificateStatus.ISSUED,
          issueKind: CertificateIssueKind.ORIGINAL,
          dataSnapshot: built.snapshot,
          // No `body_html`: there is no layout, because the school printed
          // this one on a typewriter. Re-printing it is not something this
          // system can offer, and pretending otherwise with a default
          // template would produce a document that never existed.
          bodyHtml: null,
          isLegacy: true,
          issuedBy: actor.sub,
          issuedAt: new Date(`${issueDate}T00:00:00.000Z`),
          remarks: dto.remarks?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
    });

    this.audit.set({
      entityType: 'Certificate',
      entityId: created.id,
      newValues: {
        certificateNo: number,
        type: dto.type,
        isLegacy: true,
        issueDate,
      },
    });

    return {
      certificate: await this.get(created.id, actor),
      clearance: null,
      warnings: [
        'Entered as a pre-system certificate. It has a verify code and appears in the register, but there is no stored layout, so it cannot be re-printed from here.',
      ],
    };
  }

  // ── revoke ──────────────────────────────────────────────────────────

  async revoke(
    id: string,
    dto: RevokeCertificateDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateResult> {
    const existing = await this.get(id, actor);
    this.assertVerdict(canRevoke(existing.status));

    await this.certificates.update(id, {
      status: CertificateStatus.REVOKED,
      revokedBy: actor.sub,
      revokedAt: new Date(),
      revokedReason: dto.reason.trim(),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Certificate',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: CertificateStatus.REVOKED, reason: dto.reason },
    });

    const config = await this.config.load(actor.schoolId);
    if (dto.notify ?? config.notifyOnIssue) {
      await this.notifications.certificateRevoked(
        actor.schoolId,
        existing,
        dto.reason.trim(),
      );
    }

    return {
      certificate: await this.get(id, actor),
      clearance: null,
      warnings: [
        // Roadmap §4: the file survives. Deleting it would leave the
        // verification page unable to say what was revoked, which is the
        // one thing whoever is holding the paper needs to hear.
        'The certificate file and the register entry are kept. Public verification now reports it as REVOKED, with the reason.',
      ],
    };
  }

  /** A DRAFT may be deleted — nothing left the building. */
  async removeDraft(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor);
    if (existing.status !== CertificateStatus.DRAFT) {
      throw new ConflictException(
        `Only a draft can be deleted. Revoke ${existing.certificateNo} instead — it has already been issued.`,
      );
    }
    await this.certificates.softDelete(id);
    this.audit.set({
      entityType: 'Certificate',
      entityId: id,
      oldValues: { status: existing.status, type: existing.type },
    });
  }

  // ── the issue transaction ───────────────────────────────────────────

  private async createDraft(
    dto: CreateCertificateDto,
    actor: AccessTokenPayload,
    warnings: string[],
  ): Promise<CertificateResult> {
    const config = await this.config.load(actor.schoolId);
    const built = await this.snapshots.build({
      schoolId: actor.schoolId,
      studentId: dto.studentId,
      type: dto.type,
      conduct: dto.conduct?.trim() || config.conductDefault,
      enrollmentId: dto.enrollmentId,
      examId: dto.examId,
      extra: dto.extra,
      // A draft's snapshot is provisional and is rebuilt at issue — these
      // placeholders never reach a printed page.
      issue: {
        certificateNo: '',
        verifyCode: '',
        verifyUrl: '',
        issueDate: isoDate(new Date()),
      },
    });

    const created = await this.certificates.create({
      schoolId: actor.schoolId,
      studentId: dto.studentId,
      enrollmentId: built.enrollmentId,
      sessionId: built.sessionId,
      templateId: dto.templateId ?? null,
      type: dto.type,
      status: CertificateStatus.DRAFT,
      issueKind: CertificateIssueKind.ORIGINAL,
      dataSnapshot: built.snapshot,
      remarks: dto.remarks?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Certificate',
      entityId: created.id,
      newValues: { type: dto.type, status: CertificateStatus.DRAFT },
    });

    const clearance = await this.clearance.check({
      schoolId: actor.schoolId,
      studentId: dto.studentId,
      type: dto.type,
      override: await this.hasOverride(actor),
    });

    return {
      certificate: await this.get(created.id, actor),
      clearance,
      warnings: [
        ...warnings,
        ...(built.completeness ? [built.completeness] : []),
        ...clearance.warnings,
      ],
    };
  }

  private async issue(
    dto: CreateCertificateDto,
    actor: AccessTokenPayload,
    context: {
      template: Awaited<ReturnType<CertificatesService['loadTemplate']>> | null;
      config: Awaited<ReturnType<DocumentSettingsService['load']>>;
      warnings: string[];
      kind: CertificateIssueKind;
      originalId: string | null;
      originalNo?: string | null;
      replaceDraftId?: string;
      skipTransfer?: boolean;
    },
  ): Promise<CertificateResult> {
    const { config, template } = context;

    // ── the clearance gate (roadmap §6) ──
    const wantsOverride = Boolean(dto.clearanceOverrideReason?.trim());
    const holdsOverride = wantsOverride ? await this.hasOverride(actor) : false;
    if (wantsOverride && !holdsOverride) {
      throw new ForbiddenException(
        'Issuing past an unmet clearance needs certificate.clearance.override.',
      );
    }

    const clearance = await this.clearance.check({
      schoolId: actor.schoolId,
      studentId: dto.studentId,
      type: dto.type,
      override: holdsOverride,
    });
    if (!clearance.allowed) {
      throw new ConflictException(clearance.reason);
    }

    // A reason offered where none was needed is dropped rather than
    // stored: `chk_certificates_provenance` reads the presence of
    // `clearance_override_by` as "a waiver was granted here", and a
    // waiver recorded against a student who owed nothing would make the
    // audit trail claim something that did not happen.
    const waived = !clearance.cleared && clearance.required && holdsOverride;

    const issueDate = isoDate(new Date());
    const warnings = [...context.warnings, ...clearance.warnings];

    const created = await this.certificates.withTransaction(async (tx) => {
      const number = await this.claimNumber(
        actor.schoolId,
        dto.type,
        config,
        tx,
      );
      const code = await this.claimVerifyCode();
      const url = verifyUrl(config.verifyUrlBase, code);

      const built = await this.snapshots.build({
        schoolId: actor.schoolId,
        studentId: dto.studentId,
        type: dto.type,
        conduct: dto.conduct?.trim() || config.conductDefault,
        enrollmentId: dto.enrollmentId,
        examId: dto.examId,
        extra: dto.extra,
        issue: {
          certificateNo: number,
          verifyCode: code,
          verifyUrl: url,
          issueDate,
          originalNo: context.originalNo ?? null,
        },
      });
      if (built.completeness) warnings.push(built.completeness);

      const data: Prisma.CertificateUncheckedCreateInput = {
        schoolId: actor.schoolId,
        studentId: dto.studentId,
        enrollmentId: built.enrollmentId,
        sessionId: built.sessionId,
        templateId: template?.id ?? null,
        type: dto.type,
        certificateNo: number,
        verifyCode: code,
        status: CertificateStatus.ISSUED,
        issueKind: context.kind,
        originalCertificateId: context.originalId,
        dataSnapshot: built.snapshot,
        // **The layout is frozen with the data.** Re-printing years later
        // must reproduce the page, not re-render today's template.
        bodyHtml: template?.bodyHtml ?? null,
        clearanceSnapshot: clearance as unknown as Prisma.InputJsonValue,
        clearanceOverrideBy: waived ? actor.sub : null,
        clearanceOverrideNote: waived
          ? (dto.clearanceOverrideReason?.trim() ?? null)
          : null,
        issuedBy: actor.sub,
        issuedAt: new Date(),
        remarks: dto.remarks?.trim() || null,
        createdBy: actor.sub,
        updatedBy: actor.sub,
      };

      if (context.replaceDraftId) {
        // The draft becomes the issued row rather than being replaced by
        // a sibling: anything already pointing at the draft id (a wizard
        // tab, an audit entry) keeps pointing at the document.
        // `school_id` and `student_id` are the draft's identity and are
        // already correct; re-sending them would let a malformed call move
        // a certificate between schools.
        const rest = { ...data } as Partial<typeof data>;
        delete rest.schoolId;
        delete rest.studentId;
        await this.certificates.update(context.replaceDraftId, rest, tx);
        return { id: context.replaceDraftId, number, code };
      }

      const row = await this.certificates.create(data, tx);
      return { id: row.id, number, code };
    });

    this.audit.set({
      entityType: 'Certificate',
      entityId: created.id,
      newValues: {
        certificateNo: created.number,
        type: dto.type,
        issueKind: context.kind,
        clearanceWaived: waived,
        ...(waived ? { waiverReason: dto.clearanceOverrideReason } : {}),
      },
    });

    // ── roadmap §4's TC rule ──
    if (
      dto.type === CertificateType.TRANSFER &&
      config.tcSetsTransferred &&
      !context.skipTransfer
    ) {
      warnings.push(
        ...(await this.markTransferred(dto, actor, created.number)),
      );
    }

    const certificate = await this.get(created.id, actor);
    if (dto.notify ?? config.notifyOnIssue) {
      await this.notifications.certificateIssued(
        actor.schoolId,
        certificate,
        verifyUrl(config.verifyUrlBase, created.code),
      );
    }

    return { certificate, clearance, warnings };
  }

  /**
   * Roadmap §4: "issuing TC sets student status TRANSFERRED (confirm step)
   * and locks portal".
   *
   * The **confirm step is a required flag on the request**, not a dialog
   * the frontend owns, because the consequence is not reversible from this
   * screen: the M09 status change deactivates the portal account through
   * its listener, and an office that discovers it afterwards has to go and
   * undo a status change they did not know they were making.
   *
   * The status change is attempted **after** the certificate commits and
   * its failure is a warning rather than a rollback — the M20/M21 rule
   * that a side effect must not undo the act that triggered it. The
   * certificate has been printed; refusing to record it because the
   * student's dues block an exit-status change would be strictly worse
   * than a status somebody fixes.
   */
  private async markTransferred(
    dto: CreateCertificateDto,
    actor: AccessTokenPayload,
    certificateNo: string,
  ): Promise<string[]> {
    if (dto.confirmTransfer !== true) {
      return [
        `The student was NOT marked TRANSFERRED — send confirmTransfer to do that. ${certificateNo} has been issued either way.`,
      ];
    }
    try {
      const result = await this.students.updateStatus(
        dto.studentId,
        {
          status: StudentStatus.TRANSFERRED,
          reason: `Transfer certificate ${certificateNo} issued`,
        },
        actor,
      );
      return [
        'The student is now TRANSFERRED and their portal account has been deactivated.',
        ...result.warnings,
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `TC ${certificateNo} issued but the status change failed: ${message}`,
      );
      return [
        `${certificateNo} was issued, but the student could NOT be marked TRANSFERRED: ${message}. Change the status by hand from the student's record.`,
      ];
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────

  /** Renders a stored certificate's frozen layout against its frozen data. */
  renderBody(certificate: CertificateWithRelations): string {
    if (!certificate.bodyHtml) return '';
    return renderTemplate(
      certificate.bodyHtml,
      certificate.dataSnapshot as Record<string, unknown>,
    );
  }

  private async claimNumber(
    schoolId: string,
    type: CertificateType,
    config: Awaited<ReturnType<DocumentSettingsService['load']>>,
    tx: PrismaClientLike,
  ): Promise<string> {
    const school = await this.schools.findByIdOrFail(schoolId);
    const now = new Date();
    return this.sequences.nextDocumentNumber({
      schoolId,
      counterKey: counterKey(type, now),
      pattern: resolvePattern(
        config.certificateNoPattern,
        type,
        config.typePrefixes,
      ),
      schoolCode: school.code,
      date: now,
      tx,
    });
  }

  /**
   * A fresh verify code that is not already taken.
   *
   * `uq_certificates_verify_code` is the guarantee; this loop is the
   * courtesy, so the ordinary case never surfaces a constraint error. With
   * 32^10 codes a collision is vanishingly unlikely, which is exactly why
   * the loop is bounded and **throws** rather than retrying forever: if it
   * ever runs out of attempts, something is wrong with the entropy source
   * and silently continuing would be the worse failure.
   */
  private async claimVerifyCode(): Promise<string> {
    for (let attempt = 0; attempt < VERIFY_CODE_ATTEMPTS; attempt++) {
      const code = generateVerifyCode(randomBytes);
      if (!(await this.certificates.verifyCodeTaken(code))) return code;
      this.logger.warn(`Verify code collision on ${code} — retrying`);
    }
    throw new ConflictException(
      'Could not generate a unique verification code. Try again; if this repeats, the random source needs looking at.',
    );
  }

  private async loadTemplate(id: string, schoolId: string) {
    const template = await this.templates.findById(id, schoolId);
    if (!template) {
      throw new NotFoundException(`Certificate template ${id} not found`);
    }
    return template;
  }

  private async hasOverride(actor: AccessTokenPayload): Promise<boolean> {
    if (actor.userType === UserType.SUPER_ADMIN) return true;
    const codes = await this.permissions.getUserPermissionCodes(actor.sub);
    return codes.includes('certificate.clearance.override');
  }

  private assertVerdict(verdict: LifecycleVerdict): void {
    if (verdict.allowed) return;
    throw new ConflictException(verdict.reason ?? 'Refused');
  }

  /** An inclusive `to` filter has to cover the whole day it names. */
  private endOfDay(date: Date): Date {
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }
}
