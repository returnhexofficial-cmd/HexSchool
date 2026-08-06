import { Injectable, Logger } from '@nestjs/common';
import { LibraryMemberType } from '@prisma/client';
import { EnrollmentsRepository } from '../../enrollment/repositories/enrollments.repository';
import { LedgerService } from '../../fee/services/ledger.service';
import { HostelClearanceService } from '../../hostel/services/hostel-clearance.service';
import { LibraryClearanceService } from '../../library/services/library-clearance.service';
import {
  aggregateClearance,
  type ClearanceSourceInput,
  type ClearanceVerdict,
} from '../calc/clearance.engine';
import type { CertificateTypeCode } from '../calc/types';
import { DocumentSettingsService } from './document-settings.service';

/**
 * **The aggregated clearance service** — the thing MODULE_DEPENDENCIES has
 * pointed at from three separate module rows since M16.
 *
 * Its whole job is to gather the three sources and hand them to
 * `clearance.engine`, which produces **one verdict**. The gathering is
 * here rather than in the engine because each source is a different
 * module's business, and the verdict is in the engine because "is this
 * student clear" must have exactly one answer wherever it is asked — the
 * wizard's panel, the issue endpoint's refusal and the snapshot stored on
 * the certificate all read the same object.
 *
 * **Every source is read the way its owner exposes it**, and that is the
 * point of the module's dependency list:
 *   - fees through `LedgerService.outstandingFor`, which PROJECT_CONTEXT
 *     §11 makes THE dues source for every gate in the system (M14 admit
 *     cards, M09 exit status, M26 vacate). A second dues query here would
 *     eventually disagree with the one that blocks a boarder's vacate,
 *     and the office would be looking at two numbers.
 *   - the library through `LibraryClearanceService.clearanceForPerson`,
 *     which M23 exported saying "for 27".
 *   - the hostel through `HostelClearanceService.clearanceForStudent`,
 *     which M26's completion doc named as the shape M27 would reuse.
 *
 * **The last two are re-provisions, not imports.** Both depend on
 * `PrismaService` alone, so DocumentModule provides them a second time
 * rather than importing LibraryModule and HostelModule — the M13
 * `RoutineConflictChecker` / M23 `LIBRARY_CLEARANCE` shape. Importing
 * either would pull Accounting, Fee, Communication and Enrollment in
 * behind it and would overstate what this module depends on, which is
 * **their answers**, not library or hostel management.
 *
 * **Nothing here throws.** A library module that errors must not stop a
 * school issuing a character certificate — the M25 rule that a cross-module
 * read logs and degrades, one level up. A source that failed is reported
 * as a warning so the office knows the check was incomplete, rather than
 * silently reported as clear.
 */
@Injectable()
export class ClearanceService {
  private readonly logger = new Logger(ClearanceService.name);

  constructor(
    private readonly ledger: LedgerService,
    private readonly enrollments: EnrollmentsRepository,
    private readonly library: LibraryClearanceService,
    private readonly hostel: HostelClearanceService,
    private readonly config: DocumentSettingsService,
  ) {}

  async check(params: {
    schoolId: string;
    studentId: string;
    type: CertificateTypeCode;
    override: boolean;
  }): Promise<ClearanceVerdict> {
    const config = await this.config.load(params.schoolId);

    const [fees, library, hostel] = await Promise.all([
      this.fees(params.schoolId, params.studentId),
      config.clearanceIncludeLibrary
        ? this.libraryClearance(params.schoolId, params.studentId)
        : Promise.resolve(undefined),
      config.clearanceIncludeHostel
        ? this.hostelClearance(params.schoolId, params.studentId)
        : Promise.resolve(undefined),
    ]);

    return aggregateClearance({
      type: params.type,
      fees,
      library,
      hostel,
      requiredTypes: config.clearanceRequiredTypes,
      override: params.override,
    });
  }

  /**
   * Every enrollment the student ever had, not only the live one: a family
   * that left last year's tuition unpaid and re-enrolled still owes it,
   * and a check scoped to the current session would clear them.
   */
  private async fees(
    schoolId: string,
    studentId: string,
  ): Promise<ClearanceSourceInput> {
    try {
      const enrollments = await this.enrollments.findAll(
        { studentId },
        schoolId,
      );
      if (enrollments.length === 0) return {};

      const outstanding = await this.ledger.outstandingFor(
        enrollments.map((e) => e.id),
        schoolId,
      );
      const amount = [...outstanding.values()].reduce(
        (sum, value) => sum + value,
        0,
      );
      return amount > 0.009
        ? {
            amount,
            details: [
              'Settle the outstanding invoices at the fee desk, or record a waiver against them.',
            ],
          }
        : {};
    } catch (error) {
      this.logger.error(
        `Fee clearance read failed for student ${studentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        incomplete: true,
        details: [
          'Check the outstanding dues manually at the fee desk before issuing.',
        ],
      };
    }
  }

  private async libraryClearance(
    schoolId: string,
    studentId: string,
  ): Promise<ClearanceSourceInput | undefined> {
    try {
      const result = await this.library.clearanceForPerson(
        schoolId,
        LibraryMemberType.STUDENT,
        studentId,
      );
      return result.cleared
        ? undefined
        : {
            amount: result.outstandingFine,
            items: result.booksOut,
            details: result.details,
          };
    } catch (error) {
      this.logger.error(
        `Library clearance read failed for student ${studentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        incomplete: true,
        details: ['Check with the librarian before issuing.'],
      };
    }
  }

  private async hostelClearance(
    schoolId: string,
    studentId: string,
  ): Promise<ClearanceSourceInput | undefined> {
    try {
      const result = await this.hostel.clearanceForStudent(schoolId, studentId);
      // The deposit is money the SCHOOL owes, so it is reported as a
      // detail and never as an amount the family has to settle — see
      // `HostelClearanceService.clearanceForStudent`.
      return result.cleared
        ? undefined
        : { items: result.bedsHeld, details: result.details };
    } catch (error) {
      this.logger.error(
        `Hostel clearance read failed for student ${studentId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        incomplete: true,
        details: ['Check with the warden before issuing.'],
      };
    }
  }
}
