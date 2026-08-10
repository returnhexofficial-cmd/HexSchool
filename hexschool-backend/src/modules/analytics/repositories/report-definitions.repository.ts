import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ReportDefinition as ReportDefinitionRow,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * `report_definitions` — a **system catalog**, so this repository does not
 * extend `BaseRepository`: there is no `school_id` to scope by and no
 * `deleted_at` to exclude (the `permissions` table's arrangement).
 *
 * The only write path is the seeder's sync.
 */
@Injectable()
export class ReportDefinitionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(includeOrphaned = false): Promise<ReportDefinitionRow[]> {
    return this.prisma.reportDefinition.findMany({
      where: includeOrphaned ? {} : { isOrphaned: false },
      orderBy: [{ module: 'asc' }, { name: 'asc' }],
    });
  }

  findByCode(code: string): Promise<ReportDefinitionRow | null> {
    return this.prisma.reportDefinition.findUnique({ where: { code } });
  }

  /**
   * Idempotent upsert of one registry entry — the `rbac.seeder` shape.
   * `is_orphaned` is reset to false on every sync, so a code that was
   * removed and later restored comes back live rather than staying
   * flagged.
   */
  async sync(
    entry: Omit<
      Prisma.ReportDefinitionUncheckedCreateInput,
      'id' | 'createdAt' | 'updatedAt' | 'isOrphaned'
    >,
  ): Promise<void> {
    await this.prisma.reportDefinition.upsert({
      where: { code: entry.code },
      create: { ...entry, isOrphaned: false },
      update: { ...entry, isOrphaned: false },
    });
  }

  /**
   * Flags every stored code the file no longer declares.
   *
   * **Never a delete.** `report_schedules` and `report_runs` carry a
   * foreign key to `code`, so deleting one would either fail or take a
   * school's Monday-morning email with it. Flagging hides it from the
   * catalog and leaves the history intact — the permission registry's
   * orphan rule, for the same reason.
   */
  async flagOrphans(liveCodes: string[]): Promise<number> {
    const result = await this.prisma.reportDefinition.updateMany({
      where: { code: { notIn: liveCodes }, isOrphaned: false },
      data: { isOrphaned: true },
    });
    return result.count;
  }
}
