import { Injectable } from '@nestjs/common';
import { HostelAllocationStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { HOSTEL_CLEAR, type HostelClearanceResult } from '../hostel.constants';

/**
 * "Has this student finished with the hostel?" — the third of the three
 * halves M27's clearance aggregate reads, beside M16's
 * `LedgerService.outstandingFor` and M23's
 * `LibraryClearanceService.clearanceForPerson`.
 *
 * **This service depends on PrismaService and nothing else**, and that is
 * the whole point — it is `LibraryClearanceService` (M23) applied to a
 * bed, deliberately down to the shape of the result. It is provided twice:
 * once inside HostelModule (for the hostel's own screens) and once inside
 * DocumentModule, so M27 does not have to import HostelModule to ask one
 * question. `HostelAllocationsService` reaches Fee, Accounting,
 * Communication, Enrollment and Rbac; pulling that graph into the
 * certificate module for a single read would badly overstate what M27
 * depends on, which is **the hostel's answer**, not hostel management.
 *
 * A student who never boarded is **cleared**, not an error. Most of a
 * school never sleeps here, and an issue flow that 404'd on them would be
 * a worse bug than the one this prevents (the M23 rule, verbatim).
 */
@Injectable()
export class HostelClearanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * **A held bed and an unreturned deposit are two different problems and
   * both are reported.** The bed is the obvious one. The deposit is the one
   * a transfer certificate would otherwise walk past: the school is holding
   * money belonging to a family who are leaving, and the TC is the last
   * moment anybody looks at that record. It is reported as a *detail* and
   * never as an amount the family must settle, because a school does not
   * refuse a certificate over a refund it owes.
   */
  async clearanceForStudent(
    schoolId: string,
    studentId: string,
  ): Promise<HostelClearanceResult> {
    const live = await this.prisma.hostelAllocation.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        // A SUSPENDED boarder still holds their bed — that is what
        // suspending means (PROJECT_CONTEXT §11, M26). Only VACATED is
        // finished.
        status: {
          in: [HostelAllocationStatus.ACTIVE, HostelAllocationStatus.SUSPENDED],
        },
        enrollment: { is: { studentId } },
      },
      select: {
        status: true,
        securityDeposit: true,
        depositRefunded: true,
        bed: {
          select: { bedNo: true, room: { select: { roomNo: true } } },
        },
        hostel: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!live) return HOSTEL_CLEAR;

    const details = [
      `Bed ${live.bed.bedNo}, room ${live.bed.room.roomNo} at ${live.hostel.name} ${
        live.status === HostelAllocationStatus.SUSPENDED
          ? 'is suspended but still held'
          : 'is still occupied'
      } — vacate the allocation before the student leaves.`,
    ];

    let depositHeld = 0;
    if (!live.depositRefunded && Number(live.securityDeposit) > 0) {
      depositHeld = Number(live.securityDeposit);
      details.push(
        `The school still holds a ${depositHeld.toFixed(2)} BDT security deposit for this boarder.`,
      );
    }

    return { cleared: false, bedsHeld: 1, depositHeld, details };
  }
}
