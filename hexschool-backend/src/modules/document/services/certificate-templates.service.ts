import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CertificateTemplate, Prisma } from '@prisma/client';
import { CertificateType } from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  renderTemplate,
  validateTemplate,
} from '../../communication/calc/template.engine';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { sanitizeHtml } from '../../website/calc/html-sanitize.util';
import {
  buildSnapshot,
  CERTIFICATE_VARIABLES,
  type CertificateSnapshot,
} from '../calc/snapshot.engine';
import type {
  PreviewTemplateDto,
  TemplateQueryDto,
  UpsertTemplateDto,
} from '../dto';
import { CertificateTemplatesRepository } from '../repositories/certificate-templates.repository';
import { DocumentSettingsService } from './document-settings.service';
import { SnapshotBuilderService } from './snapshot-builder.service';

export interface TemplatePreview {
  html: string;
  /** The bag the preview rendered against, so the designer can see it. */
  variables: CertificateSnapshot;
  /** Variables in the body that are not in the palette — §7's rule. */
  unknownVariables: string[];
  /** Palette entries the body never uses; advisory. */
  unusedVariables: string[];
  sample: boolean;
}

/**
 * Certificate templates: the layouts a certificate is printed from.
 *
 * **Author markup is sanitized on WRITE**, through M19's allow-list
 * sanitizer, for exactly M19's reason one step removed: this HTML is
 * rendered into the designer's preview pane and into a PDF, and a
 * compromised or careless account should not be able to store a script tag
 * that some future renderer executes. Sanitizing at the door makes the row
 * itself safe for every reader (PROJECT_CONTEXT §16, M19).
 *
 * **A variable outside the palette is refused, not silently blanked**
 * (roadmap §7, "template vars must exist in palette"). M17's renderer
 * prints an unknown variable as the empty string, which is right for an
 * SMS that must still send — and wrong here, because a testimonial with a
 * blank where the GPA should be is a document the school hands over
 * without noticing.
 */
@Injectable()
export class CertificateTemplatesService {
  constructor(
    private readonly templates: CertificateTemplatesRepository,
    private readonly schools: SchoolsRepository,
    private readonly snapshots: SnapshotBuilderService,
    private readonly config: DocumentSettingsService,
    private readonly audit: AuditContextService,
  ) {}

  /** The palette the designer renders as clickable chips. */
  variables(): readonly string[] {
    return CERTIFICATE_VARIABLES;
  }

  async list(
    query: TemplateQueryDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateTemplate[]> {
    return this.templates.findMany(actor.schoolId, query);
  }

  async get(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<CertificateTemplate> {
    const template = await this.templates.findById(id, actor.schoolId);
    if (!template) {
      throw new NotFoundException(`Certificate template ${id} not found`);
    }
    return template;
  }

  async create(
    dto: UpsertTemplateDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateTemplate> {
    const bodyHtml = this.assertBody(dto.bodyHtml);
    await this.assertNameFree(actor.schoolId, dto.type, dto.name);

    const created = await this.templates.create({
      schoolId: actor.schoolId,
      type: dto.type,
      name: dto.name.trim(),
      bodyHtml,
      backgroundUrl: dto.backgroundUrl?.trim() || null,
      signatories: (dto.signatories ?? []) as unknown as Prisma.InputJsonValue,
      isActive: dto.isActive ?? true,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'CertificateTemplate',
      entityId: created.id,
      newValues: { type: created.type, name: created.name },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpsertTemplateDto,
    actor: AccessTokenPayload,
  ): Promise<CertificateTemplate> {
    const existing = await this.get(id, actor);
    const bodyHtml = this.assertBody(dto.bodyHtml);
    await this.assertNameFree(actor.schoolId, dto.type, dto.name, id);

    const updated = await this.templates.update(id, {
      type: dto.type,
      name: dto.name.trim(),
      bodyHtml,
      backgroundUrl: dto.backgroundUrl?.trim() || null,
      signatories: (dto.signatories ?? []) as unknown as Prisma.InputJsonValue,
      isActive: dto.isActive ?? existing.isActive,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'CertificateTemplate',
      entityId: id,
      oldValues: { name: existing.name, type: existing.type },
      newValues: { name: updated.name, type: updated.type },
    });
    return updated;
  }

  /**
   * Soft-delete, refused once a certificate has been issued through it.
   *
   * Not because the row is needed to *render* — a certificate carries its
   * own frozen `body_html` — but because the register's "issued from"
   * column would go blank, and "which layout was this printed from" is a
   * question a school asks when a certificate is challenged. Switching it
   * off is the route (roadmap §3's `is_active`), which is what the message
   * says.
   */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor);
    const issued = await this.templates.countIssued(id);
    if (issued > 0) {
      throw new ConflictException(
        `${issued} certificate(s) were issued from "${existing.name}" — switch it off instead of deleting it, so the register can still say what they were printed from.`,
      );
    }

    await this.templates.softDelete(id);
    this.audit.set({
      entityType: 'CertificateTemplate',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  /**
   * Roadmap §4's "live preview render" and §5's preview pane.
   *
   * Rendering against **sample data when no student is given** is what
   * makes the designer usable: a template is written before term starts,
   * by somebody who is looking at a layout rather than at a child, and a
   * preview that demanded a student id would be unavailable exactly when
   * the template is being written.
   */
  async preview(
    id: string | null,
    dto: PreviewTemplateDto,
    actor: AccessTokenPayload,
  ): Promise<TemplatePreview> {
    const template = id ? await this.get(id, actor) : null;
    const body = dto.bodyHtml ?? template?.bodyHtml ?? '';
    if (!body.trim()) {
      throw new BadRequestException('Nothing to preview — the body is empty');
    }

    const type = template?.type ?? CertificateType.CUSTOM;
    const config = await this.config.load(actor.schoolId);

    const variables = dto.studentId
      ? (
          await this.snapshots.build({
            schoolId: actor.schoolId,
            studentId: dto.studentId,
            type,
            conduct: config.conductDefault,
            issue: {
              certificateNo: 'PREVIEW',
              verifyCode: 'PREVIEW000',
              verifyUrl: '',
              issueDate: new Date().toISOString().slice(0, 10),
            },
          })
        ).snapshot
      : await this.sampleSnapshot(actor.schoolId);

    const checked = validateTemplate(body, CERTIFICATE_VARIABLES);
    return {
      // The preview renders the SANITIZED body, not the raw keystrokes:
      // an editor has to see what will be stored, or they will spend an
      // afternoon styling markup that the sanitizer removes on save.
      html: renderTemplate(sanitizeHtml(body), variables),
      variables,
      unknownVariables: checked.unknown,
      unusedVariables: checked.unused,
      sample: !dto.studentId,
    };
  }

  /** A believable specimen — never a real child's record. */
  private async sampleSnapshot(schoolId: string): Promise<CertificateSnapshot> {
    const school = await this.schools.findByIdOrFail(schoolId);
    return buildSnapshot({
      school: {
        name: school.name,
        address: school.address,
        eiin: school.eiinNumber,
      },
      student: {
        name: 'Specimen Student',
        nameBn: 'নমুনা শিক্ষার্থী',
        studentUid: `${school.code}-2026-00000`,
        fatherName: 'Specimen Father',
        motherName: 'Specimen Mother',
        dob: '2010-01-01',
        gender: 'MALE',
        religion: 'ISLAM',
        admissionDate: '2019-01-01',
      },
      enrollment: {
        className: 'Class 9',
        section: 'A',
        roll: 1,
        group: 'Science',
        session: '2026',
      },
      result: { examName: 'Annual', gpa: 5, grade: 'A+', position: 1 },
      attendance: { percentage: 95 },
      conduct: 'Excellent',
      issue: {
        certificateNo: 'TC-26-0000',
        verifyCode: 'SPECIMEN00',
        verifyUrl: '',
        issueDate: new Date().toISOString().slice(0, 10),
      },
    });
  }

  /** Sanitize, then refuse anything outside the palette (roadmap §7). */
  private assertBody(raw: string): string {
    const sanitized = sanitizeHtml(raw);
    if (!sanitized.trim()) {
      throw new BadRequestException(
        'The template body is empty once sanitized — check the markup for tags that are not allowed.',
      );
    }
    const checked = validateTemplate(sanitized, CERTIFICATE_VARIABLES);
    if (!checked.ok) {
      throw new BadRequestException(
        `Unknown template variable(s): ${checked.unknown.map((v) => `{{${v}}}`).join(', ')}. A variable that is not in the palette always renders blank, which is how a certificate goes out with a hole in it.`,
      );
    }
    return sanitized;
  }

  private async assertNameFree(
    schoolId: string,
    type: CertificateType,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.templates.findByName(
      schoolId,
      type,
      name,
      excludeId,
    );
    if (clash) {
      throw new ConflictException(
        `A ${type} template called "${clash.name}" already exists`,
      );
    }
  }
}
