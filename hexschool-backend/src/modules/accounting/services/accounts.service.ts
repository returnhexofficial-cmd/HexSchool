import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account } from '@prisma/client';
import { AccountGroup, AccountType } from '../../../common/constants';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { AuditContextService } from '../../audit/services/audit-context.service';
import { money } from '../../fee/calc/money.util';
import {
  AccountNode,
  AccountTreeNode,
  buildTree,
  codeError,
  flattenTree,
  suggestCode,
  wouldCycle,
} from '../calc/coa.engine';
import {
  AccountQueryDto,
  CreateAccountDto,
  SuggestCodeQueryDto,
  UpdateAccountDto,
} from '../dto';
import { AccountsRepository } from '../repositories/accounts.repository';

/**
 * The chart of accounts (roadmap M20 §4 "COA CRUD with seeded BD-school
 * default tree").
 *
 * Three rules shape everything here:
 *
 *   - **A heading is not a place money lands.** `is_group` is set at
 *     creation and cannot be turned on once entries exist, because a node
 *     that already holds postings would be counted twice the moment it
 *     became a subtotal.
 *   - **A system account may be renamed, never removed.** Auto-posting
 *     resolves through the posting map to real accounts; deleting "Cash
 *     in Hand" would silently break every fee receipt, and the failure
 *     would surface hours later in a job log.
 *   - **Nothing that has been posted to is deletable.** The audit trail
 *     of a school's money is the whole point; a ledger with a dangling
 *     account id is not a ledger.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── read ────────────────────────────────────────────────────────────

  async list(query: AccountQueryDto, schoolId: string): Promise<Account[]> {
    return this.accounts.findAllForSchool(schoolId, {
      group: query.group,
      type: query.type,
      search: query.search,
      postableOnly: query.postableOnly,
      activeOnly: query.activeOnly,
    });
  }

  async getById(id: string, schoolId: string): Promise<Account> {
    const account = await this.accounts.findById(id, schoolId);
    if (!account) throw new NotFoundException(`Account ${id} not found`);
    return account;
  }

  /**
   * The whole COA as a forest, one group per root band. Accounts are
   * loaded flat and nested in the engine — see the repository doc.
   */
  async tree(schoolId: string): Promise<{
    groups: Array<{
      group: AccountGroup;
      roots: AccountTreeNode<AccountNode & { raw: Account }>[];
    }>;
    flat: Array<{ id: string; code: string; name: string; depth: number }>;
  }> {
    const accounts = await this.accounts.findAllForSchool(schoolId);
    const nodes = accounts.map((account) => ({
      ...toNode(account),
      raw: account,
    }));

    const groups = (
      [
        AccountGroup.ASSET,
        AccountGroup.LIABILITY,
        AccountGroup.EQUITY,
        AccountGroup.INCOME,
        AccountGroup.EXPENSE,
      ] as AccountGroup[]
    ).map((group) => ({
      group,
      roots: buildTree(nodes.filter((node) => node.group === group)),
    }));

    const flat = groups.flatMap(({ roots }) =>
      flattenTree(roots).map(({ account, depth }) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        depth,
      })),
    );

    return { groups, flat };
  }

  /** Code auto-suggest for the create dialog (roadmap §5). */
  async suggestCode(
    query: SuggestCodeQueryDto,
    schoolId: string,
  ): Promise<{ code: string }> {
    const all = await this.accounts.findAllForSchool(schoolId);
    const parent = query.parentId
      ? all.find((account) => account.id === query.parentId)
      : undefined;

    const siblings = all
      .filter(
        (account) => (account.parentId ?? null) === (query.parentId ?? null),
      )
      .filter((account) => (parent ? true : account.group === query.group))
      .map((account) => account.code);

    return {
      code: suggestCode({
        group: parent?.group ?? query.group,
        siblings,
        parentCode: parent?.code ?? null,
        depth: parent ? depthOf(all, parent.id) + 1 : 0,
      }),
    };
  }

  // ── write ───────────────────────────────────────────────────────────

  async create(
    dto: CreateAccountDto,
    actor: AccessTokenPayload,
  ): Promise<Account> {
    const schoolId = actor.schoolId;
    const code = dto.code.trim();

    const shape = codeError(code);
    if (shape) throw new BadRequestException(shape);

    const clash = await this.accounts.findByCode(code, schoolId);
    if (clash) {
      throw new ConflictException(
        `Account code ${code} is already used by "${clash.name}"`,
      );
    }

    const group = await this.resolveGroup(dto.parentId, dto.group, schoolId);

    if (dto.isGroup && dto.openingBalance) {
      throw new BadRequestException(
        'A heading holds no money of its own — it is the sum of its children. Leave the opening balance at 0.',
      );
    }

    const created = await this.accounts.create({
      schoolId,
      parentId: dto.parentId ?? null,
      group,
      type: dto.type ?? defaultType(group),
      code,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      openingBalance: money(dto.openingBalance ?? 0),
      bankAccountNo: dto.bankAccountNo?.trim() || null,
      bankName: dto.bankName?.trim() || null,
      branchName: dto.branchName?.trim() || null,
      isGroup: dto.isGroup ?? false,
      description: dto.description?.trim() || null,
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Account',
      entityId: created.id,
      newValues: {
        code: created.code,
        name: created.name,
        group: created.group,
      },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateAccountDto,
    actor: AccessTokenPayload,
  ): Promise<Account> {
    const schoolId = actor.schoolId;
    const account = await this.getById(id, schoolId);
    const entryCount = await this.accounts.countEntries(id);

    if (dto.code && dto.code.trim() !== account.code) {
      const shape = codeError(dto.code);
      if (shape) throw new BadRequestException(shape);
      const clash = await this.accounts.findByCode(
        dto.code.trim(),
        schoolId,
        id,
      );
      if (clash) {
        throw new ConflictException(
          `Account code ${dto.code.trim()} is already used by "${clash.name}"`,
        );
      }
    }

    // Becoming a heading once money has landed would double-count every
    // posting: once on the node itself, once inside its own subtotal.
    if (dto.isGroup === true && !account.isGroup && entryCount > 0) {
      throw new ConflictException(
        `${account.code} already carries ${entryCount} posting(s) and cannot become a heading — create a child account instead`,
      );
    }

    if (dto.parentId !== undefined && dto.parentId !== account.parentId) {
      const all = await this.accounts.findAllForSchool(schoolId);
      if (wouldCycle(all.map(toNode), id, dto.parentId ?? null)) {
        throw new ConflictException(
          'That would put the account inside its own branch',
        );
      }
    }

    // A system account is renameable but never deactivatable — see the
    // service doc for why the failure mode is so bad.
    if (account.isSystem && dto.isActive === false) {
      throw new ConflictException(
        `${account.code} ${account.name} is a system account used by auto-posting and cannot be deactivated`,
      );
    }

    const group = dto.parentId
      ? await this.resolveGroup(dto.parentId, dto.group, schoolId)
      : (dto.group ?? account.group);

    // The group decides which statement an account appears on, so moving
    // it after money has landed would restate history.
    if (group !== account.group && entryCount > 0) {
      throw new ConflictException(
        `${account.code} already carries ${entryCount} posting(s) — changing its group would move those amounts to a different statement`,
      );
    }

    const updated = await this.accounts.update(id, {
      ...(dto.code ? { code: dto.code.trim() } : {}),
      ...(dto.name ? { name: dto.name.trim() } : {}),
      ...(dto.nameBn !== undefined
        ? { nameBn: dto.nameBn?.trim() || null }
        : {}),
      ...(dto.parentId !== undefined ? { parentId: dto.parentId ?? null } : {}),
      ...(dto.type ? { type: dto.type } : {}),
      group,
      ...(dto.openingBalance !== undefined
        ? { openingBalance: money(dto.openingBalance) }
        : {}),
      ...(dto.bankAccountNo !== undefined
        ? { bankAccountNo: dto.bankAccountNo?.trim() || null }
        : {}),
      ...(dto.bankName !== undefined
        ? { bankName: dto.bankName?.trim() || null }
        : {}),
      ...(dto.branchName !== undefined
        ? { branchName: dto.branchName?.trim() || null }
        : {}),
      ...(dto.isGroup !== undefined ? { isGroup: dto.isGroup } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description?.trim() || null }
        : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Account',
      entityId: id,
      oldValues: {
        code: account.code,
        name: account.name,
        group: account.group,
        isActive: account.isActive,
      },
      newValues: {
        code: updated.code,
        name: updated.name,
        group: updated.group,
        isActive: updated.isActive,
      },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const account = await this.getById(id, actor.schoolId);

    if (account.isSystem) {
      throw new ConflictException(
        `${account.code} ${account.name} is a system account used by auto-posting and cannot be deleted — deactivate is refused too, for the same reason`,
      );
    }

    const [children, entries, budgets, mappings] = await Promise.all([
      this.accounts.countChildren(id),
      this.accounts.countEntries(id),
      this.accounts.countBudgets(id),
      this.accounts.countPostingMaps(id),
    ]);

    if (entries > 0) {
      throw new ConflictException(
        `${account.code} carries ${entries} posting(s) — an account money has passed through is history and cannot be deleted. Deactivate it instead.`,
      );
    }
    if (children > 0) {
      throw new ConflictException(
        `${account.code} has ${children} child account(s) — remove or re-parent them first`,
      );
    }
    if (budgets > 0) {
      throw new ConflictException(
        `${account.code} is used by ${budgets} budget line(s)`,
      );
    }
    if (mappings > 0) {
      throw new ConflictException(
        `${account.code} is a posting-map target — point that mapping elsewhere first`,
      );
    }

    await this.accounts.softDelete(id);
    this.auditContext.set({
      entityType: 'Account',
      entityId: id,
      oldValues: { code: account.code, name: account.name },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  /**
   * A child always inherits its parent's group. Letting a caller state a
   * different one would file an expense under Assets and quietly move
   * money between two statements — so the parent wins, silently and
   * always, rather than the request being refused for a field the UI
   * does not even show once a parent is chosen.
   */
  private async resolveGroup(
    parentId: string | undefined,
    requested: AccountGroup | undefined,
    schoolId: string,
  ): Promise<AccountGroup> {
    if (!parentId) {
      if (!requested) {
        throw new BadRequestException('A top-level account needs a group');
      }
      return requested;
    }
    const parent = await this.accounts.findById(parentId, schoolId);
    if (!parent) throw new NotFoundException(`Parent account not found`);
    return parent.group;
  }
}

function toNode(account: Account): AccountNode {
  return {
    id: account.id,
    parentId: account.parentId,
    group: account.group,
    code: account.code,
    name: account.name,
    isGroup: account.isGroup,
    isActive: account.isActive,
    displayOrder: account.displayOrder,
  };
}

function depthOf(accounts: Account[], id: string): number {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  let depth = 0;
  let current = byId.get(id);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentId);
    depth += 1;
  }
  return depth;
}

function defaultType(group: AccountGroup): AccountType {
  switch (group) {
    case AccountGroup.INCOME:
      return AccountType.INCOME;
    case AccountGroup.EXPENSE:
      return AccountType.EXPENSE;
    case AccountGroup.EQUITY:
      return AccountType.EQUITY;
    default:
      return AccountType.OTHER;
  }
}
