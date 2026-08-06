// Prisma 7 CLI configuration (datasource urls no longer live in the
// schema file). The runtime connection is configured separately in
// PrismaService via the pg driver adapter.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    // Only used by `prisma migrate diff --from-migrations` — the zero-drift
    // check every module runs before it ships — and by `migrate dev`'s
    // shadow replay. Spread in **only when set**, because `env()` throws on
    // a missing variable and every ordinary CLI call (generate, deploy,
    // seed) would then fail on a knob it never reads.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node src/database/seeds/seed.ts',
  },
});
