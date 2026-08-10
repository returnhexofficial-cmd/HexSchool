import { PrismaClient } from '@prisma/client';
import { PERMISSION_REGISTRY } from '../../rbac/registry/permission.registry';
import { REPORT_REGISTRY } from '../reports/report.registry';

/**
 * Syncs `report.registry.ts` into `report_definitions` — roadmap §3's
 * "registry table replacing the code-only registry", implemented the way
 * `rbac.seeder` syncs the permission registry: **the file is the source of
 * truth, the table is its projection**, and the sync is idempotent.
 *
 * A plain function over `PrismaClient` rather than a Nest service, because
 * `src/database/seeds/seed.ts` runs standalone — there is no container.
 * That is why `is_runnable` is taken from the definition's own claim
 * rather than from the live executor registry: the seeder cannot see the
 * DI graph. `report.registry.spec.ts` asserts that the claim and the bound
 * executors agree exactly, and `ReportExecutorRegistry` logs it loudly at
 * boot if they ever stop agreeing, so the claim is safe to trust here.
 */
export async function syncReportRegistry(
  prisma: PrismaClient,
): Promise<{ synced: number; orphaned: number; unknownPermissions: string[] }> {
  const permissionCodes = new Set(PERMISSION_REGISTRY.map((p) => p.code));
  const unknownPermissions: string[] = [];

  for (const definition of REPORT_REGISTRY) {
    if (!permissionCodes.has(definition.permission)) {
      unknownPermissions.push(`${definition.code} → ${definition.permission}`);
    }

    const row = {
      code: definition.code,
      name: definition.name,
      module: definition.module,
      description: definition.description,
      paramsSchema: definition.params as unknown as object,
      permission: definition.permission,
      sensitivePermission: definition.sensitivePermission ?? null,
      output: definition.output,
      formats: definition.formats as unknown as object,
      endpoint: definition.endpoint ?? null,
      isRunnable: definition.runnable,
      freshness: definition.freshness ?? null,
      isOrphaned: false,
    };

    await prisma.reportDefinition.upsert({
      where: { code: definition.code },
      create: row,
      update: row,
    });
  }

  // Never a delete: `report_schedules` and `report_runs` carry a foreign
  // key to `code`, so removing one would either fail or take a school's
  // Monday-morning email with it. The permission registry's orphan rule,
  // for the same reason.
  const { count: orphaned } = await prisma.reportDefinition.updateMany({
    where: {
      code: { notIn: REPORT_REGISTRY.map((d) => d.code) },
      isOrphaned: false,
    },
    data: { isOrphaned: true },
  });

  return { synced: REPORT_REGISTRY.length, orphaned, unknownPermissions };
}
