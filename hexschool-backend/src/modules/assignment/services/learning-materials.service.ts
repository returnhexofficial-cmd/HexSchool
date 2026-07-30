import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LearningMaterialType, Prisma } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { attachmentSetIssues, linkIssues } from '../calc/attachment.util';
import type {
  AttachmentDto,
  CreateMaterialDto,
  UpdateMaterialDto,
} from '../dto';
import { MaterialQueryDto } from '../dto';
import {
  LearningMaterialsRepository,
  type MaterialWithRelations,
} from '../repositories/learning-materials.repository';
import { AssignmentPolicyService } from './assignment-policy.service';
import {
  AssignmentSettingsService,
  type AssignmentConfig,
} from './assignment-settings.service';

const LINK_TYPES: LearningMaterialType[] = [
  LearningMaterialType.VIDEO_URL,
  LearningMaterialType.LINK,
];

/**
 * Class notes, slides and links (roadmap §3 `learning_materials`).
 *
 * The ownership rule is the same live-roster check assignments use, with
 * one widening: a **class-wide** material (`section_id` NULL) may be
 * filed by anyone who teaches that subject in *any* section of the class,
 * because the thing being shared is the subject's notes rather than one
 * section's homework.
 */
@Injectable()
export class LearningMaterialsService {
  constructor(
    private readonly materials: LearningMaterialsRepository,
    private readonly policy: AssignmentPolicyService,
    private readonly config: AssignmentSettingsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: MaterialQueryDto, actor: AccessTokenPayload) {
    const resolved = await this.policy.resolveActor(actor);
    const { page, limit } = query;
    const teacherId =
      query.mine && resolved.teacherId ? resolved.teacherId : query.teacherId;

    const { rows, total } = await this.materials.findMany(
      actor.schoolId,
      {
        sessionId: query.sessionId,
        classId: query.classId,
        sectionId: query.sectionId,
        subjectId: query.subjectId,
        teacherId,
        type: query.type,
        search: query.search,
      },
      page,
      limit,
    );
    return { rows, total, page, limit };
  }

  async getDetail(
    id: string,
    schoolId: string,
  ): Promise<MaterialWithRelations> {
    const found = await this.materials.findDetail(id, schoolId);
    if (!found)
      throw new NotFoundException(`Learning material ${id} not found`);
    return found;
  }

  async create(dto: CreateMaterialDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const teacherId = await this.assertMayFile(
      actor,
      dto.sessionId,
      dto.classId,
      dto.sectionId ?? null,
      dto.subjectId,
      dto.teacherId,
    );

    const type = dto.type ?? LearningMaterialType.NOTE;
    const { files, linkUrl } = this.validatePayload(dto, type, cfg);

    const created = await this.materials.create({
      schoolId: actor.schoolId,
      sessionId: dto.sessionId,
      classId: dto.classId,
      sectionId: dto.sectionId ?? null,
      subjectId: dto.subjectId,
      teacherId,
      type,
      title: dto.title.trim(),
      description: dto.description?.trim() || null,
      fileUrls: files as unknown as Prisma.InputJsonValue,
      linkUrl,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'LearningMaterial',
      entityId: created.id,
      newValues: { title: created.title, type: created.type },
    });

    return this.getDetail(created.id, actor.schoolId);
  }

  async update(id: string, dto: UpdateMaterialDto, actor: AccessTokenPayload) {
    const cfg = await this.config.load(actor.schoolId);
    const existing = await this.getDetail(id, actor.schoolId);
    await this.assertMayFile(
      actor,
      existing.sessionId,
      existing.classId,
      dto.sectionId === undefined ? existing.sectionId : dto.sectionId,
      existing.subjectId,
      existing.teacherId,
    );

    const type = dto.type ?? existing.type;
    const merged = {
      files: dto.files ?? this.attachmentsOf(existing.fileUrls),
      linkUrl: dto.linkUrl === undefined ? existing.linkUrl : dto.linkUrl,
    };
    const { files, linkUrl } = this.validatePayload(
      { files: merged.files, linkUrl: merged.linkUrl ?? undefined },
      type,
      cfg,
    );

    await this.materials.update(id, {
      ...(dto.sectionId !== undefined ? { sectionId: dto.sectionId } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      ...(dto.title ? { title: dto.title.trim() } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description?.trim() || null }
        : {}),
      fileUrls: files as unknown as Prisma.InputJsonValue,
      linkUrl,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'LearningMaterial',
      entityId: id,
      oldValues: { title: existing.title, type: existing.type },
      newValues: { title: dto.title, type: dto.type },
    });

    return this.getDetail(id, actor.schoolId);
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getDetail(id, actor.schoolId);
    await this.assertMayFile(
      actor,
      existing.sessionId,
      existing.classId,
      existing.sectionId,
      existing.subjectId,
      existing.teacherId,
    );
    await this.materials.softDelete(id);
    this.audit.set({
      entityType: 'LearningMaterial',
      entityId: id,
      oldValues: { title: existing.title },
    });
  }

  /** The library one enrolled candidate sees. */
  async visibleFor(
    schoolId: string,
    sessionId: string,
    classId: string,
    sectionId: string,
    filter: { subjectId?: string; type?: LearningMaterialType } = {},
  ) {
    return this.materials.findVisibleFor(
      schoolId,
      sessionId,
      classId,
      sectionId,
      filter,
    );
  }

  // ── internals ───────────────────────────────────────────────────────

  private async assertMayFile(
    actor: AccessTokenPayload,
    sessionId: string,
    classId: string,
    sectionId: string | null,
    subjectId: string,
    requestedTeacherId?: string | null,
  ): Promise<string> {
    if (sectionId) {
      return this.policy.assertMayActOn(
        actor,
        { sessionId, sectionId, subjectId },
        requestedTeacherId,
      );
    }

    // Class-wide: teaching the subject in ANY section of the class is
    // enough, so a class-wide note does not need a section it is not for.
    const sections = await this.prisma.section.findMany({
      where: { classId, sessionId, schoolId: actor.schoolId, deletedAt: null },
      select: { id: true },
    });
    if (sections.length === 0) {
      throw new BadRequestException(
        'That class has no sections in this session',
      );
    }

    let lastError: unknown = null;
    for (const section of sections) {
      try {
        return await this.policy.assertMayActOn(
          actor,
          { sessionId, sectionId: section.id, subjectId },
          requestedTeacherId,
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private validatePayload(
    payload: { files?: AttachmentDto[]; linkUrl?: string | null },
    type: LearningMaterialType,
    cfg: AssignmentConfig,
  ): { files: AttachmentDto[]; linkUrl: string | null } {
    const files = payload.files ?? [];
    const issues = attachmentSetIssues(files, cfg.limits);

    const rawLink = payload.linkUrl?.trim() || null;
    if (LINK_TYPES.includes(type)) {
      issues.push(...linkIssues(rawLink, cfg.materialLinkHosts));
    } else if (rawLink) {
      issues.push(...linkIssues(rawLink, cfg.materialLinkHosts));
    }

    if (!LINK_TYPES.includes(type) && files.length === 0 && !rawLink) {
      issues.push('Attach at least one file, or give a link');
    }

    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'The material was refused',
        details: { issues },
      });
    }

    return { files, linkUrl: rawLink };
  }

  private attachmentsOf(value: unknown): AttachmentDto[] {
    return Array.isArray(value) ? (value as AttachmentDto[]) : [];
  }
}
