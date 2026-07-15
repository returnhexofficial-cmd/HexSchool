import { BadRequestException } from '@nestjs/common';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and verifies round-trip', async () => {
    const hash = await service.hash('Str0ngEnough!');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'Str0ngEnough!')).resolves.toBe(true);
    await expect(service.verify(hash, 'WrongPass1')).resolves.toBe(false);
  });

  it('verify never throws on malformed hashes', async () => {
    await expect(service.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  describe('assertAcceptable', () => {
    it('rejects common passwords case-insensitively', async () => {
      await expect(service.assertAcceptable('Password123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.assertAcceptable('Cricket786')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects reusing the current password (new ≠ last)', async () => {
      const currentHash = await service.hash('MyCurr3ntPass');
      await expect(
        service.assertAcceptable('MyCurr3ntPass', currentHash),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a strong, uncommon, different password', async () => {
      const currentHash = await service.hash('MyCurr3ntPass');
      await expect(
        service.assertAcceptable('Zx9#kLmPqRs7', currentHash),
      ).resolves.toBeUndefined();
    });
  });
});
