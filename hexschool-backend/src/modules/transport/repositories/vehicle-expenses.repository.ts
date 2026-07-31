import { Injectable } from '@nestjs/common';
import { Prisma, VehicleExpense, VehicleExpenseType } from '@prisma/client';
import { BaseRepository } from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const EXPENSE_INCLUDE = {
  vehicle: { select: { id: true, regNo: true, type: true } },
} satisfies Prisma.VehicleExpenseInclude;

export type ExpenseWithVehicle = Prisma.VehicleExpenseGetPayload<{
  include: typeof EXPENSE_INCLUDE;
}>;

export interface ExpenseFilter {
  vehicleId?: string;
  type?: VehicleExpenseType;
  from?: Date;
  to?: Date;
}

@Injectable()
export class VehicleExpensesRepository extends BaseRepository<
  VehicleExpense,
  Prisma.VehicleExpenseWhereInput,
  Prisma.VehicleExpenseUncheckedCreateInput,
  Prisma.VehicleExpenseUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.vehicleExpense, 'VehicleExpense');
  }

  private where(
    schoolId: string,
    filter: ExpenseFilter,
  ): Prisma.VehicleExpenseWhereInput {
    return {
      schoolId,
      deletedAt: null,
      ...(filter.vehicleId ? { vehicleId: filter.vehicleId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };
  }

  async findMany(
    schoolId: string,
    filter: ExpenseFilter,
    page: number,
    limit: number,
  ): Promise<{ rows: ExpenseWithVehicle[]; total: number }> {
    const where = this.where(schoolId, filter);
    const [rows, total] = await Promise.all([
      this.prisma.vehicleExpense.findMany({
        where,
        include: EXPENSE_INCLUDE,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicleExpense.count({ where }),
    ]);
    return { rows, total };
  }

  async findAllFor(
    schoolId: string,
    filter: ExpenseFilter,
  ): Promise<ExpenseWithVehicle[]> {
    return this.prisma.vehicleExpense.findMany({
      where: this.where(schoolId, filter),
      include: EXPENSE_INCLUDE,
      orderBy: [{ date: 'asc' }],
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<ExpenseWithVehicle | null> {
    return this.prisma.vehicleExpense.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: EXPENSE_INCLUDE,
    });
  }
}
