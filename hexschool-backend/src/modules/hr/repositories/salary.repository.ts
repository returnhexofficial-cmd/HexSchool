import { Injectable } from '@nestjs/common';
import {
  AttendancePersonType,
  EmployeeSalary,
  Prisma,
  SalaryComponent,
  SalaryStructure,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

export type StructureWithComponents = SalaryStructure & {
  components: SalaryComponent[];
};

export type SalaryWithStructure = EmployeeSalary & {
  structure: StructureWithComponents;
};

@Injectable()
export class SalaryStructuresRepository extends BaseRepository<
  SalaryStructure,
  Prisma.SalaryStructureWhereInput,
  Prisma.SalaryStructureUncheckedCreateInput,
  Prisma.SalaryStructureUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.salaryStructure, 'SalaryStructure');
  }

  async findAllForSchool(
    schoolId: string,
    options: { activeOnly?: boolean; search?: string } = {},
  ): Promise<StructureWithComponents[]> {
    return this.prisma.salaryStructure.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(options.activeOnly ? { isActive: true } : {}),
        ...(options.search
          ? { name: { contains: options.search, mode: 'insensitive' } }
          : {}),
      },
      include: { components: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<StructureWithComponents | null> {
    return this.prisma.salaryStructure.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: { components: { orderBy: { displayOrder: 'asc' } } },
    });
  }

  /**
   * Replace the component set wholesale, inside a transaction.
   *
   * Components are hard-deleted and rewritten rather than diffed (the
   * M13/M19/M20 wholesale-replacement precedent): a pay scale is authored
   * as a whole, and a half-applied edit computes a wrong payslip for
   * everybody on it.
   */
  async replaceComponents(
    structureId: string,
    rows: Array<
      Omit<Prisma.SalaryComponentUncheckedCreateInput, 'structureId'>
    >,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.salaryComponent.deleteMany({ where: { structureId } });
    if (rows.length === 0) return;
    await client.salaryComponent.createMany({
      data: rows.map((row) => ({ ...row, structureId })),
    });
  }

  /** Live salary assignments on a structure — the delete guard reads it. */
  async countAssignments(structureId: string): Promise<number> {
    return this.prisma.employeeSalary.count({
      where: { structureId, deletedAt: null },
    });
  }
}

@Injectable()
export class EmployeeSalariesRepository extends BaseRepository<
  EmployeeSalary,
  Prisma.EmployeeSalaryWhereInput,
  Prisma.EmployeeSalaryUncheckedCreateInput,
  Prisma.EmployeeSalaryUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.employeeSalary, 'EmployeeSalary');
  }

  /** Every assignment a person has ever held, newest first. */
  async findHistory(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<SalaryWithStructure[]> {
    return this.prisma.employeeSalary.findMany({
      where: { schoolId, personType, personId, deletedAt: null },
      include: {
        structure: {
          include: { components: { orderBy: { displayOrder: 'asc' } } },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * The assignment in force on `asOf` — the latest `effective_from` on or
   * before that date. A future-dated increment is deliberately invisible
   * until its month arrives, which is what makes salary history replay:
   * regenerating March reads March's row, not today's.
   */
  async findEffective(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    asOf: Date,
  ): Promise<SalaryWithStructure | null> {
    return this.prisma.employeeSalary.findFirst({
      where: {
        schoolId,
        personType,
        personId,
        deletedAt: null,
        effectiveFrom: { lte: asOf },
      },
      include: {
        structure: {
          include: { components: { orderBy: { displayOrder: 'asc' } } },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * The effective assignment for every employee at once.
   *
   * Payroll generation needs the whole workforce's salary as of one date;
   * this loads every live row up to that date and picks the latest per
   * person in memory, which is two orders of magnitude fewer round trips
   * than a per-person `findEffective` and correct for any school small
   * enough to run on one database (the M13 conflict-engine caveat).
   */
  async findEffectiveForAll(
    schoolId: string,
    asOf: Date,
  ): Promise<Map<string, SalaryWithStructure>> {
    const rows = await this.prisma.employeeSalary.findMany({
      where: { schoolId, deletedAt: null, effectiveFrom: { lte: asOf } },
      include: {
        structure: {
          include: { components: { orderBy: { displayOrder: 'asc' } } },
        },
      },
      orderBy: { effectiveFrom: 'asc' },
    });

    // Ascending order means the last write per key wins — which is the
    // latest effective row, exactly what `findEffective` returns.
    const byPerson = new Map<string, SalaryWithStructure>();
    for (const row of rows) {
      byPerson.set(`${row.personType}:${row.personId}`, row);
    }
    return byPerson;
  }

  async findOnDate(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
    effectiveFrom: Date,
  ): Promise<EmployeeSalary | null> {
    return this.prisma.employeeSalary.findFirst({
      where: {
        schoolId,
        personType,
        personId,
        effectiveFrom,
        deletedAt: null,
      },
    });
  }
}
