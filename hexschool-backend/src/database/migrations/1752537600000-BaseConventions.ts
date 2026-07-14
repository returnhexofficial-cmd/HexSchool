import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Module 01 base migration — conventions only, no business tables.
 * - pgcrypto: gen_random_uuid() for all UUID primary keys.
 * - citext: case-insensitive emails/identifiers (used from Module 02).
 */
export class BaseConventions1752537600000 implements MigrationInterface {
  name = 'BaseConventions1752537600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "citext"');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP EXTENSION IF EXISTS "citext"');
    await queryRunner.query('DROP EXTENSION IF EXISTS "pgcrypto"');
  }
}
