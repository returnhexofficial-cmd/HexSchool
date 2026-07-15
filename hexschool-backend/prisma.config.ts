// Prisma 7 CLI configuration (datasource urls no longer live in the
// schema file). The runtime connection is configured separately in
// PrismaService via the pg driver adapter.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node src/database/seeds/seed.ts',
  },
});
