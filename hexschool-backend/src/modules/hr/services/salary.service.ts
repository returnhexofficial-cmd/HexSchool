import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendancePersonType,
  PaymentMode,
  Prisma,
  SalaryCalc,
  SalaryComponentType,
} from '@prisma/client';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  ComponentSpec,
  StructureComputation,
  computeStructure,
  structureProblems,
} from '../calc/salary.engine';
import {
  AssignSalaryDto,
  CreateStructureDto,
  PreviewStructureDto,
  SalaryComponentDto,
  UpdateStructureDto,
} from '../dto';
import {
  Employee,
  EmployeesRepository,
} from '../repositories/employees.repository';
import {
  EmployeeSalariesRepository,
  SalaryStructuresRepository,
  SalaryWithStructure,
  StructureWithComponents,
} from '../repositories/salary.repository';
import { HrSettingsService } from './hr-settings.service';

/**
 * Salary structures and their assignment to people.
 *
 * The rule that shapes this service is that **an assignment is history,
 * not a setting**: `PUT /employees/:id/salary` writes a NEW
 * `employee_salaries` row with an `effective_from` date rather than
 * editing the one that is there. Regenerating March's payroll then reads
 * March's row, and an increment dated 1 July does not silently restate
 * the six payslips before it (roadmap §3, "History kept — no update in
 * place").
 *
 * A correction to a *mistake* is the exception: re-saving for the SAME
 * effective date replaces that row, which is what
 * `uq_employee_salaries_identity` is for. Two rows for one person on one
 * date would leave "the salary in force on 1 March" with no answer.
 */
@Injectable()
export class SalaryService {
  constructor(
    private readonly structures: SalaryStructuresRepository,
    private readonly salaries: EmployeeSalariesRepository,
    private readonly employees: EmployeesRepository,
    private readonly config: HrSettingsService,
    private readonly auditContext: AuditContextService,
  ) {}

  // ── structures ──────────────────────────────────────────────────────

  async listStructures(
    schoolId: string,
    options: { activeOnly?: boolean; search?: string } = {},
  ): Promise<
    Array<StructureWithComponents & { computed: StructureComputation }>
  > {
    const rows = await this.structures.findAllForSchool(schoolId, options);
    const pfBase = (await this.config.load(schoolId)).pfBase;
    return rows.map((row) => ({
      ...row,
      computed: computeStructure(Number(row.basic), toSpecs(row.components), {
        pfBase,
      }),
    }));
  }

  async getStructure(
    id: string,
    schoolId: string,
  ): Promise<StructureWithComponents & { computed: StructureComputation }> {
    const row = await this.structures.findDetail(id, schoolId);
    if (!row) throw new NotFoundException(`Salary structure ${id} not found`);
    const pfBase = (await this.config.load(schoolId)).pfBase;
    return {
      ...row,
      computed: computeStructure(Number(row.basic), toSpecs(row.components), {
        pfBase,
      }),
    };
  }

  /**
   * Live preview for the structure builder — the same engine the payslip
   * runs through, so what the author sees is what the month will pay.
   */
  async preview(
    dto: PreviewStructureDto,
    schoolId: string,
  ): Promise<{ computed: StructureComputation; problems: unknown[] }> {
    const pfBase = (await this.config.load(schoolId)).pfBase;
    const specs = toSpecs(dto.components);
    return {
      computed: computeStructure(dto.basic, specs, { pfBase }),
      problems: structureProblems(dto.basic, specs),
    };
  }

  async createStructure(
    dto: CreateStructureDto,
    actor: AccessTokenPayload,
  ): Promise<StructureWithComponents & { computed: StructureComputation }> {
    const schoolId = actor.schoolId;
    this.assertSound(dto.basic, dto.components);
    await this.assertNameFree(schoolId, dto.name);

    const created = await this.structures.withTransaction(async (tx) => {
      const structure = await this.structures.create(
        {
          schoolId,
          name: dto.name.trim(),
          grade: dto.grade?.trim() || null,
          basic: dto.basic,
          description: dto.description?.trim() || null,
          isActive: dto.isActive ?? true,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );
      await this.structures.replaceComponents(
        structure.id,
        componentRows(schoolId, dto.components),
        tx,
      );
      return structure;
    });

    this.auditContext.set({
      entityType: 'SalaryStructure',
      entityId: created.id,
      newValues: {
        name: dto.name,
        basic: dto.basic,
        lines: dto.components.length,
      },
    });
    return this.getStructure(created.id, schoolId);
  }

  async updateStructure(
    id: string,
    dto: UpdateStructureDto,
    actor: AccessTokenPayload,
  ): Promise<StructureWithComponents & { computed: StructureComputation }> {
    const schoolId = actor.schoolId;
    const existing = await this.getStructure(id, schoolId);

    const basic = dto.basic ?? Number(existing.basic);
    const components = dto.components ?? toDtos(existing.components);
    this.assertSound(basic, components);
    if (dto.name && dto.name.trim() !== existing.name) {
      await this.assertNameFree(schoolId, dto.name);
    }

    await this.structures.withTransaction(async (tx) => {
      await this.structures.update(
        id,
        {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.grade !== undefined
            ? { grade: dto.grade?.trim() || null }
            : {}),
          ...(dto.basic !== undefined ? { basic: dto.basic } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedBy: actor.sub,
        },
        tx,
      );
      if (dto.components) {
        await this.structures.replaceComponents(
          id,
          componentRows(schoolId, dto.components),
          tx,
        );
      }
    });

    this.auditContext.set({
      entityType: 'SalaryStructure',
      entityId: id,
      oldValues: {
        name: existing.name,
        basic: Number(existing.basic),
        lines: existing.components.length,
      },
      newValues: {
        name: dto.name ?? existing.name,
        basic,
        lines: components.length,
      },
    });
    return this.getStructure(id, schoolId);
  }

  /**
   * Delete a structure — refused while anybody is on it.
   *
   * Deleting one out from under a live assignment would leave the next
   * payroll run unable to say what somebody is paid, and the FK is
   * `Restrict` for exactly that reason. Deactivating keeps the history
   * readable and stops new assignments, which is what a school actually
   * wants when a pay scale is retired.
   */
  async removeStructure(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getStructure(id, actor.schoolId);
    const assigned = await this.structures.countAssignments(id);
    if (assigned > 0) {
      throw new ConflictException(
        `${existing.name} is assigned to ${assigned} employee(s) — deactivate it instead of deleting it`,
      );
    }
    await this.structures.softDelete(id);
    this.auditContext.set({
      entityType: 'SalaryStructure',
      entityId: id,
      oldValues: { name: existing.name, basic: Number(existing.basic) },
    });
  }

  // ── assignment ──────────────────────────────────────────────────────

  async history(
    schoolId: string,
    personType: AttendancePersonType,
    personId: string,
  ): Promise<{
    employee: Employee;
    current: SalaryWithStructure | null;
    history: SalaryWithStructure[];
  }> {
    const employee = await this.employees.findOne(
      schoolId,
      personType,
      personId,
    );
    if (!employee) {
      throw new NotFoundException(
        `No ${personType.toLowerCase()} found for ${personId}`,
      );
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [rows, current] = await Promise.all([
      this.salaries.findHistory(schoolId, personType, personId),
      this.salaries.findEffective(schoolId, personType, personId, today),
    ]);
    return { employee, current, history: rows };
  }

  async assign(
    personId: string,
    dto: AssignSalaryDto,
    actor: AccessTokenPayload,
  ): Promise<SalaryWithStructure> {
    const schoolId = actor.schoolId;
    const employee = await this.employees.findOne(
      schoolId,
      dto.personType,
      personId,
    );
    if (!employee) {
      throw new NotFoundException(
        `No ${dto.personType.toLowerCase()} found for ${personId}`,
      );
    }

    const structure = await this.structures.findDetail(
      dto.structureId,
      schoolId,
    );
    if (!structure) {
      throw new NotFoundException(
        `Salary structure ${dto.structureId} not found`,
      );
    }
    if (!structure.isActive) {
      throw new ConflictException(
        `${structure.name} is inactive and cannot take new assignments`,
      );
    }

    const effectiveFrom = parseDate(dto.effectiveFrom);
    const paymentMode =
      dto.paymentMode ?? (await this.config.load(schoolId)).defaultPaymentMode;

    // Roadmap §7: bank fields are required when the mode is BANK. A bank
    // advice sheet with a blank account number is a payment nobody can
    // make, and the sheet is generated weeks after this row is saved.
    if (paymentMode === PaymentMode.BANK) {
      const account = dto.bankAccount;
      if (!account?.accountNo || !account.bankName) {
        throw new BadRequestException(
          'Bank name and account number are required when the payment mode is BANK',
        );
      }
    }

    const existing = await this.salaries.findOnDate(
      schoolId,
      dto.personType,
      personId,
      effectiveFrom,
    );

    const data = {
      schoolId,
      personType: dto.personType,
      personId,
      structureId: dto.structureId,
      basicOverride: dto.basicOverride ?? null,
      effectiveFrom,
      bankAccount: (dto.bankAccount ?? null) as Prisma.InputJsonValue,
      paymentMode,
      note: dto.note?.trim() || null,
      updatedBy: actor.sub,
    };

    // Same effective date = a correction of that row (the identity index
    // would refuse a second one anyway); a new date = a new history row.
    const saved = existing
      ? await this.salaries.update(existing.id, data)
      : await this.salaries.create({ ...data, createdBy: actor.sub });

    this.auditContext.set({
      entityType: 'EmployeeSalary',
      entityId: saved.id,
      oldValues: existing
        ? {
            structureId: existing.structureId,
            basicOverride: existing.basicOverride
              ? Number(existing.basicOverride)
              : null,
          }
        : undefined,
      newValues: {
        employee: employee.name,
        structure: structure.name,
        effectiveFrom: dto.effectiveFrom,
        basicOverride: dto.basicOverride ?? null,
        paymentMode,
      },
    });

    const row = await this.salaries.findEffective(
      schoolId,
      dto.personType,
      personId,
      effectiveFrom,
    );
    if (!row) {
      // Unreachable: we just wrote a row on or before this date.
      throw new NotFoundException('Salary assignment could not be read back');
    }
    return row;
  }

  /** Remove one history row (a mis-dated assignment, not a pay change). */
  async removeAssignment(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.salaries.findById(id, actor.schoolId);
    if (!existing)
      throw new NotFoundException(`Salary assignment ${id} not found`);
    await this.salaries.softDelete(id);
    this.auditContext.set({
      entityType: 'EmployeeSalary',
      entityId: id,
      oldValues: {
        personId: existing.personId,
        effectiveFrom: isoDate(existing.effectiveFrom),
        structureId: existing.structureId,
      },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertSound(basic: number, components: SalaryComponentDto[]): void {
    const problems = structureProblems(basic, toSpecs(components));
    if (problems.length > 0) {
      throw new ConflictException({
        message: problems[0].message,
        details: { problems },
      });
    }
  }

  private async assertNameFree(schoolId: string, name: string): Promise<void> {
    const rows = await this.structures.findAllForSchool(schoolId);
    if (
      rows.some((row) => row.name.toLowerCase() === name.trim().toLowerCase())
    ) {
      throw new ConflictException(
        `A salary structure named "${name}" already exists`,
      );
    }
  }
}

function toSpecs(
  components: ReadonlyArray<{
    name: string;
    // Widened to `string`: this accepts both DTO values and Prisma rows,
    // and the two enums are string unions the branches below narrow.
    type: string;
    calc?: string | null;
    value: unknown;
    isTaxable?: boolean;
    isPfBase?: boolean;
    displayOrder?: number;
  }>,
): ComponentSpec[] {
  return components.map((component, index) => ({
    name: component.name,
    type: component.type === 'DEDUCTION' ? 'DEDUCTION' : 'ALLOWANCE',
    calc: component.calc === 'PERCENT_OF_BASIC' ? 'PERCENT_OF_BASIC' : 'FLAT',
    value: Number(component.value),
    isTaxable: component.isTaxable ?? true,
    isPfBase: component.isPfBase ?? false,
    displayOrder: component.displayOrder ?? index,
  }));
}

function toDtos(
  components: ReadonlyArray<{
    name: string;
    type: SalaryComponentType;
    calc: SalaryCalc;
    value: unknown;
    isTaxable: boolean;
    isPfBase: boolean;
  }>,
): SalaryComponentDto[] {
  return components.map((component) => ({
    name: component.name,
    type: component.type,
    calc: component.calc,
    value: Number(component.value),
    isTaxable: component.isTaxable,
    isPfBase: component.isPfBase,
  }));
}

function componentRows(
  schoolId: string,
  components: SalaryComponentDto[],
): Array<Omit<Prisma.SalaryComponentUncheckedCreateInput, 'structureId'>> {
  return components.map((component, index) => ({
    schoolId,
    name: component.name.trim(),
    type: component.type,
    calc: component.calc ?? SalaryCalc.FLAT,
    value: component.value,
    isTaxable: component.isTaxable ?? true,
    isPfBase: component.isPfBase ?? false,
    displayOrder: index,
  }));
}
