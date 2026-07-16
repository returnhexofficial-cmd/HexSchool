import { Injectable } from '@nestjs/common';
import { Prisma, School } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** The tenant root itself — not school-scoped (it IS the scope). */
@Injectable()
export class SchoolsRepository extends BaseRepository<
  School,
  Prisma.SchoolWhereInput,
  Prisma.SchoolUncheckedCreateInput,
  Prisma.SchoolUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.school, 'School', {
      schoolScoped: false,
    });
  }
}
