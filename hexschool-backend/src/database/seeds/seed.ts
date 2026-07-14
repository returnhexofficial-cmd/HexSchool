import 'dotenv/config';
import AppDataSource from '../data-source';
import type { DataSource } from 'typeorm';

/**
 * Idempotent seed runner (`npm run seed`). Each module appends its seeder
 * here (Module 03: permission registry + system roles, Module 04: NCTB
 * grading system, ...). Seeders must be safe to re-run.
 */
type Seeder = { name: string; run: (ds: DataSource) => Promise<void> };

const seeders: Seeder[] = [
  // Module 01 ships no business data — structure only.
];

async function main(): Promise<void> {
  const ds = await AppDataSource.initialize();
  try {
    for (const seeder of seeders) {
      process.stdout.write(`Seeding: ${seeder.name}... `);
      await seeder.run(ds);
      process.stdout.write('done\n');
    }
    if (seeders.length === 0) {
      console.log('No seeders registered yet (expected before Module 03).');
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
