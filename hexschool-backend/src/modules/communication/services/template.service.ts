import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationLanguage, NotificationTemplate } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { segmentSms } from '../calc/sms-parts.util';
import { renderTemplate, validateTemplate } from '../calc/template.engine';
import { allowedVariables, notificationCode } from '../communication.constants';
import {
  CreateTemplateDto,
  PreviewTemplateDto,
  UpdateTemplateDto,
} from '../dto';
import { NotificationTemplatesRepository } from '../repositories/notification-templates.repository';

export interface TemplatePreview {
  body: string;
  subject: string | null;
  unknownVariables: string[];
  allowedVariables: string[];
  segments: number;
  unicode: boolean;
  charCount: number;
}

/**
 * Template CRUD + preview (roadmap M17 §4/§5). A body's variables are
 * validated against the per-code allow-list (`communication.constants`),
 * and the preview reports the SMS part count so an author sees the cost
 * jump before saving a body that spills to a second segment.
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly templates: NotificationTemplatesRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  list(schoolId: string): Promise<NotificationTemplate[]> {
    return this.templates.findAllForSchool(schoolId);
  }

  async get(id: string, schoolId: string): Promise<NotificationTemplate> {
    const template = await this.templates.findById(id, schoolId);
    if (!template) throw new NotFoundException(`Template ${id} not found`);
    return template;
  }

  async create(
    dto: CreateTemplateDto,
    actor: AccessTokenPayload,
  ): Promise<NotificationTemplate> {
    this.assertKnownCode(dto.code);
    this.assertVariables(dto.code, dto.body, dto.subject);

    const clash = await this.templates.findIdentity(
      actor.schoolId,
      dto.code,
      dto.channel,
      dto.language ?? NotificationLanguage.EN,
    );
    if (clash) {
      throw new ConflictException(
        `A ${dto.channel}/${dto.language ?? 'EN'} template for ${dto.code} already exists`,
      );
    }

    const created = await this.templates.create({
      schoolId: actor.schoolId,
      code: dto.code,
      channel: dto.channel,
      language: dto.language ?? NotificationLanguage.EN,
      subject: dto.subject ?? null,
      body: dto.body,
      isActive: dto.isActive ?? true,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'NotificationTemplate',
      entityId: created.id,
      newValues: { code: created.code, channel: created.channel },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateTemplateDto,
    actor: AccessTokenPayload,
  ): Promise<NotificationTemplate> {
    const existing = await this.get(id, actor.schoolId);
    const body = dto.body ?? existing.body;
    this.assertVariables(existing.code, body, dto.subject ?? existing.subject);

    const updated = await this.templates.update(id, {
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.body !== undefined ? { body: dto.body } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'NotificationTemplate',
      entityId: id,
      oldValues: { body: existing.body, isActive: existing.isActive },
      newValues: { body: updated.body, isActive: updated.isActive },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.get(id, actor.schoolId);
    await this.templates.softDelete(id);
    this.auditContext.set({
      entityType: 'NotificationTemplate',
      entityId: id,
      oldValues: { code: existing.code, channel: existing.channel },
    });
  }

  /** Render a body against sample vars, with segment/validation info. */
  preview(dto: PreviewTemplateDto): TemplatePreview {
    const allowed = allowedVariables(dto.code);
    const validation = validateTemplate(dto.body, allowed);
    const sample = dto.sampleVars ?? this.sampleVarsFor(dto.code);
    const body = renderTemplate(dto.body, sample);
    const subject = dto.subject ? renderTemplate(dto.subject, sample) : null;
    const seg = segmentSms(body);
    return {
      body,
      subject,
      unknownVariables: validation.unknown,
      allowedVariables: allowed,
      segments: seg.segments,
      unicode: seg.unicode,
      charCount: seg.units,
    };
  }

  private assertKnownCode(code: string): void {
    if (!notificationCode(code)) {
      throw new BadRequestException(`Unknown notification code "${code}"`);
    }
  }

  private assertVariables(
    code: string,
    body: string,
    subject?: string | null,
  ): void {
    const allowed = allowedVariables(code);
    const bodyCheck = validateTemplate(body, allowed);
    const subjectCheck = subject
      ? validateTemplate(subject, allowed)
      : { unknown: [] as string[] };
    const unknown = [
      ...new Set([...bodyCheck.unknown, ...subjectCheck.unknown]),
    ];
    if (unknown.length) {
      throw new BadRequestException(
        `Template uses unknown variables: ${unknown.join(', ')}. Allowed: ${allowed.join(', ') || '(none)'}`,
      );
    }
  }

  private sampleVarsFor(code: string): Record<string, unknown> {
    const vars = allowedVariables(code);
    const samples: Record<string, string> = {
      name: 'Karim Rahman',
      student_name: 'Karim Rahman',
      applicant_name: 'Karim Rahman',
      username: 'karim.r',
      temp_password: 'Temp1234',
      school: 'Demo High School',
      login_url: 'https://school.example',
      otp: '123456',
      purpose: 'login',
      minutes: '5',
      application_no: 'ADM-26-000123',
      class: 'Class 7',
      deadline: '2026-07-31',
      status: 'WAITLISTED',
      roll: '12',
      date: '2026-07-23',
      exam: 'Half-Yearly 2026',
      gpa: '5.00',
      grade: 'A+',
      merit: '3',
      amount: '1500.00',
      invoice: 'INV-2607-000045',
      balance: '0.00',
      due: '2026-08-10',
      title: 'School closed tomorrow',
      body: 'Due to weather, the school will remain closed.',
      threshold: '100',
    };
    const out: Record<string, unknown> = {};
    for (const v of vars) out[v] = samples[v] ?? `{${v}}`;
    return out;
  }
}
