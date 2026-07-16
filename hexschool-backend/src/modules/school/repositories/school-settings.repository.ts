import { Injectable } from '@nestjs/common';
import { Prisma, SchoolSetting, SettingsGroup } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Key-value settings rows. Standalone (config rows, no soft delete, no
 * pagination) but still the only ORM touchpoint for the entity.
 */
@Injectable()
export class SchoolSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findGroup(
    schoolId: string,
    group: SettingsGroup,
  ): Promise<SchoolSetting[]> {
    return this.prisma.schoolSetting.findMany({
      where: { schoolId, group },
      orderBy: { key: 'asc' },
    });
  }

  async findByKeys(schoolId: string, keys: string[]): Promise<SchoolSetting[]> {
    if (keys.length === 0) return [];
    return this.prisma.schoolSetting.findMany({
      where: { schoolId, key: { in: keys } },
    });
  }

  /** Upsert a batch of keys atomically. */
  async upsertMany(
    schoolId: string,
    group: SettingsGroup,
    entries: Array<{ key: string; value: Prisma.InputJsonValue }>,
    updatedBy: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      entries.map(({ key, value }) =>
        this.prisma.schoolSetting.upsert({
          where: { schoolId_key: { schoolId, key } },
          create: { schoolId, group, key, value, updatedBy },
          update: { value, updatedBy },
        }),
      ),
    );
  }
}
