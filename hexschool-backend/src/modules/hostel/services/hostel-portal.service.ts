import { Injectable } from '@nestjs/common';
import {
  HostelAllocationStatus,
  MealOffStatus,
} from '../../../common/constants';
import { isoDate } from '../../academic/calendar/date.util';
import { mealOffDays } from '../calc/mess.engine';
import { HostelAllocationsRepository } from '../repositories/hostel-allocations.repository';
import { MealOffsRepository } from '../repositories/mess.repository';
import { HostelSettingsService } from './hostel-settings.service';

export interface PortalMealOff {
  id: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: MealOffStatus;
  decisionNote: string | null;
}

export interface PortalHostelView {
  /** False when the school runs no hostel, or the child lives at home. */
  resident: boolean;
  reason?: string;
  hostel?: {
    name: string;
    type: string;
    phone: string | null;
    wardenName: string | null;
  };
  room?: {
    roomNo: string;
    floor: number;
    type: string;
    bedNo: string;
    monthlyFee: number;
  };
  mess?: {
    planName: string;
    monthlyCharge: number;
    startDate: string;
  } | null;
  status?: HostelAllocationStatus;
  startDate?: string;
  securityDeposit?: number;
  mealOffs?: PortalMealOff[];
}

/**
 * Roadmap §5's "parent portal shows allocation details".
 *
 * **What this deliberately does NOT return** is as considered as what it
 * does: no other boarder's name, no occupancy figure for the building, no
 * warden's personal phone, and no deposit *refund* history — the M19 rule
 * that a read's SELECT list *is* the privacy policy.
 *
 * The hostel's own phone number IS included, because a parent whose child
 * has not rung home needs a number for the building, and it is already
 * printed on every letter the school sends. The warden's *name* is
 * included for the same reason and their contact details are not.
 *
 * The child's own meal-offs are here because a parent's most common
 * question about the hostel is "did they approve the leave I asked for",
 * and making them ring the office to find out is the sort of thing a
 * portal exists to stop.
 */
@Injectable()
export class HostelPortalService {
  constructor(
    private readonly allocations: HostelAllocationsRepository,
    private readonly mealOffs: MealOffsRepository,
    private readonly config: HostelSettingsService,
  ) {}

  async forStudent(
    schoolId: string,
    studentId: string,
    sessionId?: string,
  ): Promise<PortalHostelView> {
    const cfg = await this.config.load(schoolId);
    if (!cfg.enabled) {
      return {
        resident: false,
        reason: 'This school does not run a boarding house.',
      };
    }

    const allocation = await this.allocations.findForStudent(
      schoolId,
      studentId,
      sessionId,
    );
    if (!allocation) {
      return {
        resident: false,
        reason: 'This student is not living in the school hostel.',
      };
    }

    const mess = allocation.messEnrollments.find((row) => row.endDate === null);
    const { rows } = await this.mealOffs.findMany(
      schoolId,
      { allocationId: allocation.id },
      1,
      20,
    );

    return {
      resident: true,
      hostel: {
        name: allocation.hostel.name,
        type: allocation.hostel.type,
        phone: allocation.hostel.phone,
        wardenName: allocation.hostel.wardenStaff
          ? `${allocation.hostel.wardenStaff.firstName} ${allocation.hostel.wardenStaff.lastName}`.trim()
          : null,
      },
      room: {
        roomNo: allocation.bed.room.roomNo,
        floor: allocation.bed.room.floor,
        type: allocation.bed.room.type,
        bedNo: allocation.bed.bedNo,
        monthlyFee: Number(allocation.bed.room.monthlyFee),
      },
      mess: mess
        ? {
            planName: mess.plan.name,
            monthlyCharge: Number(mess.plan.monthlyCharge),
            startDate: isoDate(mess.startDate),
          }
        : null,
      status: allocation.status,
      startDate: isoDate(allocation.startDate),
      securityDeposit: Number(allocation.securityDeposit),
      mealOffs: rows.map((row) => ({
        id: row.id,
        fromDate: isoDate(row.fromDate),
        toDate: isoDate(row.toDate),
        days: mealOffDays(isoDate(row.fromDate), isoDate(row.toDate)),
        reason: row.reason,
        status: row.status,
        decisionNote: row.decisionNote,
      })),
    };
  }
}
