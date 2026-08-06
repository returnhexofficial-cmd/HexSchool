import { CertificateVerifierService } from './certificate-verifier.service';

/**
 * The public lookup, and the body M19 left as `{ available: false }`.
 *
 * Two rules run through every case: **the SELECT list is the privacy
 * policy** (a verifier learns whether the document is genuine and who it
 * describes, and nothing else), and **a public endpoint never confirms
 * that something exists** — a malformed code, an unknown code and a draft
 * all get the same answer.
 */
describe('CertificateVerifierService', () => {
  let prisma: { certificate: { findFirst: jest.Mock } };
  let service: CertificateVerifierService;

  beforeEach(() => {
    prisma = { certificate: { findFirst: jest.fn().mockResolvedValue(null) } };
    service = new CertificateVerifierService(prisma as never);
  });

  const row = (over: Record<string, unknown> = {}) => ({
    certificateNo: 'TC-26-0001',
    type: 'TRANSFER',
    status: 'ISSUED',
    issueKind: 'ORIGINAL',
    issuedAt: new Date('2026-08-06T09:00:00Z'),
    revokedAt: null,
    revokedReason: null,
    dataSnapshot: { class: 'Class 9', session: '2026' },
    student: { firstName: 'Rafiqul', lastName: 'Islam' },
    original: null,
    ...over,
  });

  describe('a genuine certificate', () => {
    it('reports VALID with the fields a verifier is entitled to', async () => {
      prisma.certificate.findFirst.mockResolvedValue(row());

      const result = await service.verify('4KJ7M2QX9B');

      expect(result.outcome).toBe('VALID');
      expect(result.certificate).toEqual({
        certificateNo: 'TC-26-0001',
        type: 'TRANSFER',
        studentName: 'Rafiqul Islam',
        className: 'Class 9',
        session: '2026',
        issueDate: '2026-08-06',
        isDuplicate: false,
        originalNo: null,
        revokedAt: null,
      });
    });

    it('reveals nothing beyond the name, class and session', async () => {
      prisma.certificate.findFirst.mockResolvedValue(row());
      const result = await service.verify('4KJ7M2QX9B');
      expect(JSON.stringify(result)).not.toMatch(/phone|email|address|gpa|nid/i);
    });

    /**
     * The class and session come from the FROZEN snapshot, not from a join
     * to the live enrollment — a student promoted since must not make a
     * genuine document read as describing the wrong year.
     */
    it('reads the class from the snapshot, not from a live join', async () => {
      prisma.certificate.findFirst.mockResolvedValue(
        row({ dataSnapshot: { class: 'Class 9', session: '2025' } }),
      );
      const result = await service.verify('4KJ7M2QX9B');
      expect(result.certificate?.className).toBe('Class 9');
      expect(result.certificate?.session).toBe('2025');
    });

    it('says a duplicate is genuine and names the original', async () => {
      prisma.certificate.findFirst.mockResolvedValue(
        row({
          issueKind: 'DUPLICATE',
          certificateNo: 'TC-26-0031',
          original: { certificateNo: 'TC-26-0001' },
        }),
      );

      const result = await service.verify('4KJ7M2QX9B');

      expect(result.outcome).toBe('VALID');
      expect(result.certificate?.isDuplicate).toBe(true);
      expect(result.certificate?.originalNo).toBe('TC-26-0001');
      expect(result.message).toContain('both are valid');
    });
  });

  describe('a revoked certificate', () => {
    /**
     * REVOKED is deliberately NOT folded into NOT_FOUND: a cancelled
     * document and a forgery must not look identical to whoever is
     * checking, and the school's own reason is the useful half.
     */
    it('reports REVOKED with the reason, not NOT_FOUND', async () => {
      prisma.certificate.findFirst.mockResolvedValue(
        row({
          status: 'REVOKED',
          revokedAt: new Date('2026-09-01T00:00:00Z'),
          revokedReason: 'Name corrected and reissued as TC-26-0031',
        }),
      );

      const result = await service.verify('4KJ7M2QX9B');

      expect(result.outcome).toBe('REVOKED');
      expect(result.message).toContain('TC-26-0031');
      expect(result.certificate?.revokedAt).toBe('2026-09-01');
    });
  });

  describe('everything else answers NOT_FOUND', () => {
    it('for an unknown code', async () => {
      const result = await service.verify('4KJ7M2QX9B');
      expect(result.outcome).toBe('NOT_FOUND');
      expect(result.certificate).toBeUndefined();
    });

    it('for a DRAFT, which has no public existence', async () => {
      prisma.certificate.findFirst.mockResolvedValue(row({ status: 'DRAFT' }));
      const result = await service.verify('4KJ7M2QX9B');
      expect(result.outcome).toBe('NOT_FOUND');
      expect(result.certificate).toBeUndefined();
    });

    it('for a malformed code, without touching the database', async () => {
      for (const code of ['', '   ', 'short', 'A'.repeat(30), '!!!!!!!!!!']) {
        const result = await service.verify(code);
        expect(result.outcome).toBe('NOT_FOUND');
      }
      expect(prisma.certificate.findFirst).not.toHaveBeenCalled();
    });

    it('gives an unknown code and a draft the identical answer', async () => {
      const unknown = await service.verify('4KJ7M2QX9B');
      prisma.certificate.findFirst.mockResolvedValue(row({ status: 'DRAFT' }));
      const draft = await service.verify('4KJ7M2QX9B');
      expect(draft).toEqual(unknown);
    });
  });

  describe('the code a person actually types', () => {
    it('folds case, separators and confusables before looking up', async () => {
      await service.verify(' 4kj7-m2qx-9b ');
      expect(prisma.certificate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ verifyCode: '4KJ7M2QX9B' }),
        }),
      );
    });

    it('maps O to 0 and I/L to 1, so a mis-read genuine code still resolves', async () => {
      await service.verify('OIL2345678');
      expect(prisma.certificate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ verifyCode: '0112345678' }),
        }),
      );
    });

    it('excludes soft-deleted rows', async () => {
      await service.verify('4KJ7M2QX9B');
      expect(prisma.certificate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });
  });
});
