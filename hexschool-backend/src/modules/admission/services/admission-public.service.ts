import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import {
  AdmissionApplicationStatus,
  AdmissionCycleStatus,
  AdmissionPaymentStatus,
  DEFAULT_SCHOOL_ID,
  OtpPurpose,
} from '../../../common/constants';
import { parseDate } from '../../academic/calendar/date.util';
import { OtpService } from '../../auth/services/otp.service';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SettingsService } from '../../school/services/settings.service';
import { SequenceService } from '../../sequence/sequence.service';
import { StorageService } from '../../storage/storage.service';
import { PublicApplyDto, RequestOtpDto, VerifyAdmissionOtpDto } from '../dto';
import {
  ADMISSION_EVENTS,
  ApplicationSubmittedEvent,
} from '../events/admission.events';
import { AdmissionApplicationsRepository } from '../repositories/admission-applications.repository';
import { AdmissionCyclesRepository } from '../repositories/admission-cycles.repository';
import { AdmissionTestsRepository } from '../repositories/admission-tests.repository';
import { AdmissionTokenService } from './admission-token.service';
import { RecaptchaService } from './recaptcha.service';

const PHOTO_MAX_BYTES = 1024 * 1024; // 1 MB (roadmap M10 §7)
const PHOTO_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const PHOTO_SIZE_PX = 512;

/** BD convention (mirrors M09): class 1 ≈ age 6. */
const AGE_CLASS_OFFSET = 5;

/**
 * Public (unauthenticated) admission flows: open-cycle listing, OTP
 * phone verification, photo upload, application submission, and
 * tracking. Single-school deployment — everything scopes to
 * DEFAULT_SCHOOL_ID until Module 31. reCAPTCHA guards the abuse-prone
 * endpoints; the OTP-minted phone token authorizes apply/photo.
 */
@Injectable()
export class AdmissionPublicService {
  private readonly schoolId = DEFAULT_SCHOOL_ID;

  constructor(
    private readonly cycles: AdmissionCyclesRepository,
    private readonly applications: AdmissionApplicationsRepository,
    private readonly tests: AdmissionTestsRepository,
    private readonly otp: OtpService,
    private readonly tokens: AdmissionTokenService,
    private readonly recaptcha: RecaptchaService,
    private readonly sequences: SequenceService,
    private readonly settings: SettingsService,
    private readonly schools: SchoolsRepository,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  /** Landing data: OPEN cycles inside their window, with classes/fees. */
  async openCycles() {
    const cycles = await this.cycles.findOpenCycles(this.schoolId);
    return cycles.map((cycle) => ({
      id: cycle.id,
      name: cycle.name,
      startAt: cycle.startAt,
      endAt: cycle.endAt,
      testRequired: cycle.testRequired,
      instructions: cycle.instructions,
      session: cycle.session,
      classes: cycle.classes.map((c) => ({
        classId: c.classId,
        className: c.class.name,
        numericLevel: c.class.numericLevel,
        seats: c.seats,
        applicationFee: Number(c.applicationFee),
      })),
      tests: cycle.tests,
    }));
  }

  async requestOtp(dto: RequestOtpDto, ip?: string): Promise<void> {
    await this.recaptcha.assertValid(dto.recaptchaToken, ip);
    await this.otp.issue(dto.phone, OtpPurpose.ADMISSION, null);
  }

  async verifyOtp(
    dto: VerifyAdmissionOtpDto,
  ): Promise<{ verificationToken: string }> {
    await this.otp.verify(dto.phone, OtpPurpose.ADMISSION, dto.code);
    return { verificationToken: this.tokens.signPhoneToken(dto.phone) };
  }

  /** Applicant photo (≤1 MB jpg/png), stored before the application
   *  exists — the returned key goes into the apply payload. */
  async uploadPhoto(
    verificationToken: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<{ photoKey: string }> {
    const phone = this.tokens.verifyPhoneToken(verificationToken);
    if (!file) throw new BadRequestException('Photo file is required');
    if (!PHOTO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Photo must be a JPEG or PNG image');
    }
    if (file.size > PHOTO_MAX_BYTES) {
      throw new BadRequestException('Photo must be 1 MB or smaller');
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
      prefix: `admissions/${this.schoolId}/${phone}`,
      filename: 'applicant.png',
      purpose: 'photos',
    });
    return { photoKey: uploaded.key };
  }

  async apply(
    dto: PublicApplyDto,
    ip?: string,
  ): Promise<{
    applicationNo: string;
    status: AdmissionApplicationStatus;
    applicationFee: number;
  }> {
    await this.recaptcha.assertValid(dto.recaptchaToken, ip);
    const phone = this.tokens.verifyPhoneToken(dto.verificationToken);

    const cycle = await this.cycles.findDetail(dto.cycleId, this.schoolId);
    if (!cycle || cycle.status !== AdmissionCycleStatus.OPEN) {
      throw new BadRequestException('This admission cycle is not open');
    }
    const now = Date.now();
    if (now < cycle.startAt.getTime() || now > cycle.endAt.getTime()) {
      throw new BadRequestException(
        'The application window for this cycle is closed',
      );
    }
    const cycleClass = cycle.classes.find((c) => c.classId === dto.classId);
    if (!cycleClass) {
      throw new BadRequestException('This class is not offered by the cycle');
    }

    const dob = parseDate(dto.dob);
    await this.assertAgeWithinBounds(dob, cycleClass.class.numericLevel);

    // Duplicate rule (M10 §6): friendly message before the DB unique.
    const duplicate = await this.applications.findLiveDuplicate({
      cycleId: dto.cycleId,
      classId: dto.classId,
      phone,
      dob,
    });
    if (duplicate) {
      throw new ConflictException(
        `An application (${duplicate.applicationNo}) already exists for this applicant — track it with the application number and phone`,
      );
    }
    const multiClass = await this.settings.getValue<boolean>(
      this.schoolId,
      'academic.admission_multi_class_applications',
    );
    if (!multiClass) {
      const other = await this.applications.findLiveDuplicate({
        cycleId: dto.cycleId,
        phone,
        dob,
      });
      if (other) {
        throw new ConflictException(
          'This applicant already applied to another class of this cycle',
        );
      }
    }

    const fee = Number(cycleClass.applicationFee);
    const school = await this.schools.findByIdOrFail(this.schoolId);
    const pattern = await this.settings.getValue<string>(
      this.schoolId,
      'general.application_no_pattern',
    );

    const application = await this.applications.withTransaction(async (tx) => {
      const applicationNo = await this.sequences.nextDocumentNumber({
        schoolId: this.schoolId,
        counterKey: `admission:${new Date().getUTCFullYear() % 100}`,
        pattern,
        schoolCode: school.code,
        tx,
      });
      return this.applications.create(
        {
          schoolId: this.schoolId,
          cycleId: dto.cycleId,
          applicationNo,
          classId: dto.classId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          nameBn: dto.nameBn,
          gender: dto.gender,
          dob,
          religion: dto.religion,
          photoUrl: dto.photoKey,
          presentAddress: (dto.presentAddress ?? {}) as Prisma.InputJsonValue,
          permanentAddress: (dto.permanentAddress ??
            dto.presentAddress ??
            {}) as Prisma.InputJsonValue,
          previousSchool: dto.previousSchool,
          previousGpa: dto.previousGpa,
          previousResult: (dto.previousResult ?? {}) as Prisma.InputJsonValue,
          guardian: {
            name: dto.guardian.name,
            nameBn: dto.guardian.nameBn,
            relation: dto.guardian.relation,
            phone: dto.guardian.phone,
            email: dto.guardian.email,
            occupation: dto.guardian.occupation,
          },
          phone,
          status:
            fee > 0
              ? AdmissionApplicationStatus.PAYMENT_PENDING
              : AdmissionApplicationStatus.SUBMITTED,
          paymentStatus:
            fee > 0
              ? AdmissionPaymentStatus.UNPAID
              : AdmissionPaymentStatus.WAIVED,
        },
        tx,
      );
    });

    this.events.emit(ADMISSION_EVENTS.APPLICATION_SUBMITTED, {
      applicationId: application.id,
      applicationNo: application.applicationNo,
      schoolId: this.schoolId,
      phone,
      applicantName: `${dto.firstName} ${dto.lastName}`,
      className: cycleClass.class.name,
      fee,
    } satisfies ApplicationSubmittedEvent);

    return {
      applicationNo: application.applicationNo,
      status: application.status,
      applicationFee: fee,
    };
  }

  /** Public tracking: application number + phone must both match. */
  async track(appNo: string, phone: string) {
    const app = await this.applications.findByAppNoAndPhone(
      appNo,
      phone,
      this.schoolId,
    );
    if (!app) {
      throw new NotFoundException(
        'No application found for that number and phone',
      );
    }

    const cycle = await this.cycles.findDetail(app.cycleId, this.schoolId);
    const cycleClass = cycle?.classes.find((c) => c.classId === app.classId);
    const test = await this.tests.findForCycleClass(app.cycleId, app.classId);
    const admitted = app.status === AdmissionApplicationStatus.ADMITTED;

    return {
      applicationNo: app.applicationNo,
      applicantName: `${app.firstName} ${app.lastName}`,
      cycleName: app.cycle.name,
      className: app.class.name,
      status: app.status,
      paymentStatus: app.paymentStatus,
      applicationFee: cycleClass ? Number(cycleClass.applicationFee) : 0,
      testRequired: app.cycle.testRequired,
      test: test
        ? {
            date: test.testDate.toISOString().slice(0, 10),
            venue: test.venue,
            totalMarks: test.totalMarks,
          }
        : null,
      testMarks: app.testMarks === null ? null : Number(app.testMarks),
      meritPosition: app.meritPosition,
      admissionDeadline: app.admissionDeadline,
      studentUid: admitted ? (app.student?.studentUid ?? null) : null,
    };
  }

  // ── internals ─────────────────────────────────────────────────────

  /** Roadmap M10 §7: applicant age vs class level is HARD-checked
   *  (unlike the M09 warn-only rule) — tolerance from settings. */
  private async assertAgeWithinBounds(
    dob: Date,
    numericLevel: number,
  ): Promise<void> {
    const tolerance = await this.settings.getValue<number>(
      this.schoolId,
      'academic.admission_age_tolerance_years',
    );
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    const expected = numericLevel + AGE_CLASS_OFFSET;
    if (Math.abs(age - expected) > (tolerance || 3)) {
      throw new BadRequestException(
        `Applicant age (${age.toFixed(1)} yrs) is outside the accepted range for this class (≈ ${expected} ± ${tolerance || 3} yrs)`,
      );
    }
  }
}
