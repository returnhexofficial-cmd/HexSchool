import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global so every module's repositories can inject PrismaService directly. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
