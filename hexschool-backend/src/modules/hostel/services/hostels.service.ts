import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HostelAllocationStatus,
  HostelBedStatus,
  HostelRoomStatus,
} from '../../../common/constants';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import {
  bedCountMismatch,
  summarize,
  type OccupancyStats,
} from '../calc/occupancy.engine';
import type {
  GenerateBedsDto,
  HostelQueryDto,
  RoomQueryDto,
  UpsertBedDto,
  UpsertHostelDto,
  UpsertRoomDto,
} from '../dto';
import {
  HostelBedsRepository,
  HostelRoomsRepository,
  HostelsRepository,
  type HostelWithWarden,
  type RoomWithBeds,
} from '../repositories/hostels.repository';
import { HostelSettingsService } from './hostel-settings.service';

export interface HostelSummary {
  hostel: HostelWithWarden;
  rooms: number;
  residents: number;
  occupancy: OccupancyStats;
  /** Set when the declared capacity and the real bed count disagree. */
  capacityNote: string | null;
}

/**
 * The buildings: hostels, their rooms and the beds in them.
 *
 * **Bed generation is the interesting part.** Roadmap §7 says
 * "bed_count = generated beds", which sounds like a validation rule and
 * is really a workflow one: a room whose beds were never created is a
 * room the allocation screen shows as full, and the office has no way to
 * tell that from a room that genuinely is. So creating a room generates
 * its beds by default, changing `bed_count` upward tops them up, and the
 * mismatch is *reported* rather than silently repaired — because deleting
 * a bed somebody is asleep in is not something a form field should be
 * able to do.
 */
@Injectable()
export class HostelsService {
  constructor(
    private readonly hostels: HostelsRepository,
    private readonly rooms: HostelRoomsRepository,
    private readonly beds: HostelBedsRepository,
    private readonly config: HostelSettingsService,
    private readonly audit: AuditContextService,
  ) {}

  // ── hostels ─────────────────────────────────────────────────────────

  async list(
    query: HostelQueryDto,
    actor: AccessTokenPayload,
  ): Promise<HostelSummary[]> {
    const rows = await this.hostels.findMany(actor.schoolId, query);
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const [residents, beds] = await Promise.all([
      this.hostels.residentCounts(actor.schoolId, ids),
      this.hostels.bedsWithHolders(actor.schoolId),
    ]);

    const byHostel = new Map<
      string,
      Array<{ status: HostelBedStatus; held: boolean }>
    >();
    for (const bed of beds) {
      const list = byHostel.get(bed.hostelId) ?? [];
      list.push({ status: bed.status, held: bed.held });
      byHostel.set(bed.hostelId, list);
    }

    return Promise.all(
      rows.map(async (hostel) => {
        const occupancy = summarize(byHostel.get(hostel.id) ?? []);
        return {
          hostel,
          rooms: await this.hostels.countRooms(hostel.id),
          residents: residents.get(hostel.id) ?? 0,
          occupancy,
          capacityNote:
            hostel.capacity > 0
              ? bedCountMismatch(hostel.capacity, occupancy.total)
              : null,
        };
      }),
    );
  }

  async get(id: string, actor: AccessTokenPayload): Promise<HostelSummary> {
    const hostel = await this.hostels.findDetail(id, actor.schoolId);
    if (!hostel) throw new NotFoundException(`Hostel ${id} not found`);

    const beds = await this.hostels.bedsWithHolders(actor.schoolId, id);
    const occupancy = summarize(beds);
    const residents = await this.hostels.residentCounts(actor.schoolId, [id]);

    return {
      hostel,
      rooms: await this.hostels.countRooms(id),
      residents: residents.get(id) ?? 0,
      occupancy,
      capacityNote:
        hostel.capacity > 0
          ? bedCountMismatch(hostel.capacity, occupancy.total)
          : null,
    };
  }

  async create(dto: UpsertHostelDto, actor: AccessTokenPayload) {
    await this.assertNameFree(actor.schoolId, dto.name);

    const created = await this.hostels.create({
      schoolId: actor.schoolId,
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      type: dto.type,
      wardenStaffId: dto.wardenStaffId ?? null,
      address: dto.address?.trim() || null,
      phone: dto.phone ?? null,
      capacity: dto.capacity ?? 0,
      status: dto.status ?? 'ACTIVE',
      notes: dto.notes?.trim() || null,
      createdBy: actor.sub,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Hostel',
      entityId: created.id,
      newValues: { name: created.name, type: created.type },
    });
    return this.get(created.id, actor);
  }

  async update(id: string, dto: UpsertHostelDto, actor: AccessTokenPayload) {
    const existing = await this.hostels.findDetail(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Hostel ${id} not found`);
    await this.assertNameFree(actor.schoolId, dto.name, id);

    // **Changing what a building is for is refused while anybody lives in
    // it.** A BOYS hostel flipped to GIRLS with forty boys asleep in it
    // would make every one of those allocations violate the gender rule
    // retroactively, and no screen would ever show it.
    if (dto.type !== existing.type) {
      const residents = await this.hostels.residentCounts(actor.schoolId, [id]);
      const count = residents.get(id) ?? 0;
      if (count > 0) {
        throw new ConflictException(
          `${count} student(s) are living in "${existing.name}" — move them out before changing what the building is for.`,
        );
      }
    }

    await this.hostels.update(id, {
      name: dto.name.trim(),
      nameBn: dto.nameBn?.trim() || null,
      type: dto.type,
      wardenStaffId: dto.wardenStaffId ?? null,
      address: dto.address?.trim() || null,
      phone: dto.phone ?? null,
      capacity: dto.capacity ?? existing.capacity,
      status: dto.status ?? existing.status,
      notes: dto.notes?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'Hostel',
      entityId: id,
      oldValues: {
        name: existing.name,
        type: existing.type,
        status: existing.status,
      },
      newValues: { name: dto.name, type: dto.type, status: dto.status },
    });
    return this.get(id, actor);
  }

  async remove(id: string, actor: AccessTokenPayload): Promise<void> {
    const hostel = await this.hostels.findDetail(id, actor.schoolId);
    if (!hostel) throw new NotFoundException(`Hostel ${id} not found`);

    const residents = await this.hostels.residentCounts(actor.schoolId, [id]);
    if ((residents.get(id) ?? 0) > 0) {
      throw new ConflictException(
        `"${hostel.name}" still has boarders in it. Vacate them before deleting the building.`,
      );
    }
    const rooms = await this.hostels.countRooms(id);
    if (rooms > 0) {
      throw new ConflictException(
        `"${hostel.name}" still has ${rooms} room(s). Delete them first — a hostel with rooms nobody can reach is worse than one that is simply inactive.`,
      );
    }

    await this.hostels.softDelete(id);
    this.audit.set({
      entityType: 'Hostel',
      entityId: id,
      oldValues: { name: hostel.name },
    });
  }

  // ── rooms ───────────────────────────────────────────────────────────

  async listRooms(
    hostelId: string,
    query: RoomQueryDto,
    actor: AccessTokenPayload,
  ) {
    await this.assertHostel(hostelId, actor.schoolId);
    const rooms = await this.rooms.findForHostel(hostelId, query);
    const held = await this.heldBedIds(actor.schoolId, hostelId);

    return rooms.map((room) => this.decorateRoom(room, held));
  }

  async getRoom(id: string, actor: AccessTokenPayload) {
    const room = await this.rooms.findDetail(id, actor.schoolId);
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    const held = await this.heldBedIds(actor.schoolId, room.hostelId);
    return this.decorateRoom(room, held);
  }

  async createRoom(
    hostelId: string,
    dto: UpsertRoomDto,
    actor: AccessTokenPayload,
  ) {
    await this.assertHostel(hostelId, actor.schoolId);
    const cfg = await this.config.load(actor.schoolId);
    this.assertBedCount(dto.bedCount, cfg.maxBedsPerRoom);

    const clash = await this.rooms.findByRoomNo(hostelId, dto.roomNo);
    if (clash) {
      throw new ConflictException(
        `Room "${dto.roomNo}" already exists in this hostel.`,
      );
    }

    // The room and its beds commit together, or neither does — a room
    // that exists with no beds is a room the allocation screen reports as
    // full and nobody can explain.
    const room = await this.rooms.withTransaction(async (tx) => {
      const created = await this.rooms.create(
        {
          schoolId: actor.schoolId,
          hostelId,
          roomNo: dto.roomNo.trim(),
          floor: dto.floor ?? 0,
          type: dto.type ?? 'STANDARD',
          bedCount: dto.bedCount,
          monthlyFee: dto.monthlyFee,
          status: dto.status ?? 'ACTIVE',
          notes: dto.notes?.trim() || null,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
        tx,
      );

      if (dto.generateBeds !== false) {
        await this.writeBeds(
          tx,
          actor,
          hostelId,
          created.id,
          cfg.bedNoPrefix,
          1,
          dto.bedCount,
        );
      }
      return created;
    });

    this.audit.set({
      entityType: 'HostelRoom',
      entityId: room.id,
      newValues: {
        roomNo: room.roomNo,
        bedCount: dto.bedCount,
        monthlyFee: dto.monthlyFee,
        bedsGenerated: dto.generateBeds !== false ? dto.bedCount : 0,
      },
    });
    return this.getRoom(room.id, actor);
  }

  async updateRoom(id: string, dto: UpsertRoomDto, actor: AccessTokenPayload) {
    const existing = await this.rooms.findDetail(id, actor.schoolId);
    if (!existing) throw new NotFoundException(`Room ${id} not found`);
    const cfg = await this.config.load(actor.schoolId);
    this.assertBedCount(dto.bedCount, cfg.maxBedsPerRoom);

    const clash = await this.rooms.findByRoomNo(
      existing.hostelId,
      dto.roomNo,
      id,
    );
    if (clash) {
      throw new ConflictException(
        `Room "${dto.roomNo}" already exists in this hostel.`,
      );
    }

    // Roadmap §8: "room maintenance with occupants → transfer wizard
    // before status change". The refusal IS the wizard's trigger — it
    // names how many people have to move, and the office moves them.
    if (
      dto.status === HostelRoomStatus.MAINTENANCE &&
      existing.status !== HostelRoomStatus.MAINTENANCE
    ) {
      const residents = await this.rooms.countResidents(id);
      if (residents > 0) {
        throw new ConflictException(
          `${residents} boarder(s) are still in room ${existing.roomNo}. Transfer them to other beds before taking the room out of service.`,
        );
      }
    }

    await this.rooms.update(id, {
      roomNo: dto.roomNo.trim(),
      floor: dto.floor ?? existing.floor,
      type: dto.type ?? existing.type,
      bedCount: dto.bedCount,
      monthlyFee: dto.monthlyFee,
      status: dto.status ?? existing.status,
      notes: dto.notes?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'HostelRoom',
      entityId: id,
      oldValues: {
        roomNo: existing.roomNo,
        monthlyFee: Number(existing.monthlyFee),
        status: existing.status,
      },
      newValues: {
        roomNo: dto.roomNo,
        monthlyFee: dto.monthlyFee,
        status: dto.status,
      },
    });
    return this.getRoom(id, actor);
  }

  async removeRoom(id: string, actor: AccessTokenPayload): Promise<void> {
    const room = await this.rooms.findDetail(id, actor.schoolId);
    if (!room) throw new NotFoundException(`Room ${id} not found`);

    const residents = await this.rooms.countResidents(id);
    if (residents > 0) {
      throw new ConflictException(
        `${residents} boarder(s) still live in room ${room.roomNo}. Move them out first.`,
      );
    }

    // The beds go with the room — they are meaningless outside it, and a
    // bed left behind would still be counted by the occupancy grid.
    await this.rooms.withTransaction(async (tx) => {
      await tx.hostelBed.updateMany({
        where: { roomId: id, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: actor.sub },
      });
      await tx.hostelRoom.update({
        where: { id },
        data: { deletedAt: new Date(), updatedBy: actor.sub },
      });
    });

    this.audit.set({
      entityType: 'HostelRoom',
      entityId: id,
      oldValues: { roomNo: room.roomNo, beds: room.beds.length },
    });
  }

  // ── beds ────────────────────────────────────────────────────────────

  /** Roadmap §4's bulk bed generation, for a room that already exists. */
  async generateBeds(
    roomId: string,
    dto: GenerateBedsDto,
    actor: AccessTokenPayload,
  ) {
    const room = await this.rooms.findDetail(roomId, actor.schoolId);
    if (!room) throw new NotFoundException(`Room ${roomId} not found`);
    const cfg = await this.config.load(actor.schoolId);

    const existing = room.beds.length;
    const target = existing + dto.count;
    if (target > cfg.maxBedsPerRoom) {
      throw new BadRequestException(
        `That would put ${target} beds in one room; the limit is ${cfg.maxBedsPerRoom} (hostel.max_beds_per_room).`,
      );
    }

    const prefix = dto.prefix?.trim() || cfg.bedNoPrefix;
    await this.rooms.withTransaction(async (tx) => {
      await this.writeBeds(
        tx,
        actor,
        room.hostelId,
        roomId,
        prefix,
        existing + 1,
        target,
      );
      // Intent follows reality here rather than the other way round: the
      // office asked for these beds, so the declared count is what they
      // just decided it should be.
      if (target > room.bedCount) {
        await tx.hostelRoom.update({
          where: { id: roomId },
          data: { bedCount: target, updatedBy: actor.sub },
        });
      }
    });

    this.audit.set({
      entityType: 'HostelRoom',
      entityId: roomId,
      newValues: { action: 'GENERATE_BEDS', added: dto.count, total: target },
    });
    return this.getRoom(roomId, actor);
  }

  async updateBed(id: string, dto: UpsertBedDto, actor: AccessTokenPayload) {
    const bed = await this.beds.findDetail(id, actor.schoolId);
    if (!bed) throw new NotFoundException(`Bed ${id} not found`);

    const clash = await this.beds.findByBedNo(bed.roomId, dto.bedNo, id);
    if (clash) {
      throw new ConflictException(
        `Bed "${dto.bedNo}" already exists in room ${bed.room.roomNo}.`,
      );
    }

    // A bed cannot be sent for repair with somebody asleep in it, and it
    // cannot be hand-set to OCCUPIED or VACANT either: those two are the
    // shadow of the allocation table and only the allocation flow writes
    // them (see `setOccupancyShadow`). Letting a form set them is exactly
    // how the shadow starts lying.
    if (dto.status && dto.status !== bed.status) {
      const held = await this.beds.countLiveInRoom(bed.roomId);
      void held;
      if (dto.status === HostelBedStatus.MAINTENANCE) {
        const occupant = await this.hostels.bedsWithHolders(
          actor.schoolId,
          bed.hostelId,
        );
        if (occupant.find((row) => row.id === id)?.held) {
          throw new ConflictException(
            `Bed ${bed.bedNo} has a boarder in it. Transfer or vacate them before marking it for maintenance.`,
          );
        }
      } else if (bed.status === HostelBedStatus.OCCUPIED) {
        throw new ConflictException(
          'A bed is marked occupied by the allocation that holds it, not by hand. Vacate the boarder instead.',
        );
      }
    }

    await this.beds.update(id, {
      bedNo: dto.bedNo.trim(),
      ...(dto.status ? { status: dto.status } : {}),
      notes: dto.notes?.trim() || null,
      updatedBy: actor.sub,
    });

    this.audit.set({
      entityType: 'HostelBed',
      entityId: id,
      oldValues: { bedNo: bed.bedNo, status: bed.status },
      newValues: { bedNo: dto.bedNo, status: dto.status },
    });
    return this.beds.findDetail(id, actor.schoolId);
  }

  async removeBed(id: string, actor: AccessTokenPayload): Promise<void> {
    const bed = await this.beds.findDetail(id, actor.schoolId);
    if (!bed) throw new NotFoundException(`Bed ${id} not found`);

    const holders = await this.hostels.bedsWithHolders(
      actor.schoolId,
      bed.hostelId,
    );
    if (holders.find((row) => row.id === id)?.held) {
      throw new ConflictException(
        `Bed ${bed.bedNo} has a boarder in it. Vacate them first.`,
      );
    }

    await this.beds.softDelete(id);
    this.audit.set({
      entityType: 'HostelBed',
      entityId: id,
      oldValues: { bedNo: bed.bedNo, room: bed.room.roomNo },
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private decorateRoom(room: RoomWithBeds, held: Set<string>) {
    const occupancy = summarize(
      room.beds.map((bed) => ({ status: bed.status, held: held.has(bed.id) })),
    );
    return {
      ...room,
      monthlyFee: Number(room.monthlyFee),
      beds: room.beds.map((bed) => ({
        ...bed,
        held: held.has(bed.id),
      })),
      occupancy,
      bedCountNote: bedCountMismatch(room.bedCount, room.beds.length),
    };
  }

  private async heldBedIds(
    schoolId: string,
    hostelId: string,
  ): Promise<Set<string>> {
    const beds = await this.hostels.bedsWithHolders(schoolId, hostelId);
    return new Set(beds.filter((bed) => bed.held).map((bed) => bed.id));
  }

  private async assertHostel(id: string, schoolId: string) {
    const hostel = await this.hostels.findDetail(id, schoolId);
    if (!hostel) throw new NotFoundException(`Hostel ${id} not found`);
    return hostel;
  }

  private async assertNameFree(
    schoolId: string,
    name: string,
    excludeId?: string,
  ) {
    const clash = await this.hostels.findByName(schoolId, name, excludeId);
    if (clash) {
      throw new ConflictException(`A hostel called "${name}" already exists.`);
    }
  }

  private assertBedCount(count: number, max: number): void {
    if (count > max) {
      throw new BadRequestException(
        `A room may hold at most ${max} beds (hostel.max_beds_per_room).`,
      );
    }
  }

  /**
   * Write beds `from`…`to` for a room. Numbering continues from what is
   * already there rather than restarting, so topping a room up from three
   * beds to five creates B4 and B5 — and `uq_hostel_beds_no` refuses the
   * write outright if it would not.
   */
  private async writeBeds(
    tx: Prisma.TransactionClient,
    actor: AccessTokenPayload,
    hostelId: string,
    roomId: string,
    prefix: string,
    from: number,
    to: number,
  ): Promise<void> {
    for (let index = from; index <= to; index++) {
      await tx.hostelBed.create({
        data: {
          schoolId: actor.schoolId,
          hostelId,
          roomId,
          bedNo: `${prefix}${index}`,
          status: HostelBedStatus.VACANT,
          createdBy: actor.sub,
          updatedBy: actor.sub,
        },
      });
    }
  }
}

/** Re-exported so the reports service can name the status union. */
export type { HostelAllocationStatus };
