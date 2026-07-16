import { Injectable } from '@nestjs/common';
import { Prisma, Shift } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

/** Hard-deleted (spec: audit only) — delete guarded by countReferences. */
@Injectable()
export class ShiftsRepository extends BaseRepository<
  Shift,
  Prisma.ShiftWhereInput,
  Prisma.ShiftUncheckedCreateInput,
  Prisma.ShiftUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.shift, 'Shift', {
      softDeletable: false,
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.shift.delete({ where: { id } });
  }

  /** Live sections still pointing here (delete guard). */
  async countReferences(id: string): Promise<number> {
    return this.prisma.section.count({
      where: { shiftId: id, deletedAt: null },
    });
  }
}
