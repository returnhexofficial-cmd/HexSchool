import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryHolderType,
  ItemType,
  Prisma,
  StockIssueStatus,
  StockTxnType,
} from '@prisma/client';
import { PrismaClientLike } from '../../../common/database/base.repository';
import { parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import {
  canIssue,
  canReturn,
  deriveIssueStatus,
  outstandingLines,
  type IssueLineContext,
  type ReturnLineContext,
} from '../calc/issue.engine';
import { REF_TYPES } from '../calc/stock-ledger.engine';
import type {
  CreateAdjustmentDto,
  CreateIssueDto,
  HolderDto,
  IssueQueryDto,
  ReturnIssueDto,
} from '../dto';
import { ItemsRepository } from '../repositories/catalog.repository';
import {
  StockIssuesRepository,
  type IssueWithLines,
} from '../repositories/issues.repository';
import { InventoryDirectoryRepository } from '../repositories/inventory-directory.repository';
import { InventorySettingsService } from './inventory-settings.service';
import { StockService } from './stock.service';

/**
 * The issue desk: consumables going out to a department, a person or a
 * room, and coming back.
 *
 * The arithmetic and every refusal live in `issue.engine.ts` — this
 * service resolves the context the engine needs, writes the ledger and
 * the slip in one transaction, and stores the status the engine derives.
 * Nothing here decides whether an issue is allowed; it asks.
 *
 * `preview` exists so the UI can ask the *same* question before the clerk
 * commits: the disabled button, the warning line and the 409 are three
 * renderings of one `canIssue` call (the M16/M23/M25 single-verdict
 * rule).
 */
@Injectable()
export class StockIssuesService {
  constructor(
    private readonly issues: StockIssuesRepository,
    private readonly items: ItemsRepository,
    private readonly directory: InventoryDirectoryRepository,
    private readonly stock: StockService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly config: InventorySettingsService,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: IssueQueryDto, actor: AccessTokenPayload) {
    return this.issues.paginate(query, {
      searchColumns: ['issueNo', 'purpose'],
      sortableColumns: ['issueDate', 'issueNo', 'createdAt'],
      schoolId: actor.schoolId,
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.issuedToType ? { issuedToType: query.issuedToType } : {}),
        ...(query.departmentId ? { issuedToDeptId: query.departmentId } : {}),
        ...(query.from || query.to
          ? {
              issueDate: {
                ...(query.from ? { gte: parseDate(query.from) } : {}),
                ...(query.to ? { lte: parseDate(query.to) } : {}),
              },
            }
          : {}),
      },
    });
  }

  async get(id: string, actor: AccessTokenPayload) {
    const issue = await this.issues.findDetail(id, actor.schoolId);
    if (!issue) throw new NotFoundException(`Issue ${id} not found`);
    return this.decorate(actor.schoolId, issue);
  }

  /**
   * The desk's preview — the same verdict the endpoint will reach, so a
   * clerk is never told "yes" by the screen and "no" by the server.
   */
  async preview(dto: CreateIssueDto, actor: AccessTokenPayload) {
    const { context } = await this.issueContext(actor.schoolId, dto);
    const verdict = canIssue(
      dto.lines.map((line) => ({ itemId: line.itemId, quantity: line.qty })),
      context,
    );
    return {
      allowed: verdict.allowed,
      refusals: verdict.refusals,
      lines: verdict.lines.map((line) => ({
        ...line,
        available: context.get(line.itemId)?.available ?? 0,
        itemName: context.get(line.itemId)?.itemName ?? '',
      })),
    };
  }

  async create(dto: CreateIssueDto, actor: AccessTokenPayload) {
    await this.assertHolder(dto.issuedTo, actor.schoolId);

    const { context, unitCosts } = await this.issueContext(actor.schoolId, dto);
    const verdict = canIssue(
      dto.lines.map((line) => ({ itemId: line.itemId, quantity: line.qty })),
      context,
    );
    if (!verdict.allowed) {
      // Every bad line at once — the M22 bulk-grid rule. `details`
      // carries them so the grid can go red per row rather than showing
      // one sentence about the first problem.
      throw new ConflictException({
        message: 'This issue cannot go out as entered',
        details: verdict.refusals,
      });
    }

    const school = await this.schools.findByIdOrFail(actor.schoolId);
    const cfg = await this.config.load(actor.schoolId);
    const remarksByItem = new Map(
      dto.lines.map((line) => [line.itemId, line.remarks?.trim() || null]),
    );

    const created = await this.stock.withTransaction(async (tx) => {
      const issueNo = await this.sequences.nextDocumentNumber({
        schoolId: actor.schoolId,
        counterKey: `inventory-issue:${new Date().getUTCFullYear() % 100}`,
        pattern: cfg.issueNoPattern,
        schoolCode: school.code,
        tx,
      });

      const issue = await this.issues.create(
        {
          schoolId: actor.schoolId,
          issueNo,
          issueDate: parseDate(dto.issueDate),
          ...this.holderColumns(dto.issuedTo),
          purpose: dto.purpose?.trim() || null,
          // Derived from the lines, not assigned — a fresh slip has
          // nothing returned, and `deriveIssueStatus` is what says so.
          status: deriveIssueStatus(
            verdict.lines.map((line) => ({
              qty: line.quantity,
              returnedQty: 0,
            })),
          ),
          remarks: dto.remarks?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );

      await this.issues.createLines(
        verdict.lines.map((line) => ({
          schoolId: actor.schoolId,
          issueId: issue.id,
          itemId: line.itemId,
          qty: new Prisma.Decimal(line.quantity),
          returnedQty: new Prisma.Decimal(0),
          remarks: remarksByItem.get(line.itemId) ?? null,
        })),
        tx,
      );

      await this.stock.recordMany(
        tx,
        actor.schoolId,
        actor.sub,
        verdict.lines.map((line) => ({
          itemId: line.itemId,
          txn: StockTxnType.ISSUE,
          quantity: line.quantity,
          refType: REF_TYPES.ISSUE,
          refId: issue.id,
          unitCost: unitCosts.get(line.itemId) ?? null,
          remarks: issueNo,
        })),
      );

      return issue;
    });

    this.audit.set({
      entityType: 'StockIssue',
      entityId: created.id,
      newValues: {
        issueNo: created.issueNo,
        lines: verdict.lines.length,
        issuedTo: dto.issuedTo.type,
      },
    });

    return this.get(created.id, actor);
  }

  /**
   * A return against one slip.
   *
   * `returned_qty` is moved by an **increment**, not by a computed value,
   * so two partial returns of the same line cannot overwrite each other
   * with numbers each derived from the row it read; and
   * `chk_stock_issue_items_returned` refuses the result if the arithmetic
   * still lands past `qty`.
   *
   * The slip's status is then **re-derived from the rows as they now
   * stand** rather than inferred from this return — which is what makes a
   * three-lines-complete-one-short slip correctly PARTIAL_RETURN instead
   * of RETURNED.
   */
  async processReturn(
    id: string,
    dto: ReturnIssueDto,
    actor: AccessTokenPayload,
  ) {
    const issue = await this.issues.findDetail(id, actor.schoolId);
    if (!issue) throw new NotFoundException(`Issue ${id} not found`);
    if (issue.status === StockIssueStatus.RETURNED) {
      throw new ConflictException(
        `${issue.issueNo} is fully returned — there is nothing outstanding on it`,
      );
    }

    const context = new Map<string, ReturnLineContext>(
      issue.items.map((line) => [
        line.id,
        {
          issueItemId: line.id,
          itemId: line.itemId,
          itemName: line.item.name,
          unit: line.item.unit,
          issued: Number(line.qty),
          returned: Number(line.returnedQty),
        },
      ]),
    );

    const verdict = canReturn(
      dto.lines.map((line) => ({
        issueItemId: line.issueItemId,
        quantity: line.qty,
      })),
      context,
    );
    if (!verdict.allowed) {
      throw new ConflictException({
        message: 'This return cannot be recorded as entered',
        details: verdict.refusals,
      });
    }

    await this.stock.withTransaction(async (tx) => {
      for (const line of verdict.lines) {
        await this.issues.addReturned(line.issueItemId, line.quantity, tx);
      }

      await this.stock.recordMany(
        tx,
        actor.schoolId,
        actor.sub,
        verdict.lines.map((line) => ({
          itemId: line.itemId,
          txn: StockTxnType.RETURN,
          quantity: line.quantity,
          refType: REF_TYPES.RETURN,
          refId: issue.id,
          remarks: `Returned against ${issue.issueNo}${
            dto.remarks?.trim() ? `: ${dto.remarks.trim()}` : ''
          }`,
        })),
      );

      // Re-read INSIDE the transaction: the status has to describe the
      // rows as they are after this return, and computing it from the
      // rows we read before it would miss a concurrent return of another
      // line on the same slip.
      const rows = await this.issues.linesFor(issue.id, tx);
      await this.issues.setStatus(
        issue.id,
        deriveIssueStatus(
          rows.map((row) => ({
            qty: Number(row.qty),
            returnedQty: Number(row.returnedQty),
          })),
        ),
        actor.sub,
        tx,
      );
    });

    this.audit.set({
      entityType: 'StockIssue',
      entityId: issue.id,
      oldValues: { status: issue.status },
      newValues: { returned: verdict.lines.length },
    });

    return this.get(issue.id, actor);
  }

  /**
   * Roadmap §4's stock adjustment and §8's "bulk adjustment wizard from
   * count sheet import", which are the same endpoint: a list of counted
   * quantities and one reason.
   *
   * The caller sends **what is on the shelf**, not a delta. Deriving the
   * movement here is what keeps every ledger row a movement — see the
   * engine's third decision — and it means a count sheet can be imported
   * exactly as it was written.
   *
   * Items whose count already matches are skipped silently: an adjustment
   * of zero is a ledger row saying nothing happened, and a 400-item stock
   * take would otherwise bury the eleven real differences under them.
   */
  async adjust(dto: CreateAdjustmentDto, actor: AccessTokenPayload) {
    const itemIds = dto.lines.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException(
        'An item may appear only once in an adjustment',
      );
    }

    const items = await this.items.findManyLive(actor.schoolId, {
      ids: itemIds,
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const id of itemIds) {
      if (!byId.has(id)) {
        throw new NotFoundException(`Item ${id} is not in the catalogue`);
      }
    }

    const balances = await this.stock.balances(actor.schoolId, itemIds);
    const applied: Array<{
      itemId: string;
      itemName: string;
      expected: number;
      counted: number;
      difference: number;
      direction: 'IN' | 'OUT';
    }> = [];

    for (const line of dto.lines) {
      const expected = balances.get(line.itemId) ?? 0;
      const counted = StockService.qty(line.countedQty);
      const difference = StockService.qty(counted - expected);
      if (difference === 0) continue;
      applied.push({
        itemId: line.itemId,
        itemName: byId.get(line.itemId)?.name ?? '',
        expected,
        counted,
        difference: Math.abs(difference),
        direction: difference > 0 ? 'IN' : 'OUT',
      });
    }

    if (applied.length === 0) {
      return {
        adjusted: [],
        message: 'Every count matched the ledger — nothing to adjust.',
      };
    }

    await this.stock.withTransaction(async (tx) =>
      this.stock.recordMany(
        tx,
        actor.schoolId,
        actor.sub,
        applied.map((row) => ({
          itemId: row.itemId,
          txn: StockTxnType.ADJUST,
          quantity: row.difference,
          direction: row.direction,
          refType: REF_TYPES.ADJUSTMENT,
          // The reason is mandatory in the DTO and pinned by
          // `chk_stock_ledger_reason`; it also records what the count
          // moved FROM, because "corrected to 8" means nothing later
          // without knowing the ledger said 12.
          remarks: `${dto.reason.trim()} (ledger ${row.expected} → counted ${row.counted})`,
        })),
      ),
    );

    this.audit.set({
      entityType: 'StockAdjustment',
      entityId: actor.schoolId,
      newValues: { items: applied.length, reason: dto.reason.trim() },
    });

    return { adjusted: applied, message: null };
  }

  // ── internals ───────────────────────────────────────────────────────

  private async issueContext(
    schoolId: string,
    dto: CreateIssueDto,
  ): Promise<{
    context: Map<string, IssueLineContext>;
    /** Not part of the verdict — kept beside it so the ledger row can
     *  record what the stock was worth when it left, which is what makes
     *  the consumption report's value column possible. */
    unitCosts: Map<string, number | null>;
  }> {
    const itemIds = [...new Set(dto.lines.map((line) => line.itemId))];
    const [items, balances] = await Promise.all([
      this.items.findManyLive(schoolId, { ids: itemIds }),
      this.stock.balances(schoolId, itemIds),
    ]);

    return {
      context: new Map(
        items.map((item) => [
          item.id,
          {
            itemId: item.id,
            itemName: item.name,
            itemCode: item.code,
            type: item.type,
            unit: item.unit,
            available: balances.get(item.id) ?? 0,
          },
        ]),
      ),
      unitCosts: new Map(
        items.map((item) => [
          item.id,
          item.lastUnitCost === null ? null : Number(item.lastUnitCost),
        ]),
      ),
    };
  }

  /**
   * The holder shape, validated before the CHECK sees it — so the message
   * names the missing field instead of surfacing
   * `chk_stock_issues_recipient` to a clerk.
   */
  private async assertHolder(
    holder: HolderDto,
    schoolId: string,
  ): Promise<void> {
    if (holder.type === InventoryHolderType.DEPARTMENT) {
      if (!holder.departmentId) {
        throw new BadRequestException('Choose the department it is going to');
      }
      const exists = await this.directory.departmentExists(
        schoolId,
        holder.departmentId,
      );
      if (!exists) {
        throw new NotFoundException(
          `Department ${holder.departmentId} not found`,
        );
      }
      return;
    }

    if (holder.type === InventoryHolderType.PERSON) {
      if (!holder.personType || !holder.personId) {
        throw new BadRequestException('Choose the person signing for it');
      }
      const person = await this.directory.lookup(
        schoolId,
        holder.personType,
        holder.personId,
      );
      if (!person) {
        throw new NotFoundException('That employee record was not found');
      }
      return;
    }

    if (!holder.room?.trim()) {
      throw new BadRequestException('Name the room it is going to');
    }
  }

  /** The DTO's holder → the three columns, exactly as the CHECK wants. */
  private holderColumns(holder: HolderDto) {
    return {
      issuedToType: holder.type,
      issuedToDeptId:
        holder.type === InventoryHolderType.DEPARTMENT
          ? (holder.departmentId ?? null)
          : null,
      issuedToPersonType:
        holder.type === InventoryHolderType.PERSON
          ? (holder.personType ?? null)
          : null,
      issuedToPersonId:
        holder.type === InventoryHolderType.PERSON
          ? (holder.personId ?? null)
          : null,
      issuedToRoom:
        holder.type === InventoryHolderType.ROOM
          ? (holder.room?.trim() ?? null)
          : null,
    };
  }

  /**
   * The holder is resolved **live**, never snapshotted onto the slip. A
   * register that stored the name would keep printing "Mr Rahman" after
   * he left, and "who has the school's chalk" has to be a question about
   * now — the M25 live-fare reasoning, applied to people.
   */
  private async decorate(schoolId: string, issue: IssueWithLines) {
    let holderName: string | null = null;

    if (issue.issuedToType === InventoryHolderType.DEPARTMENT) {
      holderName = issue.issuedToDept?.name ?? null;
    } else if (
      issue.issuedToType === InventoryHolderType.PERSON &&
      issue.issuedToPersonType &&
      issue.issuedToPersonId
    ) {
      const person = await this.directory.lookup(
        schoolId,
        issue.issuedToPersonType,
        issue.issuedToPersonId,
      );
      holderName = person ? `${person.name} (${person.reference})` : null;
    } else {
      holderName = issue.issuedToRoom;
    }

    return {
      ...issue,
      holderName,
      outstanding: outstandingLines(
        issue.items.map((line) => ({
          issueItemId: line.id,
          qty: Number(line.qty),
          returnedQty: Number(line.returnedQty),
        })),
      ),
    };
  }

  /** Consumables only — the picker the desk shows. */
  async issuableItems(schoolId: string, search?: string) {
    const items = await this.items.findManyLive(schoolId, {
      type: ItemType.CONSUMABLE,
      search,
    });
    const balances = await this.stock.balances(
      schoolId,
      items.map((item) => item.id),
    );
    return items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      packSize: item.packSize === null ? null : Number(item.packSize),
      packLabel: item.packLabel,
      available: balances.get(item.id) ?? 0,
    }));
  }

  /** Exposed for the e2e suite's transaction-scoped fixtures. */
  withTransaction<R>(fn: (tx: PrismaClientLike) => Promise<R>): Promise<R> {
    return this.stock.withTransaction(fn);
  }
}
