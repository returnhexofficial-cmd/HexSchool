import { Injectable, NotFoundException } from '@nestjs/common';
import { CommitteeMember, Faq } from '@prisma/client';
import { WebContentStatus } from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { sanitizeHtml } from '../calc/html-sanitize.util';
import {
  CreateCommitteeMemberDto,
  CreateFaqDto,
  UpdateCommitteeMemberDto,
  UpdateFaqDto,
} from '../dto';
import {
  CommitteeMembersRepository,
  FaqsRepository,
} from '../repositories/cms-content.repository';
import { WebsiteCacheService } from './website-cache.service';

/**
 * The two hand-ordered lists on the site — FAQs and the managing
 * committee. Both are plain display-ordered masters with the shared
 * publication status; they share a service because neither has any rule
 * beyond "sanitize the prose and bust the cache".
 */
@Injectable()
export class SiteContentService {
  constructor(
    private readonly faqs: FaqsRepository,
    private readonly committee: CommitteeMembersRepository,
    private readonly audit: AuditContextService,
    private readonly cache: WebsiteCacheService,
  ) {}

  // ── FAQs ────────────────────────────────────────────────────────────

  listFaqs(
    schoolId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Faq>> {
    return this.faqs.paginate(query, {
      schoolId,
      searchColumns: ['question', 'category'],
      sortableColumns: ['createdAt', 'displayOrder', 'category'],
    });
  }

  async createFaq(dto: CreateFaqDto, actor: AccessTokenPayload): Promise<Faq> {
    const created = await this.faqs.create({
      schoolId: actor.schoolId,
      question: dto.question,
      questionBn: dto.questionBn ?? null,
      answer: sanitizeHtml(dto.answer),
      answerBn: dto.answerBn ? sanitizeHtml(dto.answerBn) : null,
      category: dto.category ?? null,
      status: dto.status ?? WebContentStatus.PUBLISHED,
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Faq',
      entityId: created.id,
      newValues: { question: created.question },
    });
    await this.cache.bust(actor.schoolId);
    return created;
  }

  async updateFaq(
    id: string,
    dto: UpdateFaqDto,
    actor: AccessTokenPayload,
  ): Promise<Faq> {
    const existing = await this.faqs.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`FAQ ${id} not found`);
    const updated = await this.faqs.update(id, {
      ...(dto.question !== undefined ? { question: dto.question } : {}),
      ...(dto.questionBn !== undefined ? { questionBn: dto.questionBn } : {}),
      ...(dto.answer !== undefined ? { answer: sanitizeHtml(dto.answer) } : {}),
      ...(dto.answerBn !== undefined
        ? { answerBn: dto.answerBn ? sanitizeHtml(dto.answerBn) : null }
        : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'Faq',
      entityId: id,
      oldValues: { question: existing.question },
      newValues: { question: updated.question },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async removeFaq(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.faqs.findById(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`FAQ ${id} not found`);
    await this.faqs.softDelete(id);
    this.audit.set({
      entityType: 'Faq',
      entityId: id,
      oldValues: { question: existing.question },
    });
    await this.cache.bust(actor.schoolId);
  }

  // ── committee ───────────────────────────────────────────────────────

  listCommittee(
    schoolId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<CommitteeMember>> {
    return this.committee.paginate(query, {
      schoolId,
      searchColumns: ['name', 'designation'],
      sortableColumns: ['createdAt', 'displayOrder', 'name'],
    });
  }

  async createMember(
    dto: CreateCommitteeMemberDto,
    actor: AccessTokenPayload,
  ): Promise<CommitteeMember> {
    const created = await this.committee.create({
      schoolId: actor.schoolId,
      name: dto.name,
      nameBn: dto.nameBn ?? null,
      designation: dto.designation,
      photoUrl: dto.photoUrl ?? null,
      message: dto.message ? sanitizeHtml(dto.message) : null,
      status: dto.status ?? WebContentStatus.PUBLISHED,
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'CommitteeMember',
      entityId: created.id,
      newValues: { name: created.name, designation: created.designation },
    });
    await this.cache.bust(actor.schoolId);
    return created;
  }

  async updateMember(
    id: string,
    dto: UpdateCommitteeMemberDto,
    actor: AccessTokenPayload,
  ): Promise<CommitteeMember> {
    const existing = await this.committee.findById(id, actor.schoolId);
    if (!existing) {
      throw new NotFoundException(`Committee member ${id} not found`);
    }
    const updated = await this.committee.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.nameBn !== undefined ? { nameBn: dto.nameBn } : {}),
      ...(dto.designation !== undefined
        ? { designation: dto.designation }
        : {}),
      ...(dto.photoUrl !== undefined ? { photoUrl: dto.photoUrl } : {}),
      ...(dto.message !== undefined
        ? { message: dto.message ? sanitizeHtml(dto.message) : null }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'CommitteeMember',
      entityId: id,
      oldValues: { name: existing.name },
      newValues: { name: updated.name },
    });
    await this.cache.bust(actor.schoolId);
    return updated;
  }

  async removeMember(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.committee.findById(id, actor.schoolId);
    if (!existing) {
      throw new NotFoundException(`Committee member ${id} not found`);
    }
    await this.committee.softDelete(id);
    this.audit.set({
      entityType: 'CommitteeMember',
      entityId: id,
      oldValues: { name: existing.name },
    });
    await this.cache.bust(actor.schoolId);
  }
}
