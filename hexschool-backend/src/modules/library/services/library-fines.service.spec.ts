import { BadRequestException, ConflictException } from '@nestjs/common';
import { LibraryFinesService } from './library-fines.service';

/**
 * Collecting and waiving.
 *
 * Both operations are guarded by the same invariant: what has been
 * settled can never exceed what was assessed, and `fine_paid` is
 * recomputed from the arithmetic rather than assigned. The database
 * CHECK enforces both a second time — these tests are what turns the
 * resulting 500 into a sentence.
 */
describe('LibraryFinesService', () => {
  const actor = { sub: 'user-1', schoolId: 'school-1' } as never;

  let issues: Record<string, jest.Mock>;
  let circulation: Record<string, jest.Mock>;
  let directory: Record<string, jest.Mock>;
  let posting: Record<string, jest.Mock>;
  let config: Record<string, jest.Mock>;
  let service: LibraryFinesService;

  const issueWith = (over: Record<string, unknown> = {}) => ({
    id: 'issue-1',
    fineAmount: 100,
    fineCollected: 0,
    fineWaived: 0,
    fineReason: 'OVERDUE',
    fineVoucherId: null,
    remarks: null,
    copy: { accessionNo: 'ACC-26-00001', book: { title: 'Physics' } },
    member: { cardNo: 'LIB-26-00001', personType: 'STUDENT', personId: 's-1' },
    ...over,
  });

  beforeEach(() => {
    issues = { update: jest.fn(), findMany: jest.fn() };
    circulation = { detail: jest.fn().mockResolvedValue(issueWith()) };
    directory = {
      lookup: jest.fn().mockResolvedValue({ name: 'Rahim Uddin' }),
    };
    posting = { postFineReceipt: jest.fn().mockResolvedValue('voucher-1') };
    config = {
      load: jest.fn().mockResolvedValue({ autoPostAccounting: true }),
    };

    service = new LibraryFinesService(
      issues as never,
      circulation as never,
      directory as never,
      posting as never,
      config as never,
      { set: jest.fn() } as never,
    );
  });

  describe('collect', () => {
    it('settles the whole fine when no amount is given', async () => {
      const result = await service.collect('issue-1', {}, actor);

      expect(result.collected).toBe(100);
      expect(result.outstanding).toBe(0);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ fineCollected: 100, finePaid: true }),
      );
    });

    it('takes a part-payment and leaves the balance owing', async () => {
      const result = await service.collect('issue-1', { amount: 40 }, actor);

      expect(result.collected).toBe(40);
      expect(result.outstanding).toBe(60);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ fineCollected: 40, finePaid: false }),
      );
    });

    it('adds to what was already collected rather than replacing it', async () => {
      circulation.detail.mockResolvedValue(issueWith({ fineCollected: 40 }));

      const result = await service.collect('issue-1', { amount: 60 }, actor);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ fineCollected: 100, finePaid: true }),
      );
      expect(result.outstanding).toBe(0);
    });

    /**
     * Over-collecting would break `chk_book_issues_fine_amounts` at the
     * database. Refusing it here is what turns a 500 into a message a
     * librarian can act on.
     */
    it('refuses more than is outstanding', async () => {
      await expect(
        service.collect('issue-1', { amount: 150 }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(issues.update).not.toHaveBeenCalled();
    });

    it('refuses when there is nothing to collect', async () => {
      circulation.detail.mockResolvedValue(
        issueWith({ fineAmount: 0, fineCollected: 0 }),
      );
      await expect(
        service.collect('issue-1', {}, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('counts a waived portion as already settled', async () => {
      circulation.detail.mockResolvedValue(issueWith({ fineWaived: 70 }));

      const result = await service.collect('issue-1', {}, actor);
      expect(result.collected).toBe(30);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ fineCollected: 30, finePaid: true }),
      );
    });

    it('posts the receipt to the ledger and records the voucher', async () => {
      await service.collect('issue-1', {}, actor);

      expect(posting.postFineReceipt).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'issue-1', amount: 100 }),
      );
      expect(issues.update).toHaveBeenCalledWith('issue-1', {
        fineVoucherId: 'voucher-1',
      });
    });

    it('posts nothing when the school has auto-posting switched off', async () => {
      config.load.mockResolvedValue({ autoPostAccounting: false });
      await service.collect('issue-1', {}, actor);
      expect(posting.postFineReceipt).not.toHaveBeenCalled();
    });

    /** The second instalment must not raise a second income voucher. */
    it('does not post twice for a loan that already has a voucher', async () => {
      circulation.detail.mockResolvedValue(
        issueWith({ fineCollected: 40, fineVoucherId: 'voucher-1' }),
      );
      await service.collect('issue-1', { amount: 60 }, actor);
      expect(posting.postFineReceipt).not.toHaveBeenCalled();
    });

    /**
     * A misconfigured chart of accounts must not lose a receipt — M20's
     * rule, and the reason `postFineReceipt` returns null rather than
     * throwing.
     */
    it('keeps the collection when the ledger posting fails', async () => {
      posting.postFineReceipt.mockResolvedValue(null);

      const result = await service.collect('issue-1', {}, actor);
      expect(result.collected).toBe(100);
      expect(result.voucherId).toBeNull();
    });
  });

  describe('waive', () => {
    it('writes the whole fine off with the reason attached', async () => {
      const result = await service.waive(
        'issue-1',
        { reason: 'Book damaged in the flood' },
        actor,
      );

      expect(result.waived).toBe(100);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({
          fineWaived: 100,
          fineWaivedBy: 'user-1',
          fineWaiveReason: 'Book damaged in the flood',
          finePaid: true,
        }),
      );
    });

    /** Roadmap §8's partial fine with a reason. */
    it('waives part and leaves the rest owing', async () => {
      const result = await service.waive(
        'issue-1',
        { amount: 60, reason: 'Half, disputed damage' },
        actor,
      );

      expect(result.outstanding).toBe(40);
      expect(issues.update).toHaveBeenCalledWith(
        'issue-1',
        expect.objectContaining({ fineWaived: 60, finePaid: false }),
      );
    });

    it('refuses more than is outstanding', async () => {
      circulation.detail.mockResolvedValue(issueWith({ fineCollected: 80 }));
      await expect(
        service.waive('issue-1', { amount: 50, reason: 'Goodwill' }, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when nothing is owed', async () => {
      circulation.detail.mockResolvedValue(issueWith({ fineAmount: 0 }));
      await expect(
        service.waive('issue-1', { reason: 'Goodwill' }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    /** A waiver never touches the ledger — no money moved. */
    it('posts nothing to accounting', async () => {
      await service.waive('issue-1', { reason: 'Goodwill' }, actor);
      expect(posting.postFineReceipt).not.toHaveBeenCalled();
    });
  });
});
