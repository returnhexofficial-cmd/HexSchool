import 'dotenv/config';
import { assertLocalDatabase } from './guard';

/**
 * Standalone guard (`npm run qa:guard`), used as the **first** link in the
 * `qa:reset` chain.
 *
 * `qa:reset` runs `prisma migrate reset`, which drops every table. The guard
 * inside the QA seeder cannot protect against that, because the seeder is the
 * *last* step — by the time it refuses, the database is already gone. So the
 * check has to run before Prisma is invoked at all.
 *
 * This matters because `prisma.config.ts` does `import 'dotenv/config'` and
 * `.env` points `DATABASE_URL` at the Neon dev database. Without the override,
 * an unguarded `qa:reset` would reset Neon.
 */
try {
  const target = assertLocalDatabase();
  console.log(`QA guard OK → ${target}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
