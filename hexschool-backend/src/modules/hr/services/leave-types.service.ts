import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveType, Prisma } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { CreateLeaveTypeDto, UpdateLeaveTypeDto } from '../dto';
import { LeaveTypesRepository } from '../repositories/leave.repository';

/**
 * The leave taxonomy (roadmap M21 §3/§4). What M08 kept as a PG enum is a
 * table here, because a leave type carries an annual quota, a
 * carry-forward rule and — the one payroll actually depends on — a
 * paid/unpaid flag.
 *
 * `code` is the stable handle: the M21 data migration keyed the old enum
 * values on it, the seeder recognises what a school already has by it,
 * and payroll finds the unpaid types with it. Renaming the *name* is
 * free; the code is not.
 */
@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly types: LeaveTypesRepository,
    private readonly auditContext: AuditContextService,
  ) {}

  async list(
    schoolId: string,
    options: { activeOnly?: boolean } = {},
  ): Promise<LeaveType[]> {
    return this.types.findAllForSchool(schoolId, options);
  }

  async getOrFail(id: string, schoolId: string): Promise<LeaveType> {
    const type = await this.types.findById(id, schoolId);
    if (!type) throw new NotFoundException(`Leave type ${id} not found`);
    return type;
  }

  async create(
    dto: CreateLeaveTypeDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveType> {
    const schoolId = actor.schoolId;
    await this.assertCodeFree(schoolId, dto.code);
    this.assertCarryConsistent(dto);

    const created = await this.types.create({
      schoolId,
      name: dto.name.trim(),
      code: dto.code.trim().toUpperCase(),
      annualQuota: dto.annualQuota ?? 0,
      carryForward: dto.carryForward ?? false,
      maxCarry: dto.carryForward ? (dto.maxCarry ?? 0) : 0,
      isPaid: dto.isPaid ?? true,
      ...(dto.applicableTo ? { applicableTo: dto.applicableTo } : {}),
      isActive: dto.isActive ?? true,
      displayOrder: dto.displayOrder ?? 0,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'LeaveType',
      entityId: created.id,
      newValues: snapshot(created),
    });
    return created;
  }

  async update(
    id: string,
    dto: UpdateLeaveTypeDto,
    actor: AccessTokenPayload,
  ): Promise<LeaveType> {
    const existing = await this.getOrFail(id, actor.schoolId);
    if (dto.code && dto.code.toUpperCase() !== existing.code) {
      await this.assertCodeFree(actor.schoolId, dto.code);
    }
    const carryForward = dto.carryForward ?? existing.carryForward;
    this.assertCarryConsistent({
      carryForward,
      maxCarry: dto.maxCarry ?? Number(existing.maxCarry),
    });

    const data: Prisma.LeaveTypeUncheckedUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.code !== undefined
        ? { code: dto.code.trim().toUpperCase() }
        : {}),
      ...(dto.annualQuota !== undefined
        ? { annualQuota: dto.annualQuota }
        : {}),
      ...(dto.carryForward !== undefined ? { carryForward } : {}),
      // The CHECK pins `max_carry` to 0 when carry-forward is off, so
      // switching it off has to clear the cap in the same write.
      ...(dto.maxCarry !== undefined || dto.carryForward !== undefined
        ? {
            maxCarry: carryForward
              ? (dto.maxCarry ?? Number(existing.maxCarry))
              : 0,
          }
        : {}),
      ...(dto.isPaid !== undefined ? { isPaid: dto.isPaid } : {}),
      ...(dto.applicableTo !== undefined
        ? { applicableTo: dto.applicableTo }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      updatedBy: actor.sub,
    };

    const updated = await this.types.update(id, data);
    this.auditContext.set({
      entityType: 'LeaveType',
      entityId: id,
      oldValues: snapshot(existing),
      newValues: snapshot(updated),
    });
    return updated;
  }

  /**
   * Delete a type — refused once anything hangs off it.
   *
   * A leave already taken against "Sick Leave" has to keep naming it, on
   * the register and on every payslip that deducted for it. Deactivating
   * the type is the way to retire it, which is why `is_active` exists.
   */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.getOrFail(id, actor.schoolId);
    const used = await this.types.countApplications(id);
    if (used > 0) {
      throw new ConflictException(
        `${existing.name} has ${used} leave application(s) against it — deactivate it instead of deleting it`,
      );
    }
    await this.types.softDelete(id);
    this.auditContext.set({
      entityType: 'LeaveType',
      entityId: id,
      oldValues: snapshot(existing),
    });
  }

  private async assertCodeFree(schoolId: string, code: string): Promise<void> {
    const existing = await this.types.findByCode(
      schoolId,
      code.trim().toUpperCase(),
    );
    if (existing) {
      throw new ConflictException(
        `Leave type code ${code.toUpperCase()} is already used by "${existing.name}"`,
      );
    }
  }

  private assertCarryConsistent(input: {
    carryForward?: boolean;
    maxCarry?: number;
  }): void {
    if (!input.carryForward && (input.maxCarry ?? 0) > 0) {
      throw new ConflictException(
        'A carry-forward cap only means something when carry-forward is on',
      );
    }
  }
}

function snapshot(type: LeaveType) {
  return {
    name: type.name,
    code: type.code,
    annualQuota: Number(type.annualQuota),
    carryForward: type.carryForward,
    maxCarry: Number(type.maxCarry),
    isPaid: type.isPaid,
    applicableTo: type.applicableTo,
    isActive: type.isActive,
  };
}
