import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Budget, BudgetPeriod } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { money } from '../../fee/calc/money.util';
import { CreateBudgetDto, UpdateBudgetDto } from '../dto';
import {
  AccountingConfigRepository,
  BudgetWithAccount,
} from '../repositories/accounting-config.repository';
import { AccountsRepository } from '../repositories/accounts.repository';

/**
 * Budgets (roadmap M20 §3/§5). A plan, per account, per session — yearly
 * or split by month.
 *
 * Only income and expense accounts may be budgeted. Budgeting an asset
 * would be a target for a balance rather than for a flow, and
 * `budget-vs-actual` compares *movement in the window* against the
 * figure — so a "budget" on a cash account would compare a plan against
 * an amount that means something else entirely.
 */
@Injectable()
export class BudgetService {
  constructor(
    private readonly config: AccountingConfigRepository,
    private readonly accounts: AccountsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    sessionId: string,
    schoolId: string,
  ): Promise<BudgetWithAccount[]> {
    return this.config.findBudgets(schoolId, sessionId);
  }

  async create(
    dto: CreateBudgetDto,
    actor: AccessTokenPayload,
  ): Promise<Budget> {
    const schoolId = actor.schoolId;
    const account = await this.accounts.findById(dto.accountId, schoolId);
    if (!account) throw new NotFoundException('Account not found');

    if (account.group !== 'INCOME' && account.group !== 'EXPENSE') {
      throw new BadRequestException(
        `${account.code} ${account.name} is a ${account.group.toLowerCase()} account — only income and expense accounts carry a budget`,
      );
    }
    if (account.isGroup) {
      throw new BadRequestException(
        `${account.code} is a heading — budget its child accounts instead, and the heading's total follows`,
      );
    }

    const period = dto.period ?? BudgetPeriod.YEARLY;
    const month = period === BudgetPeriod.MONTHLY ? (dto.month ?? null) : null;
    if (period === BudgetPeriod.MONTHLY && !month) {
      throw new BadRequestException('A monthly budget needs a month (1–12)');
    }

    const clash = await this.config.findBudgetIdentity({
      schoolId,
      sessionId: dto.sessionId,
      accountId: dto.accountId,
      month,
    });
    if (clash) {
      throw new ConflictException(
        `${account.code} already has a ${month ? `budget for month ${month}` : 'yearly budget'} in this session — edit it instead`,
      );
    }

    const created = await this.config.createBudget({
      schoolId,
      sessionId: dto.sessionId,
      accountId: dto.accountId,
      period,
      month,
      amount: money(dto.amount),
      note: dto.note?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Budget',
      entityId: created.id,
      newValues: { account: account.code, amount: dto.amount, month },
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateBudgetDto,
    actor: AccessTokenPayload,
  ): Promise<Budget> {
    const budget = await this.config.findBudgetById(id, actor.schoolId);
    if (!budget) throw new NotFoundException(`Budget ${id} not found`);

    const updated = await this.config.updateBudget(id, {
      ...(dto.amount !== undefined ? { amount: money(dto.amount) } : {}),
      ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Budget',
      entityId: id,
      oldValues: { amount: Number(budget.amount) },
      newValues: { amount: dto.amount ?? Number(budget.amount) },
    });
    return updated;
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const budget = await this.config.findBudgetById(id, actor.schoolId);
    if (!budget) throw new NotFoundException(`Budget ${id} not found`);
    await this.config.softDeleteBudget(id);
    this.auditContext.set({
      entityType: 'Budget',
      entityId: id,
      oldValues: { amount: Number(budget.amount) },
    });
  }
}
