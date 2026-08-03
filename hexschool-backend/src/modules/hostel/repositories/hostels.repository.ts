import { Injectable } from '@nestjs/common';
import {
  Hostel,
  HostelAllocationStatus,
  HostelBed,
  HostelRoom,
  Prisma,
} from '@prisma/client';
import {
  BaseRepository,
  PrismaClientLike,
} from '../../../common/database/base.repository';
import { PrismaService } from '../../../database/prisma/prisma.service';

const HOSTEL_INCLUDE = {
  wardenStaff: {
    select: { id: true, employeeId: true, firstName: true, lastName: true },
  },
} satisfies Prisma.HostelInclude;

export type HostelWithWarden = Prisma.HostelGetPayload<{
  include: typeof HOSTEL_INCLUDE;
}>;

const ROOM_INCLUDE = {
  beds: { where: { deletedAt: null }, orderBy: { bedNo: 'asc' } },
} satisfies Prisma.HostelRoomInclude;

export type RoomWithBeds = Prisma.HostelRoomGetPayload<{
  include: typeof ROOM_INCLUDE;
}>;

/**
 * Statuses that still hold a bed. A SUSPENDED boarder has gone home for a
 * term and is coming back — the school is keeping their place, exactly as
 * M25 keeps a suspended rider's seat. Only VACATED frees a bed.
 */
export const OCCUPYING_STATUSES: HostelAllocationStatus[] = [
  HostelAllocationStatus.ACTIVE,
  HostelAllocationStatus.SUSPENDED,
];

@Injectable()
export class HostelsRepository extends BaseRepository<
  Hostel,
  Prisma.HostelWhereInput,
  Prisma.HostelUncheckedCreateInput,
  Prisma.HostelUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.hostel, 'Hostel');
  }

  async findDetail(
    id: string,
    schoolId: string,
  ): Promise<HostelWithWarden | null> {
    return this.prisma.hostel.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: HOSTEL_INCLUDE,
    });
  }

  async findMany(
    schoolId: string,
    filter: {
      status?: Hostel['status'];
      type?: Hostel['type'];
      search?: string;
    },
  ): Promise<HostelWithWarden[]> {
    return this.prisma.hostel.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.search
          ? { name: { contains: filter.search, mode: 'insensitive' } }
          : {}),
      },
      include: HOSTEL_INCLUDE,
      orderBy: [{ name: 'asc' }],
    });
  }

  async findByName(
    schoolId: string,
    name: string,
    excludeId?: string,
  ): Promise<Hostel | null> {
    return this.prisma.hostel.findFirst({
      where: {
        schoolId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /**
   * Every live bed of a hostel, with whether an allocation holds it — the
   * one query the occupancy grid, the room cards and the report are all
   * drawn from, so none of them can count differently.
   */
  async bedsWithHolders(
    schoolId: string,
    hostelId?: string,
  ): Promise<
    Array<{
      id: string;
      bedNo: string;
      status: HostelBed['status'];
      roomId: string;
      hostelId: string;
      held: boolean;
    }>
  > {
    const beds = await this.prisma.hostelBed.findMany({
      where: {
        schoolId,
        deletedAt: null,
        ...(hostelId ? { hostelId } : {}),
      },
      select: {
        id: true,
        bedNo: true,
        status: true,
        roomId: true,
        hostelId: true,
        allocations: {
          where: { deletedAt: null, status: { in: OCCUPYING_STATUSES } },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: [{ bedNo: 'asc' }],
    });

    return beds.map((bed) => ({
      id: bed.id,
      bedNo: bed.bedNo,
      status: bed.status,
      roomId: bed.roomId,
      hostelId: bed.hostelId,
      held: bed.allocations.length > 0,
    }));
  }

  /** Live boarders per hostel, in one query. */
  async residentCounts(
    schoolId: string,
    hostelIds?: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.hostelAllocation.groupBy({
      by: ['hostelId'],
      where: {
        schoolId,
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
        ...(hostelIds ? { hostelId: { in: hostelIds } } : {}),
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.hostelId, row._count._all]));
  }

  async countRooms(hostelId: string): Promise<number> {
    return this.prisma.hostelRoom.count({
      where: { hostelId, deletedAt: null },
    });
  }
}

@Injectable()
export class HostelRoomsRepository extends BaseRepository<
  HostelRoom,
  Prisma.HostelRoomWhereInput,
  Prisma.HostelRoomUncheckedCreateInput,
  Prisma.HostelRoomUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.hostelRoom, 'HostelRoom');
  }

  async findDetail(id: string, schoolId: string): Promise<RoomWithBeds | null> {
    return this.prisma.hostelRoom.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: ROOM_INCLUDE,
    });
  }

  async findForHostel(
    hostelId: string,
    filter: { status?: HostelRoom['status']; floor?: number } = {},
  ): Promise<RoomWithBeds[]> {
    return this.prisma.hostelRoom.findMany({
      where: {
        hostelId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.floor !== undefined ? { floor: filter.floor } : {}),
      },
      include: ROOM_INCLUDE,
      orderBy: [{ floor: 'asc' }, { roomNo: 'asc' }],
    });
  }

  async findByRoomNo(
    hostelId: string,
    roomNo: string,
    excludeId?: string,
  ): Promise<HostelRoom | null> {
    return this.prisma.hostelRoom.findFirst({
      where: {
        hostelId,
        deletedAt: null,
        roomNo: { equals: roomNo.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /** Boarders living in this room right now — the delete/maintenance guard. */
  async countResidents(roomId: string): Promise<number> {
    return this.prisma.hostelAllocation.count({
      where: {
        deletedAt: null,
        status: { in: OCCUPYING_STATUSES },
        bed: { roomId },
      },
    });
  }
}

@Injectable()
export class HostelBedsRepository extends BaseRepository<
  HostelBed,
  Prisma.HostelBedWhereInput,
  Prisma.HostelBedUncheckedCreateInput,
  Prisma.HostelBedUncheckedUpdateInput
> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.hostelBed, 'HostelBed');
  }

  async findDetail(id: string, schoolId: string) {
    return this.prisma.hostelBed.findFirst({
      where: { id, schoolId, deletedAt: null },
      include: {
        room: {
          select: {
            id: true,
            roomNo: true,
            status: true,
            monthlyFee: true,
            hostelId: true,
          },
        },
        hostel: { select: { id: true, name: true, type: true, status: true } },
      },
    });
  }

  async findForRoom(roomId: string): Promise<HostelBed[]> {
    return this.prisma.hostelBed.findMany({
      where: { roomId, deletedAt: null },
      orderBy: [{ bedNo: 'asc' }],
    });
  }

  async findByBedNo(
    roomId: string,
    bedNo: string,
    excludeId?: string,
  ): Promise<HostelBed | null> {
    return this.prisma.hostelBed.findFirst({
      where: {
        roomId,
        deletedAt: null,
        bedNo: { equals: bedNo.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  /**
   * The shadow write. `hostel_beds.status` mirrors the live allocation,
   * and this is the ONLY path that moves it — so a bed cannot end up
   * OCCUPIED with nobody in it because two services disagreed about whose
   * job it was. MAINTENANCE is left alone: it is the bed's own fact, and
   * a boarder vacating does not repair a broken frame.
   */
  async setOccupancyShadow(
    bedId: string,
    occupied: boolean,
    tx?: PrismaClientLike,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as PrismaService;
    await client.hostelBed.updateMany({
      where: { id: bedId, status: { not: 'MAINTENANCE' } },
      data: { status: occupied ? 'OCCUPIED' : 'VACANT' },
    });
  }

  async countLiveInRoom(roomId: string): Promise<number> {
    return this.prisma.hostelBed.count({
      where: { roomId, deletedAt: null },
    });
  }
}
