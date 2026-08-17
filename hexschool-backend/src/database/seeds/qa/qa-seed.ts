import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { assertLocalDatabase } from './guard';
import {
  QA_ACCOUNTS,
  QA_PASSWORD,
  qaEmail,
  seedQaDemoSchool,
} from './demo-school.seeder';

/**
 * QA demo-data seed (`npm run seed:qa`).
 *
 * Runs *after* the bootstrap seed (`npm run seed`), which owns the permission
 * registry, system roles and other reference data. This one owns the throwaway
 * demo school that browser QA drives: a login per role, two academic sessions,
 * academic structure, staff, teachers, students, guardians and enrollments.
 *
 * Destructive and re-runnable — it purges its own previous output first. The
 * localhost guard is what makes that safe, because `.env` points at Neon.
 *
 *   docker compose up -d postgres redis minio mailpit
 *   DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" npm run seed:qa
 */
async function main(): Promise<void> {
  const target = assertLocalDatabase();
  console.log(`QA seed → ${target}\n`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL as string),
  });

  try {
    await seedQaDemoSchool(prisma);
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n  Seeded logins — every account uses the same password:\n');
  console.log(`    password: ${QA_PASSWORD}\n`);
  const width = Math.max(...QA_ACCOUNTS.map((a) => qaEmail(a.key).length));
  for (const a of QA_ACCOUNTS) {
    console.log(
      `    ${qaEmail(a.key).padEnd(width)}  ${a.roleSlug.padEnd(18)} ${a.userType}`,
    );
  }
  console.log(
    '\n  Plus the bootstrap super admin: admin@hexschool.local / ChangeMe123!\n',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
