import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Donation } from '@prisma/client';
import { AuditContextService } from '../../audit/services/audit-context.service';
import type { AccessTokenPayload } from '../../auth/interfaces/token-payload.interface';
import { SchoolsRepository } from '../../school/repositories/schools.repository';
import { SequenceService } from '../../sequence/sequence.service';
import { donationAmountRefusal } from '../calc/donation.engine';
import { CancelDonationDto, CreateDonationDto, DonationQueryDto } from '../dto';
import {
  AlumniRepository,
  DonationsRepository,
} from '../repositories/alumni.repository';
import { CommunityNotificationsService } from './community-notifications.service';
import { CommunitySettingsService } from './community-settings.service';
import { DonationPostingService } from './donation-posting.service';

/**
 * The donation register (roadmap M28 §4, §6, §7).
 *
 * **A receipt is immutable.** Roadmap §6 says so in four words, and it is
 * the whole shape of this service: there is no update method, and there
 * never will be. A mistyped amount is CANCELLED with a reason and stays
 * visible in the register — the M15 re-issue / M20 reversal / M24
 * purchase-cancellation / M27 certificate rule arriving in a fifth ledger.
 *
 * **Cancelling the donation does NOT cancel its voucher.** That is the
 * M24/M25 precedent, verbatim: reversing a posted entry is the
 * accountant's act, `voucher.cancel` is not the alumni desk's permission,
 * and a module that quietly reversed ledger entries on somebody else's
 * behalf would be the second place in the system with an opinion about
 * the books. The cancellation names the receipt and the accountant
 * reverses it.
 */
@Injectable()
export class DonationsService {
  constructor(
    private readonly donations: DonationsRepository,
    private readonly alumni: AlumniRepository,
    private readonly config: CommunitySettingsService,
    private readonly posting: DonationPostingService,
    private readonly notifications: CommunityNotificationsService,
    private readonly sequences: SequenceService,
    private readonly schools: SchoolsRepository,
    private readonly audit: AuditContextService,
  ) {}

  async list(query: DonationQueryDto, user: AccessTokenPayload) {
    const { rows, total } = await this.donations.findMany(
      user.schoolId,
      {
        alumniId: query.alumniId,
        method: query.method,
        liveOnly: query.liveOnly,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        search: query.search,
      },
      query.page,
      query.limit,
    );

    return {
      data: rows,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async get(id: string, user: AccessTokenPayload): Promise<Donation> {
    const row = await this.donations.findDetail(id, user.schoolId);
    if (!row) throw new NotFoundException(`Donation ${id} not found`);
    return row;
  }

  async create(
    dto: CreateDonationDto,
    user: AccessTokenPayload,
  ): Promise<Donation> {
    const cfg = await this.config.load(user.schoolId);
    if (!cfg.enabled) {
      throw new BadRequestException(
        'The complaints, visitor and alumni module is switched off for this school',
      );
    }

    const amountRefusal = donationAmountRefusal(dto.amount);
    if (amountRefusal) throw new BadRequestException(amountRefusal);

    let donorName = dto.donorName;
    if (dto.alumniId) {
      const alumnus = await this.alumni.findDetail(dto.alumniId, user.schoolId);
      if (!alumnus) {
        throw new NotFoundException('That alumni profile is not on file');
      }
      // The name on the receipt is a SNAPSHOT even when the alumni row
      // exists — a receipt says what it said, and a later correction to
      // the directory must not silently rewrite a document somebody is
      // holding (the M27 frozen-snapshot rule).
      donorName = dto.donorName.trim() || alumnus.name;
    }

    const school = await this.schools.findByIdOrFail(user.schoolId);
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();

    const donation = await this.donations.withTransaction(async (tx) => {
      // Claimed INSIDE the transaction, so a rolled-back save never burns
      // a receipt number (the M07 gap-free guarantee).
      const receiptNo = await this.sequences.nextDocumentNumber({
        schoolId: user.schoolId,
        counterKey: `donation:${receivedAt.getUTCFullYear() % 100}`,
        pattern: cfg.donationReceiptPattern,
        schoolCode: school.code,
        date: receivedAt,
        tx,
      });

      return this.donations.create(
        {
          schoolId: user.schoolId,
          alumniId: dto.alumniId ?? null,
          donorName,
          donorPhone: dto.donorPhone ?? null,
          donorEmail: dto.donorEmail ?? null,
          amount: dto.amount,
          purpose: dto.purpose ?? null,
          method: dto.method,
          receivedAt,
          receiptNo,
          remarks: dto.remarks ?? null,
          receivedBy: user.sub,
          createdBy: user.sub,
        },
        tx,
      );
    });

    this.audit.set({
      entityType: 'Donation',
      entityId: donation.id,
      newValues: {
        receiptNo: donation.receiptNo,
        donorName: donation.donorName,
        amount: donation.amount.toString(),
      },
    });

    // The posting is attempted AFTER the receipt commits, and never rolls
    // it back: the money has changed hands (M20/M21/M24/M25/M26).
    if (cfg.donationPostToAccounts) {
      const voucherId = await this.posting.postDonation({
        schoolId: user.schoolId,
        donationId: donation.id,
        donorName: donation.donorName,
        amount: Number(donation.amount),
        method: donation.method,
        date: donation.receivedAt,
        purpose: donation.purpose,
        actorId: user.sub,
      });
      if (voucherId) {
        return this.donations.update(donation.id, { voucherId });
      }
    }

    if (dto.notify !== false) {
      await this.notifications.thankDonor(donation, cfg);
    }
    return donation;
  }

  /**
   * The only correction there is. The row stays in the register, carrying
   * its reason — `chk_donations_shape` refuses a cancellation without one.
   */
  async cancel(
    id: string,
    dto: CancelDonationDto,
    user: AccessTokenPayload,
  ): Promise<Donation> {
    const existing = await this.get(id, user);
    if (existing.cancelledAt) {
      throw new ConflictException(
        `Receipt ${existing.receiptNo} was already cancelled on ${existing.cancelledAt.toISOString().slice(0, 10)}`,
      );
    }

    const updated = await this.donations.update(id, {
      cancelledAt: new Date(),
      cancelledBy: user.sub,
      cancelledReason: dto.reason,
      updatedBy: user.sub,
    });

    this.audit.set({
      entityType: 'Donation',
      entityId: id,
      oldValues: {
        receiptNo: existing.receiptNo,
        amount: existing.amount.toString(),
      },
      newValues: { cancelledReason: dto.reason },
    });
    return updated;
  }
}
