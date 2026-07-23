import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, Student, StudentMedicalInfo } from '@prisma/client';
import { InvoicesRepository } from '../../fee/repositories/invoices.repository';
import { ResultsRepository } from '../../result/repositories/results.repository';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import {
  AttendanceStatus,
  StudentStatus,
  UserStatus,
} from '../../../common/constants';
import { PaginatedResult } from '../../../common/dto/paginated.dto';
import { parseDate } from '../../academic/calendar/date.util';
import { ClassesRepository } from '../../academic/repositories/classes.repository';
import {
  countByStatus,
  presentEquivalent,
} from '../../attendance/calc/percentage.util';
import { StudentAttendancesRepository } from '../../attendance/repositories/student-attendances.repository';
import { AuditContextService } from '../../audit/services/audit-context.service';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { RefreshTokensRepository } from '../../auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SettingsService } from '../../school/services/settings.service';
import { SequenceService } from '../../sequence/sequence.service';
import { StorageService } from '../../storage/storage.service';
import {
  CheckDuplicatesDto,
  CreateStudentDto,
  StudentGuardianEntryDto,
  StudentQueryDto,
  UpdateMedicalInfoDto,
  UpdateStudentDto,
  UpdateStudentStatusDto,
} from '../dto';
import { STUDENT_EVENTS } from '../events/student.events';
import type {
  StudentCreatedEvent,
  StudentStatusChangedEvent,
} from '../events/student.events';
import { GuardiansRepository } from '../repositories/guardians.repository';
import { StudentGuardiansRepository } from '../repositories/student-guardians.repository';
import { StudentMedicalRepository } from '../repositories/student-medical.repository';
import { StudentStatusHistoryRepository } from '../repositories/student-status-history.repository';
import {
  StudentFullPayload,
  StudentsRepository,
  StudentWithRelations,
} from '../repositories/students.repository';

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_SIZE_PX = 512;
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** BD convention: class 1 ≈ age 6 → expected age = numeric level + 5. */
const AGE_CLASS_OFFSET = 5;
const AGE_CLASS_TOLERANCE = 3;

/** Statuses that end day-to-day membership → portal account deactivated. */
export const EXIT_STATUSES = new Set<StudentStatus>([
  StudentStatus.TRANSFERRED,
  StudentStatus.GRADUATED,
  StudentStatus.DROPPED,
]);

export interface DuplicateWarning {
  studentId: string;
  studentUid: string;
  name: string;
  dob: string;
  reason: 'NAME_DOB' | 'GUARDIAN_PHONE_DOB';
}

export interface StudentDetail extends StudentWithRelations {
  photoSignedUrl: string | null;
}

export interface CreateStudentResult {
  student: StudentDetail;
  /** Never blocking (roadmap M09 §8): duplicates + age-sanity notes. */
  duplicateWarnings: DuplicateWarning[];
  warnings: string[];
}

/**
 * Student master record lifecycle (roadmap M09): direct registration
 * (Admission M10 flows into the same service later), permanent UID from
 * SequenceService, warn-only duplicate detection, status lifecycle with
 * history trail + portal cascade, and the permission-gated medical
 * record. Guardian linking lives in GuardiansService.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly students: StudentsRepository,
    private readonly guardians: GuardiansRepository,
    private readonly links: StudentGuardiansRepository,
    private readonly medical: StudentMedicalRepository,
    private readonly statusHistory: StudentStatusHistoryRepository,
    private readonly classes: ClassesRepository,
    // Re-provisioned stateless repositories (M07 convention) — the
    // student history tabs read enrollment/attendance without importing
    // those modules (both import StudentModule).
    private readonly enrollments: EnrollmentsRepository,
    private readonly attendances: StudentAttendancesRepository,
    private readonly results: ResultsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly schools: SchoolsRepository,
    private readonly settings: SettingsService,
    private readonly sequences: SequenceService,
    private readonly storage: StorageService,
    private readonly auditContext: AuditContextService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    query: StudentQueryDto,
    schoolId: string,
  ): Promise<PaginatedResult<StudentWithRelations>> {
    return this.students.paginateList(query, schoolId);
  }

  async getDetail(id: string, schoolId: string): Promise<StudentDetail> {
    const student = await this.students.findDetail(id, schoolId);
    if (!student) throw new NotFoundException(`Student ${id} not found`);
    return this.withPhotoUrl(student);
  }

  /** /students/:id/full — profile + guardians + documents + status trail.
   *  Medical stays behind its own permission-gated endpoint (M09 §6). */
  async getFull(
    id: string,
    schoolId: string,
  ): Promise<StudentFullPayload & { photoSignedUrl: string | null }> {
    const student = await this.students.findFull(id, schoolId);
    if (!student) throw new NotFoundException(`Student ${id} not found`);
    return {
      ...student,
      photoSignedUrl: student.photoUrl
        ? await this.storage.getSignedUrl(student.photoUrl, 3600, 'photos')
        : null,
    };
  }

  async create(
    dto: CreateStudentDto,
    actor: AccessTokenPayload,
  ): Promise<CreateStudentResult> {
    const dob = parseDate(dto.dob);
    const admissionDate = parseDate(dto.admissionDate);
    if (dob.getTime() >= admissionDate.getTime()) {
      throw new BadRequestException('Admission date must be after birth date');
    }

    const admissionClass = await this.classes.findByIdOrFail(
      dto.admissionClassId,
      actor.schoolId,
    );

    this.assertGuardianEntries(dto.guardians);
    await this.assertBirthCertificateAvailable(
      dto.birthCertificateNo,
      actor.schoolId,
    );

    const school = await this.schools.findByIdOrFail(actor.schoolId);
    const pattern = await this.settings.getValue<string>(
      actor.schoolId,
      'general.student_id_pattern',
    );

    // Warn-only checks BEFORE the write (roadmap M09 §8 — never block).
    const duplicateWarnings = await this.probeDuplicates(
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dob,
        guardianPhones: this.collectGuardianPhones(dto.guardians),
      },
      actor.schoolId,
    );
    const warnings = this.ageSanityWarnings(
      dob,
      admissionDate,
      admissionClass.numericLevel,
    );

    const student = await this.students.withTransaction(async (tx) => {
      const studentUid = await this.sequences.nextDocumentNumber({
        schoolId: actor.schoolId,
        counterKey: `student:${admissionDate.getUTCFullYear()}`,
        pattern,
        schoolCode: school.code,
        date: admissionDate,
        tx,
      });

      const created = await this.students.create(
        {
          schoolId: actor.schoolId,
          studentUid,
          firstName: dto.firstName,
          lastName: dto.lastName,
          nameBn: dto.nameBn,
          gender: dto.gender,
          dob,
          bloodGroup: dto.bloodGroup,
          religion: dto.religion,
          birthCertificateNo: dto.birthCertificateNo,
          presentAddress: (dto.presentAddress ?? {}) as Prisma.InputJsonValue,
          permanentAddress: (dto.permanentAddress ??
            dto.presentAddress ??
            {}) as Prisma.InputJsonValue,
          admissionDate,
          admissionClassId: dto.admissionClassId,
          previousSchool: dto.previousSchool,
          qrToken: this.newQrToken(),
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );

      await this.linkGuardianEntries(created.id, dto.guardians, actor, tx);
      return created;
    });

    this.events.emit(STUDENT_EVENTS.CREATED, {
      studentId: student.id,
      schoolId: actor.schoolId,
      studentUid: student.studentUid,
      name: `${dto.firstName} ${dto.lastName}`,
    } satisfies StudentCreatedEvent);

    this.auditContext.set({
      entityType: 'Student',
      entityId: student.id,
      newValues: {
        studentUid: student.studentUid,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dob: dto.dob,
        admissionClass: admissionClass.name,
        guardians: dto.guardians.length,
      },
    });

    return {
      student: await this.getDetail(student.id, actor.schoolId),
      duplicateWarnings,
      warnings,
    };
  }

  async update(
    id: string,
    dto: UpdateStudentDto,
    actor: AccessTokenPayload,
  ): Promise<StudentDetail> {
    const existing = await this.students.findByIdOrFail(id, actor.schoolId);

    const dob = dto.dob ? parseDate(dto.dob) : existing.dob;
    const admissionDate = dto.admissionDate
      ? parseDate(dto.admissionDate)
      : existing.admissionDate;
    if (dob.getTime() >= admissionDate.getTime()) {
      throw new BadRequestException('Admission date must be after birth date');
    }
    if (dto.admissionClassId) {
      await this.classes.findByIdOrFail(dto.admissionClassId, actor.schoolId);
    }
    if (
      dto.birthCertificateNo !== undefined &&
      dto.birthCertificateNo &&
      dto.birthCertificateNo !== existing.birthCertificateNo
    ) {
      await this.assertBirthCertificateAvailable(
        dto.birthCertificateNo,
        actor.schoolId,
        id,
      );
    }

    const updated = await this.students.update(id, {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.nameBn !== undefined ? { nameBn: dto.nameBn } : {}),
      ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
      ...(dto.dob !== undefined ? { dob } : {}),
      ...(dto.bloodGroup !== undefined
        ? { bloodGroup: dto.bloodGroup || null }
        : {}),
      ...(dto.religion !== undefined ? { religion: dto.religion } : {}),
      ...(dto.birthCertificateNo !== undefined
        ? { birthCertificateNo: dto.birthCertificateNo || null }
        : {}),
      ...(dto.presentAddress !== undefined
        ? { presentAddress: dto.presentAddress as Prisma.InputJsonValue }
        : {}),
      ...(dto.permanentAddress !== undefined
        ? { permanentAddress: dto.permanentAddress as Prisma.InputJsonValue }
        : {}),
      ...(dto.admissionDate !== undefined ? { admissionDate } : {}),
      ...(dto.admissionClassId !== undefined
        ? { admissionClassId: dto.admissionClassId }
        : {}),
      ...(dto.previousSchool !== undefined
        ? { previousSchool: dto.previousSchool || null }
        : {}),
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Student',
      entityId: id,
      oldValues: this.auditSnapshot(existing),
      newValues: this.auditSnapshot(updated),
    });
    return this.getDetail(id, actor.schoolId);
  }

  /**
   * Status transition with reason + append-only history row. Exit
   * statuses (TRANSFERRED/GRADUATED/DROPPED) deactivate the portal
   * account via the listener; the dues check is a soft warning until
   * Fees (M16) makes it a hard block with override (roadmap M09 §6).
   */
  async updateStatus(
    id: string,
    dto: UpdateStudentStatusDto,
    actor: AccessTokenPayload,
  ): Promise<{ student: StudentDetail; warnings: string[] }> {
    const existing = await this.students.findByIdOrFail(id, actor.schoolId);
    if (existing.status === dto.status) {
      throw new BadRequestException(`Student is already ${dto.status}`);
    }

    // Dues clearance on the way out (roadmap M09 §6). Live since M16:
    // a warning by default, a hard block when the school turns
    // `fees.dues_block_exit_status` on — which is deliberately opt-in,
    // because a school that transfers a student mid-dispute still has
    // to be able to record it.
    const warnings: string[] = [];
    if (EXIT_STATUSES.has(dto.status)) {
      const enrollments = await this.enrollments.findAll(
        { studentId: id },
        actor.schoolId,
      );
      const outstanding = await this.invoices.outstandingByEnrollment(
        enrollments.map((e) => e.id),
        actor.schoolId,
      );
      const owed = [...outstanding.values()].reduce(
        (sum, amount) => sum + amount,
        0,
      );

      if (owed > 0.009) {
        const blocking = await this.settings.getValue<boolean>(
          actor.schoolId,
          'fees.dues_block_exit_status',
        );
        const message = `${existing.firstName} ${existing.lastName} has ${owed.toFixed(2)} BDT outstanding`;
        if (blocking === true) {
          throw new ConflictException(
            `${message} — clear the dues first, or turn off fees.dues_block_exit_status`,
          );
        }
        warnings.push(`${message}. Verify before completing the exit.`);
      }
    }

    await this.students.withTransaction(async (tx) => {
      await this.students.update(
        id,
        { status: dto.status, updatedBy: actor.sub },
        tx,
      );
      await this.statusHistory.append(
        {
          studentId: id,
          fromStatus: existing.status,
          toStatus: dto.status,
          reason: dto.reason,
          changedBy: actor.sub,
        },
        tx,
      );
    });

    this.events.emit(STUDENT_EVENTS.STATUS_CHANGED, {
      studentId: id,
      userId: existing.userId,
      schoolId: actor.schoolId,
      from: existing.status,
      to: dto.status,
      reason: dto.reason,
    } satisfies StudentStatusChangedEvent);

    this.auditContext.set({
      entityType: 'Student',
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status: dto.status, reason: dto.reason },
    });

    return { student: await this.getDetail(id, actor.schoolId), warnings };
  }

  /** Soft-deletes the student and (if provisioned) the portal user; the
   *  UID stays burned. Shared guardians are untouched. */
  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const existing = await this.students.findByIdOrFail(id, actor.schoolId);

    await this.students.withTransaction(async (tx) => {
      await this.students.update(
        id,
        { deletedAt: new Date(), updatedBy: actor.sub },
        tx,
      );
      if (existing.userId) {
        await this.users.update(
          existing.userId,
          {
            deletedAt: new Date(),
            status: UserStatus.INACTIVE,
            updatedBy: actor.sub,
          },
          tx,
        );
      }
    });
    if (existing.userId) {
      await this.refreshTokens.revokeAllForUser(existing.userId);
    }

    this.auditContext.set({
      entityType: 'Student',
      entityId: id,
      oldValues: {
        studentUid: existing.studentUid,
        firstName: existing.firstName,
        lastName: existing.lastName,
        status: existing.status,
      },
    });
  }

  /** Photo upload — identical contract to staff/teachers (M07/M08). */
  async uploadPhoto(
    id: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    actor: AccessTokenPayload,
  ): Promise<StudentDetail> {
    const student = await this.students.findByIdOrFail(id, actor.schoolId);
    if (!file) throw new BadRequestException('Photo file is required');
    if (!PHOTO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Photo must be a JPEG, PNG, or WebP image');
    }
    if (file.size > PHOTO_MAX_BYTES) {
      throw new BadRequestException('Photo must be 2 MB or smaller');
    }

    let resized: Buffer;
    try {
      resized = await sharp(file.buffer)
        .rotate()
        .resize(PHOTO_SIZE_PX, PHOTO_SIZE_PX, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException('File is not a decodable image');
    }

    const uploaded = await this.storage.upload({
      body: resized,
      contentType: 'image/png',
      prefix: `students/${actor.schoolId}/${id}`,
      filename: 'photo.png',
      purpose: 'photos',
    });
    await this.students.update(id, {
      photoUrl: uploaded.key,
      updatedBy: actor.sub,
    });

    this.auditContext.set({
      entityType: 'Student',
      entityId: id,
      oldValues: { photoUrl: student.photoUrl },
      newValues: { photoUrl: uploaded.key },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /** Invalidate the printed QR (lost/stolen card): new token, old cards
   *  stop verifying. */
  async rotateQrToken(
    id: string,
    actor: AccessTokenPayload,
  ): Promise<StudentDetail> {
    await this.students.findByIdOrFail(id, actor.schoolId);
    await this.students.update(id, {
      qrToken: this.newQrToken(),
      updatedBy: actor.sub,
    });
    this.auditContext.set({
      entityType: 'Student',
      entityId: id,
      newValues: { qrToken: '[rotated]' },
    });
    return this.getDetail(id, actor.schoolId);
  }

  /** Wizard pre-submit probe — same detector the create path runs. */
  async checkDuplicates(
    dto: CheckDuplicatesDto,
    schoolId: string,
  ): Promise<DuplicateWarning[]> {
    return this.probeDuplicates(
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        dob: parseDate(dto.dob),
        guardianPhones: dto.guardianPhones ?? [],
      },
      schoolId,
    );
  }

  // ── medical (permission-gated at the controller — M09 §6) ──────────

  async getMedical(
    studentId: string,
    schoolId: string,
  ): Promise<StudentMedicalInfo | { studentId: string }> {
    await this.students.findByIdOrFail(studentId, schoolId);
    return (await this.medical.findForStudent(studentId)) ?? { studentId };
  }

  async updateMedical(
    studentId: string,
    dto: UpdateMedicalInfoDto,
    actor: AccessTokenPayload,
  ): Promise<StudentMedicalInfo> {
    await this.students.findByIdOrFail(studentId, actor.schoolId);
    const before = await this.medical.findForStudent(studentId);

    const record = await this.medical.upsertForStudent(
      studentId,
      actor.schoolId,
      {
        heightCm: dto.heightCm ?? null,
        weightKg: dto.weightKg ?? null,
        allergies: dto.allergies ?? null,
        chronicConditions: dto.chronicConditions ?? null,
        disabilities: dto.disabilities ?? null,
        emergencyNotes: dto.emergencyNotes ?? null,
        ...(before ? {} : { createdBy: actor.sub }),
        updatedBy: actor.sub,
      },
    );

    // Medical values are sensitive — audit records THAT it changed, not
    // the contents (M09 §6: never exported/spread by default).
    this.auditContext.set({
      entityType: 'StudentMedicalInfo',
      entityId: record.id,
      oldValues: { updated: before ? 'existing record' : null },
      newValues: { updated: '[medical record modified]' },
    });
    return record;
  }

  // ── aggregated history (fills as M12/M15 land — empty gracefully) ──

  /**
   * Attendance rollup for the student detail tab. Live since M12: counts
   * come from `student_attendances` via the re-provisioned repository and
   * the percentage from the shared pure engine — no AttendanceModule
   * import, which would close a cycle (attendance imports StudentModule).
   */
  async attendanceHistory(studentId: string, schoolId: string) {
    await this.students.findByIdOrFail(studentId, schoolId);
    const enrollments = await this.enrollments.findAll({ studentId }, schoolId);
    const rows = await this.attendances.findForEnrollments(
      enrollments.map((e) => e.id),
      new Date(Date.UTC(1970, 0, 1)),
      new Date(Date.UTC(2999, 11, 31)),
    );

    const counts = countByStatus(rows);
    const marked = rows.length - counts[AttendanceStatus.HOLIDAY];
    return {
      available: true,
      /** Percentage over MARKED days — the full working-day denominator
       *  lives on `GET /attendance/reports/student/:id`. */
      counts,
      markedDays: marked,
      presentEquivalent: presentEquivalent(counts),
      percentage:
        marked === 0
          ? 0
          : Math.round((presentEquivalent(counts) / marked) * 10000) / 100,
      items: rows.map((row) => ({
        date: row.date,
        status: row.status,
        sectionId: row.sectionId,
        remarks: row.remarks,
      })),
    };
  }

  /**
   * Exam results for the student detail tab. Live since M15, read
   * through the re-provisioned results repository rather than by
   * importing ResultModule — which imports StudentModule, so the reverse
   * would cycle (the same reasoning as the attendance rollup above).
   */
  async performanceHistory(studentId: string, schoolId: string) {
    await this.students.findByIdOrFail(studentId, schoolId);
    const rows = await this.results.findForStudent(studentId, schoolId);

    const published = rows.filter((row) => row.publishedAt !== null);
    return {
      available: true,
      items: rows.map((row) => ({
        examId: row.examId,
        examName: row.exam.name,
        className: row.enrollment.class.name,
        rollNo: row.enrollment.rollNo,
        gpa: Number(row.gpa),
        grade: row.grade,
        status: row.status,
        obtainedMarks: Number(row.obtainedMarks),
        totalMarks: Number(row.totalMarks),
        meritPositionClass: row.meritPositionClass,
        publishedAt: row.publishedAt,
      })),
      /** Averaged over PUBLISHED exams only — a draft result is not a
       *  fact about the student yet. */
      averageGpa:
        published.length === 0
          ? 0
          : Math.round(
              (published.reduce((sum, row) => sum + Number(row.gpa), 0) /
                published.length) *
                100,
            ) / 100,
      examsPublished: published.length,
    };
  }

  // ── internals ─────────────────────────────────────────────────────

  private newQrToken(): string {
    return randomBytes(24).toString('hex');
  }

  private async withPhotoUrl(
    student: StudentWithRelations,
  ): Promise<StudentDetail> {
    return {
      ...student,
      photoSignedUrl: student.photoUrl
        ? await this.storage.getSignedUrl(student.photoUrl, 3600, 'photos')
        : null,
    };
  }

  /** Exactly one primary; every entry resolvable (id or name+phone). */
  private assertGuardianEntries(entries: StudentGuardianEntryDto[]): void {
    let primaries = 0;
    for (const entry of entries) {
      if (!entry.guardianId && !(entry.name && entry.phone)) {
        throw new BadRequestException(
          'Each guardian needs a guardianId or a name + phone',
        );
      }
      if (entry.isPrimary) primaries += 1;
    }
    if (primaries === 0 && entries.length > 0) {
      // Convention: single unmarked entry becomes primary implicitly.
      if (entries.length === 1) {
        entries[0].isPrimary = true;
        return;
      }
      throw new BadRequestException('Mark exactly one guardian as primary');
    }
    if (primaries > 1) {
      throw new BadRequestException('Only one guardian can be primary');
    }
  }

  /** Resolve/dedupe entries (existing id > phone match > create) and link. */
  private async linkGuardianEntries(
    studentId: string,
    entries: StudentGuardianEntryDto[],
    actor: AccessTokenPayload,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const linked = new Set<string>();
    for (const entry of entries) {
      let guardianId = entry.guardianId;
      if (guardianId) {
        const guardian = await this.guardians.findById(
          guardianId,
          actor.schoolId,
        );
        if (!guardian) {
          throw new BadRequestException(`Unknown guardian ${guardianId}`);
        }
      } else {
        // Dedup by phone — siblings share guardian rows (M09 §4).
        const existing = await this.guardians.findByPhone(
          entry.phone!,
          actor.schoolId,
          tx,
        );
        guardianId = existing
          ? existing.id
          : (
              await this.guardians.create(
                {
                  schoolId: actor.schoolId,
                  name: entry.name!,
                  nameBn: entry.nameBn,
                  relation: entry.relation,
                  phone: entry.phone!,
                  email: entry.email,
                  nid: entry.nid,
                  occupation: entry.occupation,
                  monthlyIncome: entry.monthlyIncome,
                  address: (entry.address ?? {}) as Prisma.InputJsonValue,
                  createdBy: actor.sub,
                  updatedBy: actor.sub,
                },
                tx,
              )
            ).id;
      }
      if (linked.has(guardianId)) {
        throw new BadRequestException(
          'The same guardian appears more than once',
        );
      }
      linked.add(guardianId);

      await this.links.link(
        {
          studentId,
          guardianId,
          relation: entry.relation,
          isPrimary: entry.isPrimary ?? false,
          isEmergencyContact: entry.isEmergencyContact ?? false,
        },
        tx,
      );
    }
  }

  private collectGuardianPhones(entries: StudentGuardianEntryDto[]): string[] {
    return entries.map((e) => e.phone).filter((p): p is string => !!p);
  }

  private async probeDuplicates(
    params: {
      firstName: string;
      lastName: string;
      dob: Date;
      guardianPhones: string[];
      excludeId?: string;
    },
    schoolId: string,
  ): Promise<DuplicateWarning[]> {
    const matches = await this.students.findPossibleDuplicates(
      params,
      schoolId,
    );
    return matches.map((m) => ({
      studentId: m.id,
      studentUid: m.studentUid,
      name: `${m.firstName} ${m.lastName}`,
      dob: this.iso(m.dob),
      reason:
        m.firstName.toLowerCase() === params.firstName.toLowerCase() &&
        m.lastName.toLowerCase() === params.lastName.toLowerCase()
          ? 'NAME_DOB'
          : 'GUARDIAN_PHONE_DOB',
    }));
  }

  /** Warn if age at admission is outside class level ± 3 yrs (M09 §7). */
  private ageSanityWarnings(
    dob: Date,
    admissionDate: Date,
    numericLevel: number,
  ): string[] {
    const ageAtAdmission =
      (admissionDate.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    const expected = numericLevel + AGE_CLASS_OFFSET;
    if (Math.abs(ageAtAdmission - expected) > AGE_CLASS_TOLERANCE) {
      return [
        `Age at admission (${ageAtAdmission.toFixed(1)} yrs) is unusual for class level ${numericLevel} (expected ≈ ${expected} ± ${AGE_CLASS_TOLERANCE} yrs)`,
      ];
    }
    return [];
  }

  private async assertBirthCertificateAvailable(
    birthCertificateNo: string | undefined,
    schoolId: string,
    excludeId?: string,
  ): Promise<void> {
    if (!birthCertificateNo) return;
    const holder = await this.students.findByBirthCertificate(
      birthCertificateNo,
      schoolId,
    );
    if (holder && holder.id !== excludeId) {
      throw new ConflictException(
        `Birth certificate ${birthCertificateNo} is already registered to ${holder.studentUid}`,
      );
    }
  }

  private iso(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private auditSnapshot(student: Student): Record<string, unknown> {
    return {
      firstName: student.firstName,
      lastName: student.lastName,
      nameBn: student.nameBn,
      gender: student.gender,
      dob: this.iso(student.dob),
      bloodGroup: student.bloodGroup,
      religion: student.religion,
      birthCertificateNo: student.birthCertificateNo,
      admissionDate: this.iso(student.admissionDate),
      admissionClassId: student.admissionClassId,
      previousSchool: student.previousSchool,
    };
  }
}
