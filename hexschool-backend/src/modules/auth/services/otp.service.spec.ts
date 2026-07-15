import { BadRequestException, HttpException } from '@nestjs/common';
import { createHash } from 'crypto';
import { OtpPurpose } from '../../../common/constants';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  let otpCodes: Record<string, jest.Mock>;
  let queue: { add: jest.Mock };
  let service: OtpService;

  const IDENT = '01712345678';
  const PURPOSE = OtpPurpose.PASSWORD_RESET;

  const hashOf = (code: string) =>
    createHash('sha256').update(`${IDENT}:${code}`).digest('hex');

  const record = (extra: object = {}) => ({
    id: 'otp-1',
    userId: 'user-1',
    identifier: IDENT,
    codeHash: hashOf('123456'),
    purpose: PURPOSE,
    expiresAt: new Date(Date.now() + 300_000),
    consumedAt: null,
    attempts: 0,
    createdAt: new Date(Date.now() - 120_000),
    ...extra,
  });

  beforeEach(() => {
    otpCodes = {
      createCode: jest.fn(),
      findLatestActive: jest.fn(),
      consumeActive: jest.fn(),
      incrementAttempts: jest.fn(),
      markConsumed: jest.fn(),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new OtpService(otpCodes as never, queue as never);
  });

  describe('issue', () => {
    it('stores a hashed 6-digit code and enqueues dispatch', async () => {
      otpCodes.findLatestActive.mockResolvedValue(null);

      await service.issue(IDENT, PURPOSE, 'user-1');

      expect(otpCodes.consumeActive).toHaveBeenCalledWith(IDENT, PURPOSE);
      const created = (
        otpCodes.createCode.mock.calls[0] as [Record<string, unknown>]
      )[0];
      expect(created.codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(queue.add).toHaveBeenCalledWith(
        'sms',
        expect.objectContaining({ type: 'sms', to: IDENT }),
      );
    });

    it('enforces the 60 s resend cooldown → 429', async () => {
      otpCodes.findLatestActive.mockResolvedValue(
        record({ createdAt: new Date(Date.now() - 30_000) }),
      );

      await expect(service.issue(IDENT, PURPOSE, 'user-1')).rejects.toThrow(
        HttpException,
      );
      expect(otpCodes.createCode).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('correct code consumes and returns the userId', async () => {
      otpCodes.findLatestActive.mockResolvedValue(record());

      await expect(service.verify(IDENT, PURPOSE, '123456')).resolves.toEqual({
        userId: 'user-1',
      });
      expect(otpCodes.markConsumed).toHaveBeenCalledWith('otp-1');
    });

    it('wrong code increments attempts; 3rd failure consumes the code', async () => {
      otpCodes.findLatestActive.mockResolvedValue(record({ attempts: 2 }));
      otpCodes.incrementAttempts.mockResolvedValue(3);

      await expect(service.verify(IDENT, PURPOSE, '000000')).rejects.toThrow(
        BadRequestException,
      );
      expect(otpCodes.markConsumed).toHaveBeenCalledWith('otp-1');
    });

    it('rejects expired codes', async () => {
      otpCodes.findLatestActive.mockResolvedValue(
        record({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.verify(IDENT, PURPOSE, '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when attempts are exhausted even with the right code', async () => {
      otpCodes.findLatestActive.mockResolvedValue(record({ attempts: 3 }));

      await expect(service.verify(IDENT, PURPOSE, '123456')).rejects.toThrow(
        BadRequestException,
      );
      expect(otpCodes.markConsumed).not.toHaveBeenCalled();
    });
  });
});
