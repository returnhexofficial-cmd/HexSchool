import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserType } from '@prisma/client';
import * as argon2 from 'argon2';
import { DEFAULT_SCHOOL_ID } from '../../common/constants';
import {
  ensureUserRole,
  seedSystemRoles,
  syncPermissionRegistry,
} from '../../modules/rbac/seed/rbac.seeder';
import { seedNctbGradingSystem } from '../../modules/school/seed/school.seeder';

/**
 * Idempotent seed runner (`npm run seed`, also wired to `prisma migrate`
 * via prisma.config.ts). Each module appends its seeder here (Module 03:
 * permission registry + system roles, Module 04: NCTB grading system, ...).
 * Seeders must be safe to re-run.
 */
type Seeder = { name: string; run: (prisma: PrismaClient) => Promise<void> };

const SUPER_ADMIN_EMAIL = 'admin@hexschool.local';

const seeders: Seeder[] = [
  {
    // Module 02: bootstrap Super Admin (forced password change on first
    // login). Password comes from SEED_SUPER_ADMIN_PASSWORD when set.
    name: 'super-admin (M02)',
    run: async (prisma) => {
      const existing = await prisma.user.findFirst({
        where: { email: SUPER_ADMIN_EMAIL, deletedAt: null },
      });
      if (existing) {
        console.log('already present — skipped;');
        return;
      }
      const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe123!';
      await prisma.user.create({
        data: {
          schoolId: DEFAULT_SCHOOL_ID,
          email: SUPER_ADMIN_EMAIL,
          passwordHash: await argon2.hash(password, {
            type: argon2.argon2id,
          }),
          userType: UserType.SUPER_ADMIN,
          mustChangePassword: true,
        },
      });
      console.log(
        `created ${SUPER_ADMIN_EMAIL}` +
          (process.env.SEED_SUPER_ADMIN_PASSWORD
            ? ' (password from env);'
            : ' (default password "ChangeMe123!" — change on first login);'),
      );
    },
  },
  {
    // Module 03: sync the TS permission registry into `permissions`
    // (new codes inserted, removed codes flagged orphaned).
    name: 'permission-registry (M03)',
    run: async (prisma) => {
      const { synced, orphaned } = await syncPermissionRegistry(prisma);
      process.stdout.write(`${synced} codes, ${orphaned} newly orphaned; `);
    },
  },
  {
    // Module 03: system roles with their core permission sets, plus the
    // super-admin role on the bootstrap Super Admin (≥1-role invariant).
    name: 'system-roles (M03)',
    run: async (prisma) => {
      await seedSystemRoles(prisma, DEFAULT_SCHOOL_ID);
      const superAdmin = await prisma.user.findFirst({
        where: { email: SUPER_ADMIN_EMAIL, deletedAt: null },
      });
      if (superAdmin) {
        await ensureUserRole(
          prisma,
          superAdmin.id,
          DEFAULT_SCHOOL_ID,
          'super-admin',
        );
      }
    },
  },
  {
    // Module 04: NCTB default grading system (the school row itself is
    // created by the M04 migration — FK ordering).
    name: 'nctb-grading-system (M04)',
    run: async (prisma) => {
      const created = await seedNctbGradingSystem(prisma, DEFAULT_SCHOOL_ID);
      process.stdout.write(created ? 'created; ' : 'already present; ');
    },
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL as string),
  });
  try {
    for (const seeder of seeders) {
      process.stdout.write(`Seeding: ${seeder.name}... `);
      await seeder.run(prisma);
      process.stdout.write('done\n');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
