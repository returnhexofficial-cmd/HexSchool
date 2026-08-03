import { Injectable } from '@nestjs/common';
import { MealOffStatus } from '../../../common/constants';
import { dhakaToday } from '../../../common/utils/clock.util';
import { isoDate, parseDate } from '../../academic/calendar/date.util';
import { LedgerService } from '../../fee/services/ledger.service';
import { mealOffDays } from '../calc/mess.engine';
import {
  bedAvailability,
  bedCountMismatch,
  summarize,
  type OccupancyStats,
} from '../calc/occupancy.engine';
import type {
  MealOffReportQueryDto,
  OccupancyQueryDto,
  ResidentsQueryDto,
} from '../dto';
import { HostelAllocationsRepository } from '../repositories/hostel-allocations.repository';
import {
  HostelRoomsRepository,
  HostelsRepository,
} from '../repositories/hostels.repository';
import { MealOffsRepository } from '../repositories/mess.repository';

export interface OccupancyReport {
  generatedAt: string;
  overall: OccupancyStats;
  hostels: Array<{
    hostelId: string;
    hostelName: string;
    type: string;
    occupancy: OccupancyStats;
    capacityNote: string | null;
    floors: Array<{
      floor: number;
      occupancy: OccupancyStats;
      rooms: Array<{
        roomId: string;
        roomNo: string;
        type: string;
        status: string;
        monthlyFee: number;
        occupancy: OccupancyStats;
        bedCountNote: string | null;
        beds: Array<{
          bedId: string;
          bedNo: string;
          state: 'FREE' | 'TAKEN' | 'MAINTENANCE';
        }>;
      }>;
    }>;
  }>;
}

export interface ResidentRow {
  allocationId: string;
  studentUid: string;
  studentName: string;
  className: string;
  sectionName: string | null;
  rollNo: number | null;
  hostelName: string;
  roomNo: string;
  bedNo: string;
  status: string;
  startDate: string;
  monthlyFee: number;
  messPlan: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianRelation: string | null;
}

export interface DuesRow extends Omit<ResidentRow, 'guardianRelation'> {
  outstanding: number;
}

export interface MealOffSummaryRow {
  studentUid: string;
  studentName: string;
  hostelName: string;
  requested: number;
  approved: number;
  rejected: number;
  daysRequested: number;
  daysApproved: number;
}

/**
 * The four reports roadmap §4 asks for.
 *
 * **Every one of them counts beds through `summarize`**, the same
 * function the occupancy grid and the room cards use — so a warden
 * reading "31 of 40" on a screen and a head reading "31 of 40" in a
 * spreadsheet are reading the same arithmetic, including the decision
 * that a bed out of service is not a vacancy the school failed to fill
 * (the M16 `deriveStatus` / M25 `capacityVerdict` rule).
 *
 * The dues report reads **`LedgerService.outstandingFor`**, the single
 * dues source every gate in the system uses (M14's admit cards, M09's
 * exit warning, this module's vacate check). A second dues query here
 * would eventually disagree with the one that blocks the vacate, and the
 * office would be looking at two numbers.
 */
@Injectable()
export class HostelReportsService {
  constructor(
    private readonly hostels: HostelsRepository,
    private readonly rooms: HostelRoomsRepository,
    private readonly allocations: HostelAllocationsRepository,
    private readonly mealOffs: MealOffsRepository,
    private readonly ledger: LedgerService,
  ) {}

  async occupancy(
    query: OccupancyQueryDto,
    schoolId: string,
  ): Promise<OccupancyReport> {
    const hostels = await this.hostels.findMany(schoolId, {});
    const scoped = query.hostelId
      ? hostels.filter((h) => h.id === query.hostelId)
      : hostels;

    const beds = await this.hostels.bedsWithHolders(schoolId, query.hostelId);
    const heldById = new Map(beds.map((bed) => [bed.id, bed.held]));

    const out: OccupancyReport['hostels'] = [];
    const all: Array<{
      status: (typeof beds)[number]['status'];
      held: boolean;
    }> = [];

    for (const hostel of scoped) {
      const rooms = await this.rooms.findForHostel(hostel.id);
      const byFloor = new Map<number, typeof rooms>();
      for (const room of rooms) {
        const list = byFloor.get(room.floor) ?? [];
        list.push(room);
        byFloor.set(room.floor, list);
      }

      const hostelBeds: typeof all = [];
      const floors: OccupancyReport['hostels'][number]['floors'] = [];

      for (const [floor, floorRooms] of [...byFloor].sort(
        (a, b) => a[0] - b[0],
      )) {
        const floorBeds: typeof all = [];
        const roomRows = floorRooms.map((room) => {
          const cells = room.beds.map((bed) => ({
            status: bed.status,
            held: heldById.get(bed.id) ?? false,
          }));
          floorBeds.push(...cells);
          return {
            roomId: room.id,
            roomNo: room.roomNo,
            type: String(room.type),
            status: String(room.status),
            monthlyFee: Number(room.monthlyFee),
            occupancy: summarize(cells),
            bedCountNote: bedCountMismatch(room.bedCount, room.beds.length),
            beds: room.beds.map((bed) => ({
              bedId: bed.id,
              bedNo: bed.bedNo,
              state: bedAvailability(bed.status, heldById.get(bed.id) ?? false),
            })),
          };
        });

        hostelBeds.push(...floorBeds);
        floors.push({
          floor,
          occupancy: summarize(floorBeds),
          rooms: roomRows,
        });
      }

      all.push(...hostelBeds);
      const occupancy = summarize(hostelBeds);
      out.push({
        hostelId: hostel.id,
        hostelName: hostel.name,
        type: String(hostel.type),
        occupancy,
        capacityNote:
          hostel.capacity > 0
            ? bedCountMismatch(hostel.capacity, occupancy.total)
            : null,
        floors,
      });
    }

    return {
      generatedAt: dhakaToday(),
      overall: summarize(all),
      hostels: out,
    };
  }

  async residents(
    query: ResidentsQueryDto,
    schoolId: string,
  ): Promise<ResidentRow[]> {
    const rows = await this.allocations.findAllFor(schoolId, {
      hostelId: query.hostelId,
      sessionId: query.sessionId,
    });
    const live = rows.filter((row) => row.status !== 'VACATED');
    const guardians = await this.allocations.guardianContacts(
      live.map((row) => row.enrollment.student.id),
    );

    return live.map((row) => {
      const guardian = guardians.get(row.enrollment.student.id);
      const mess = row.messEnrollments.find((m) => m.endDate === null);
      return {
        allocationId: row.id,
        studentUid: row.enrollment.student.studentUid,
        studentName:
          `${row.enrollment.student.firstName} ${row.enrollment.student.lastName}`.trim(),
        className: row.enrollment.class.name,
        sectionName: row.enrollment.section?.name ?? null,
        rollNo: row.enrollment.rollNo,
        hostelName: row.hostel.name,
        roomNo: row.bed.room.roomNo,
        bedNo: row.bed.bedNo,
        status: String(row.status),
        startDate: isoDate(row.startDate),
        monthlyFee: Number(row.bed.room.monthlyFee),
        messPlan: mess?.plan.name ?? null,
        guardianName: guardian?.name ?? null,
        guardianPhone: guardian?.phone ?? null,
        guardianRelation: guardian?.relation ?? null,
      };
    });
  }

  /** Roadmap §4's "fee dues among residents". */
  async dues(query: ResidentsQueryDto, schoolId: string): Promise<DuesRow[]> {
    const residents = await this.residents(query, schoolId);
    if (residents.length === 0) return [];

    const rows = await this.allocations.findAllFor(schoolId, {
      hostelId: query.hostelId,
      sessionId: query.sessionId,
    });
    const enrollmentByAllocation = new Map(
      rows.map((row) => [row.id, row.enrollmentId]),
    );

    const outstanding = await this.ledger.outstandingFor(
      [...new Set([...enrollmentByAllocation.values()])],
      schoolId,
    );

    return (
      residents
        .map((resident) => {
          const enrollmentId = enrollmentByAllocation.get(
            resident.allocationId,
          );
          const { guardianRelation, ...rest } = resident;
          void guardianRelation;
          return {
            ...rest,
            outstanding: Number(
              (enrollmentId ? outstanding.get(enrollmentId) : 0) ?? 0,
            ),
          };
        })
        // A report about dues that lists everybody who owes nothing is a
        // report nobody reads to the end.
        .filter((row) => row.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding)
    );
  }

  async mealOffSummary(
    query: MealOffReportQueryDto,
    schoolId: string,
  ): Promise<MealOffSummaryRow[]> {
    const rows = await this.mealOffs.findAllFor(schoolId, {
      hostelId: query.hostelId,
      from: query.from ? parseDate(query.from) : undefined,
      to: query.to ? parseDate(query.to) : undefined,
    });

    const byStudent = new Map<string, MealOffSummaryRow>();
    for (const row of rows) {
      const student = row.allocation.enrollment.student;
      const key = student.id;
      const days = mealOffDays(isoDate(row.fromDate), isoDate(row.toDate));

      const entry = byStudent.get(key) ?? {
        studentUid: student.studentUid,
        studentName: `${student.firstName} ${student.lastName}`.trim(),
        hostelName: row.allocation.hostel.name,
        requested: 0,
        approved: 0,
        rejected: 0,
        daysRequested: 0,
        daysApproved: 0,
      };

      entry.requested++;
      entry.daysRequested += days;
      if (row.status === MealOffStatus.APPROVED) {
        entry.approved++;
        entry.daysApproved += days;
      } else if (row.status === MealOffStatus.REJECTED) {
        entry.rejected++;
      }
      byStudent.set(key, entry);
    }

    return [...byStudent.values()].sort(
      (a, b) => b.daysApproved - a.daysApproved,
    );
  }
}
