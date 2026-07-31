import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StockVerificationStatus } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { normalizeScannedCode } from '../calc/barcode.util';
import { diffStock, type StockDiff } from '../calc/stock-check.engine';
import type {
  CloseStockCheckDto,
  ScanStockDto,
  StartStockCheckDto,
} from '../dto';
import { BookCopiesRepository } from '../repositories/book-copies.repository';
import { StockVerificationsRepository } from '../repositories/stock-verification.repository';

/**
 * Roadmap §4's "stock-check (physical verification mode: scan-all, diff
 * report)".
 *
 * Open one, walk the shelves with a scanner, close it, read the diff.
 * Two design points are worth stating:
 *
 *   - **The expected set is resolved at CLOSE, not at open.** A book
 *     issued during a week-long count is legitimately not on the shelf,
 *     and freezing the expectation at open would report it missing.
 *   - **The diff is frozen into the row at close** (the M14/M15
 *     snapshot rule). Recomputing it when the report is opened months
 *     later would compare today's shelves against last year's scan.
 */
@Injectable()
export class StockVerificationService {
  constructor(
    private readonly verifications: StockVerificationsRepository,
    private readonly copies: BookCopiesRepository,
    private readonly audit: AuditContextService,
  ) {}

  async list(page: number, limit: number, schoolId: string) {
    const { rows, total } = await this.verifications.findMany(
      schoolId,
      page,
      limit,
    );
    return { rows, total, page, limit };
  }

  async start(dto: StartStockCheckDto, actor: AccessTokenPayload) {
    // `uq_stock_verifications_open` holds this too; catching it here
    // turns a unique violation into a sentence naming the open count.
    const open = await this.verifications.findOpen(actor.schoolId);
    if (open) {
      throw new ConflictException(
        `"${open.name}" is already in progress — finish or cancel it before starting another count`,
      );
    }

    const created = await this.verifications.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      rackNo: dto.rackNo?.trim() || null,
      status: StockVerificationStatus.IN_PROGRESS,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'StockVerification',
      entityId: created.id,
      newValues: { name: created.name, rackNo: created.rackNo },
    });
    return created;
  }

  /**
   * A batch of scans. Unresolvable codes are **recorded, not rejected**
   * — a barcode that matches no copy is precisely the finding a stock
   * verification exists to surface (a book that was never catalogued),
   * and refusing it would leave the operator with nothing but a red
   * toast and no record.
   */
  async scan(id: string, dto: ScanStockDto, actor: AccessTokenPayload) {
    const verification = await this.requireOpen(id, actor.schoolId);

    let matched = 0;
    let unknown = 0;
    for (const raw of dto.accessionNos) {
      const accessionNo = normalizeScannedCode(raw);
      if (accessionNo.length === 0) continue;
      const copy = await this.copies.findByAccession(
        actor.schoolId,
        accessionNo,
      );
      await this.verifications.addScan(
        verification.id,
        copy?.id ?? null,
        accessionNo,
      );
      if (copy) matched++;
      else unknown++;
    }

    const scanned = await this.verifications.scanCount(verification.id);
    await this.verifications.update(verification.id, {
      scannedCount: scanned,
      updatedBy: actor.sub,
    });

    return { accepted: matched + unknown, matched, unknown, scanned };
  }

  /** The live diff, for the operator's screen while the count is open. */
  async preview(id: string, schoolId: string): Promise<StockDiff> {
    const verification = await this.requireExisting(id, schoolId);
    const [copies, scans] = await Promise.all([
      this.copies.shelfList(schoolId),
      this.verifications.scans(id),
    ]);
    return diffStock(copies, scans, verification.rackNo);
  }

  async close(id: string, dto: CloseStockCheckDto, actor: AccessTokenPayload) {
    const verification = await this.requireOpen(id, actor.schoolId);
    const diff = await this.preview(id, actor.schoolId);
    const now = new Date();

    await this.verifications.update(id, {
      status: StockVerificationStatus.COMPLETED,
      completedAt: now,
      expectedCount: diff.expectedCount,
      scannedCount: diff.scannedCount,
      missingCount: diff.missing.length,
      unexpectedCount: diff.unexpected.length,
      notes: dto.notes?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'StockVerification',
      entityId: id,
      oldValues: { status: verification.status },
      newValues: {
        status: StockVerificationStatus.COMPLETED,
        missing: diff.missing.length,
        unexpected: diff.unexpected.length,
      },
    });

    return {
      verification: await this.requireExisting(id, actor.schoolId),
      diff,
    };
  }

  async cancel(id: string, actor: AccessTokenPayload) {
    const verification = await this.requireOpen(id, actor.schoolId);
    await this.verifications.update(id, {
      status: StockVerificationStatus.CANCELLED,
      completedAt: new Date(),
      updatedBy: actor.sub,
    });
    this.audit.set({
      entityType: 'StockVerification',
      entityId: id,
      oldValues: { status: verification.status },
      newValues: { status: StockVerificationStatus.CANCELLED },
    });
    return this.requireExisting(id, actor.schoolId);
  }

  private async requireExisting(id: string, schoolId: string) {
    const found = await this.verifications.findById(id, schoolId);
    if (!found) {
      throw new NotFoundException(`Stock verification ${id} not found`);
    }
    return found;
  }

  private async requireOpen(id: string, schoolId: string) {
    const found = await this.requireExisting(id, schoolId);
    if (found.status !== StockVerificationStatus.IN_PROGRESS) {
      throw new ConflictException(
        `"${found.name}" is ${found.status.toLowerCase()} — reopen is deliberately not offered, start a new count instead`,
      );
    }
    return found;
  }
}
