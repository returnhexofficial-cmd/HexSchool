import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, PostingMapKind } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SYSTEM_SLOTS, SystemSlot } from '../calc/posting.engine';
import { UpdatePostingMapDto } from '../dto';
import {
  AccountingConfigRepository,
  PostingMapWithAccount,
} from '../repositories/accounting-config.repository';
import { AccountsRepository } from '../repositories/accounts.repository';

/**
 * A system slot's stable account code in the seeded BD chart. The posting
 * map is the configurable layer on top; these are the fallbacks that make
 * a freshly-seeded school post correctly before anybody configures
 * anything, which is what stops the first fee receipt of a new deployment
 * from failing to reach the ledger.
 */
export const SYSTEM_SLOT_CODES: Readonly<Record<SystemSlot, string>> = {
  [SYSTEM_SLOTS.FEE_INCOME_DEFAULT]: '4100',
  [SYSTEM_SLOTS.LATE_FINE_INCOME]: '4400',
  [SYSTEM_SLOTS.CASH_DEFAULT]: '1110',
  [SYSTEM_SLOTS.GATEWAY_CHARGES]: '5600',
  [SYSTEM_SLOTS.OPENING_EQUITY]: '3100',
  // M21 — already present in the seeded 61-account BD chart, which is why
  // payroll posts correctly on a fresh school with nothing configured.
  [SYSTEM_SLOTS.SALARY_EXPENSE]: '5100',
  [SYSTEM_SLOTS.BONUS_EXPENSE]: '5110',
  [SYSTEM_SLOTS.PF_EXPENSE]: '5120',
  [SYSTEM_SLOTS.PF_PAYABLE]: '2120',
  [SYSTEM_SLOTS.TAX_PAYABLE]: '2130',
  [SYSTEM_SLOTS.SALARY_PAYABLE]: '2110',
};

export interface ResolvedPostingMap {
  /** feeHeadId → income account id. */
  heads: Map<string, string>;
  /** `payment_method_enum` value → funds/clearing account id. */
  methods: Map<string, string>;
  /** System slot → account id. */
  system: Map<string, string>;
}

@Injectable()
export class PostingMapService {
  constructor(
    private readonly config: AccountingConfigRepository,
    private readonly accounts: AccountsRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(schoolId: string): Promise<PostingMapWithAccount[]> {
    return this.config.findMappings(schoolId);
  }

  /**
   * Replace a set of mappings. Each entry with a `null` account clears its
   * row and falls back to the system default, so "unset" is expressible
   * without a second endpoint.
   */
  async update(
    dto: UpdatePostingMapDto,
    actor: AccessTokenPayload,
  ): Promise<PostingMapWithAccount[]> {
    const schoolId = actor.schoolId;

    for (const mapping of dto.mappings) {
      if (!mapping.accountId) {
        await this.config.clearMapping(schoolId, mapping.kind, mapping.refKey);
        continue;
      }

      const account = await this.accounts.findById(mapping.accountId, schoolId);
      if (!account) {
        throw new NotFoundException(`Account ${mapping.accountId} not found`);
      }
      // A heading cannot take a posting, so mapping to one would produce
      // a voucher that fails validation every single time — refuse it
      // here, where the person can still fix it.
      if (account.isGroup) {
        throw new ConflictException(
          `${account.code} ${account.name} is a heading — auto-posting needs an account money can land in`,
        );
      }
      if (!account.isActive) {
        throw new ConflictException(
          `${account.code} ${account.name} is inactive and cannot be a posting target`,
        );
      }
      await this.config.setMapping({
        schoolId,
        kind: mapping.kind,
        refKey: mapping.refKey,
        accountId: mapping.accountId,
        actorId: actor.sub,
      });
    }

    this.auditContext.set({
      entityType: 'PostingMap',
      entityId: schoolId,
      newValues: {
        changed: dto.mappings.map((m) => `${m.kind}:${m.refKey}`),
      },
    });

    return this.list(schoolId);
  }

  /**
   * Everything auto-posting needs, in one read: the configured mappings
   * plus the seeded system accounts they fall back to.
   *
   * Resolving the fallback by ACCOUNT CODE rather than by a stored id
   * keeps a freshly-seeded school working with no configuration, and
   * keeps working if somebody renames "Cash in Hand" — the code is the
   * stable handle, which is exactly what a chart of accounts is for.
   */
  async resolve(schoolId: string): Promise<ResolvedPostingMap> {
    const [mappings, accounts] = await Promise.all([
      this.config.findMappings(schoolId),
      this.accounts.findAllForSchool(schoolId, { activeOnly: true }),
    ]);

    const byCode = new Map<string, Account>(
      accounts.map((account) => [account.code, account]),
    );

    const heads = new Map<string, string>();
    const methods = new Map<string, string>();
    const system = new Map<string, string>();

    for (const mapping of mappings) {
      if (mapping.kind === PostingMapKind.FEE_HEAD) {
        heads.set(mapping.refKey, mapping.accountId);
      } else if (mapping.kind === PostingMapKind.PAYMENT_METHOD) {
        methods.set(mapping.refKey, mapping.accountId);
      } else {
        system.set(mapping.refKey, mapping.accountId);
      }
    }

    for (const [slot, code] of Object.entries(SYSTEM_SLOT_CODES)) {
      if (system.has(slot)) continue;
      const account = byCode.get(code);
      if (account && !account.isGroup) system.set(slot, account.id);
    }

    return { heads, methods, system };
  }

  /**
   * The account a slot resolves to, or `null` when a school has neither
   * configured it nor kept the seeded default. Callers report that rather
   * than throwing, because an unmapped slot must not take fee collection
   * down with it.
   */
  slot(map: ResolvedPostingMap, name: SystemSlot): string | null {
    return map.system.get(name) ?? null;
  }
}
