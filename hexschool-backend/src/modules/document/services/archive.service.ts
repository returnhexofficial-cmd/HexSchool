import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArchiveFile, ArchiveFolder } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { StorageService } from '../../storage/storage.service';
import type {
  ArchiveFileQueryDto,
  UpdateFileDto,
  UpsertFileDto,
  UpsertFolderDto,
} from '../dto';
import {
  ArchiveFilesRepository,
  ArchiveFoldersRepository,
} from '../repositories/archive.repository';
import { DocumentSettingsService } from './document-settings.service';

export interface FolderNode {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  fileCount: number;
  /** Files in this folder and every folder beneath it. */
  totalFileCount: number;
  children: FolderNode[];
}

/**
 * The document archive (roadmap §3's `archive_folders` + `archive_files`,
 * §4's "Archive CRUD with folder tree + search by tag/title").
 *
 * **It generalizes rather than replaces** the student and staff document
 * tables M07/M09 already built. Those hang off a person and are part of
 * that person's record; this is the school's filing cabinet — the
 * committee minutes, the board circulars, the inspection reports, the
 * scanned land deed. `linked_type`/`linked_id` is the bridge for the cases
 * that *are* about somebody, and it is deliberately FK-less and optional
 * (the M12/M21/M23 polymorphic precedent), because most of a cabinet is
 * about nobody in particular.
 *
 * Tags are lower-cased on write so `Exam`, `exam` and `EXAM` are one tag.
 * A filing cabinet whose search is case-sensitive is a filing cabinet
 * nobody uses twice.
 */
@Injectable()
export class ArchiveService {
  constructor(
    private readonly folders: ArchiveFoldersRepository,
    private readonly files: ArchiveFilesRepository,
    private readonly storage: StorageService,
    private readonly config: DocumentSettingsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── folders ─────────────────────────────────────────────────────────

  /** The whole tree from one query, with counts rolled up. */
  async tree(actor: AccessTokenPayload): Promise<FolderNode[]> {
    const [rows, counts] = await Promise.all([
      this.folders.findAllLive(actor.schoolId),
      this.folders.fileCounts(actor.schoolId),
    ]);

    const nodes = new Map<string, FolderNode>(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          parentId: row.parentId,
          description: row.description,
          fileCount: counts.get(row.id) ?? 0,
          totalFileCount: 0,
          children: [],
        },
      ]),
    );

    const roots: FolderNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    const roll = (node: FolderNode): number => {
      node.totalFileCount =
        node.fileCount +
        node.children.reduce((sum, child) => sum + roll(child), 0);
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      return node.totalFileCount;
    };
    roots.forEach(roll);
    roots.sort((a, b) => a.name.localeCompare(b.name));
    return roots;
  }

  async createFolder(
    dto: UpsertFolderDto,
    actor: AccessTokenPayload,
  ): Promise<ArchiveFolder> {
    const parentId = dto.parentId ?? null;
    if (parentId) await this.loadFolder(parentId, actor.schoolId);
    await this.assertNameFree(actor.schoolId, parentId, dto.name);

    const created = await this.folders.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      parentId,
      description: dto.description?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'ArchiveFolder',
      entityId: created.id,
      newValues: { name: created.name, parentId },
    });
    return created;
  }

  async updateFolder(
    id: string,
    dto: UpsertFolderDto,
    actor: AccessTokenPayload,
  ): Promise<ArchiveFolder> {
    const existing = await this.loadFolder(id, actor.schoolId);
    const parentId =
      dto.parentId === undefined ? existing.parentId : dto.parentId;

    if (parentId !== existing.parentId && parentId !== null) {
      await this.assertNoCycle(id, parentId, actor.schoolId);
    }
    await this.assertNameFree(actor.schoolId, parentId, dto.name, id);

    const updated = await this.folders.update(id, {
      name: dto.name.trim(),
      parentId,
      description: dto.description?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'ArchiveFolder',
      entityId: id,
      oldValues: { name: existing.name, parentId: existing.parentId },
      newValues: { name: updated.name, parentId },
    });
    return updated;
  }

  /**
   * Refused while anything is inside it.
   *
   * A cascade would be the convenient implementation and is exactly wrong
   * here: the point of an archive is that documents stay in it, and a
   * mis-clicked folder delete that silently took forty scanned circulars
   * with it is not recoverable by anybody who was not watching. The
   * message says what is in the way and how many.
   */
  async removeFolder(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.loadFolder(id, actor.schoolId);
    const [children, files] = await Promise.all([
      this.folders.countChildren(id),
      this.folders.countFiles(id),
    ]);
    if (children > 0 || files > 0) {
      const parts = [
        children > 0 ? `${children} sub-folder(s)` : '',
        files > 0 ? `${files} document(s)` : '',
      ].filter(Boolean);
      throw new ConflictException(
        `"${existing.name}" still holds ${parts.join(' and ')}. Move or remove them first — deleting a folder does not delete what is filed in it.`,
      );
    }

    await this.folders.softDelete(id);
    this.audit.set({
      entityType: 'ArchiveFolder',
      entityId: id,
      oldValues: { name: existing.name },
    });
  }

  // ── files ───────────────────────────────────────────────────────────

  async listFiles(query: ArchiveFileQueryDto, actor: AccessTokenPayload) {
    const { rows, total } = await this.files.findMany(
      actor.schoolId,
      {
        folderId: query.folderId,
        tags: query.tags?.map((tag) => tag.trim().toLowerCase()),
        linkedType: query.linkedType,
        linkedId: query.linkedId,
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

  async tags(actor: AccessTokenPayload) {
    return this.files.tagCloud(actor.schoolId);
  }

  async getFile(id: string, actor: AccessTokenPayload): Promise<ArchiveFile> {
    const file = await this.files.findById(id, actor.schoolId);
    if (!file) throw new NotFoundException(`Archived file ${id} not found`);
    return file;
  }

  /** A short-lived signed URL, minted per read (the M04 logo convention). */
  async downloadUrl(id: string, actor: AccessTokenPayload): Promise<string> {
    const file = await this.getFile(id, actor);
    return this.storage.getSignedUrl(file.fileUrl, 3600, 'documents');
  }

  async createFile(
    dto: UpsertFileDto,
    actor: AccessTokenPayload,
  ): Promise<ArchiveFile> {
    await this.loadFolder(dto.folderId, actor.schoolId);
    const config = await this.config.load(actor.schoolId);

    if (dto.sizeBytes > config.archiveMaxFileMb * 1024 * 1024) {
      throw new BadRequestException(
        `That file is larger than the ${config.archiveMaxFileMb} MB limit`,
      );
    }
    if (!config.archiveAllowedTypes.includes(dto.mimeType)) {
      throw new BadRequestException(
        `${dto.mimeType} is not an accepted document type`,
      );
    }
    this.assertLink(dto.linkedType, dto.linkedId);

    const created = await this.files.create({
      schoolId: actor.schoolId,
      folderId: dto.folderId,
      title: dto.title.trim(),
      fileUrl: dto.fileUrl.trim(),
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      tags: this.normalizeTags(dto.tags),
      linkedType: dto.linkedType ?? null,
      linkedId: dto.linkedId ?? null,
      notes: dto.notes?.trim() || null,
      uploadedBy: actor.sub,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'ArchiveFile',
      entityId: created.id,
      newValues: { title: created.title, folderId: dto.folderId },
    });
    return created;
  }

  async updateFile(
    id: string,
    dto: UpdateFileDto,
    actor: AccessTokenPayload,
  ): Promise<ArchiveFile> {
    const existing = await this.getFile(id, actor);
    if (dto.folderId) await this.loadFolder(dto.folderId, actor.schoolId);

    const linkedType =
      dto.linkedType === undefined ? existing.linkedType : dto.linkedType;
    const linkedId =
      dto.linkedId === undefined ? existing.linkedId : dto.linkedId;
    this.assertLink(linkedType ?? undefined, linkedId ?? undefined);

    const updated = await this.files.update(id, {
      ...(dto.folderId ? { folderId: dto.folderId } : {}),
      ...(dto.title ? { title: dto.title.trim() } : {}),
      ...(dto.tags ? { tags: this.normalizeTags(dto.tags) } : {}),
      linkedType,
      linkedId,
      ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'ArchiveFile',
      entityId: id,
      oldValues: { title: existing.title, folderId: existing.folderId },
      newValues: { title: updated.title, folderId: updated.folderId },
    });
    return updated;
  }

  /**
   * Soft delete, and the S3 object stays.
   *
   * This is the OPPOSITE of M07/M09's document tables, which hard-delete
   * the object with the row — and the difference is deliberate. Those are
   * a person's paperwork, uploaded by whoever manages that person, and
   * deleting one means "this was the wrong file". An archive is the
   * school's record: a removal is an administrative act, `archive.delete`
   * is a permission the office does not hold, and a restore has to be
   * possible from the row alone.
   */
  async removeFile(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getFile(id, actor);
    await this.files.softDelete(id);
    this.audit.set({
      entityType: 'ArchiveFile',
      entityId: id,
      oldValues: { title: existing.title, folderId: existing.folderId },
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private normalizeTags(tags: string[] | undefined): string[] {
    if (!tags) return [];
    const seen = new Set<string>();
    for (const tag of tags) {
      const value = tag.trim().toLowerCase();
      if (value.length > 0) seen.add(value);
    }
    return [...seen].sort();
  }

  private assertLink(type: unknown, id: unknown): void {
    if ((type == null) !== (id == null)) {
      throw new BadRequestException(
        'A linked document needs both a link type and an id — a half-recorded link is a file nobody will find.',
      );
    }
  }

  private async loadFolder(
    id: string,
    schoolId: string,
  ): Promise<ArchiveFolder> {
    const folder = await this.folders.findById(id, schoolId);
    if (!folder) throw new NotFoundException(`Archive folder ${id} not found`);
    return folder;
  }

  /**
   * A folder may not be moved inside its own subtree.
   *
   * `chk_archive_folders_shape` catches the one-step case (a folder that is
   * its own parent), which is all a CHECK can see — a longer cycle
   * (A → B → A) needs a walk, and a tree that contains one is a folder
   * listing that never terminates. The M20 `coa.engine` `wouldCycle` rule.
   */
  private async assertNoCycle(
    id: string,
    newParentId: string,
    schoolId: string,
  ): Promise<void> {
    const all = await this.folders.findAllLive(schoolId);
    const byId = new Map(all.map((row) => [row.id, row]));

    let cursor: string | null = newParentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        throw new ConflictException(
          'That would put the folder inside itself. Pick a destination outside its own subtree.',
        );
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  private async assertNameFree(
    schoolId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await this.folders.findByName(
      schoolId,
      parentId,
      name,
      excludeId,
    );
    if (clash) {
      throw new ConflictException(
        `A folder called "${clash.name}" is already here`,
      );
    }
  }
}
