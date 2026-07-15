import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Single PrismaClient for the whole app, connected through the pg driver
 * adapter (Prisma 7 style — no Rust engine). `$connect` failing at boot
 * makes bootstrap throw → non-zero exit → orchestrator restarts (Module 01
 * business rule: never serve errors with a dead DB).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg(config.getOrThrow<string>('database.url')),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
