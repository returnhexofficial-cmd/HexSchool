import { ConfigService } from '@nestjs/config';
import { SettingsCryptoService } from './settings-crypto.service';

describe('SettingsCryptoService', () => {
  const config = {
    getOrThrow: () => 'k'.repeat(32),
  } as unknown as ConfigService;
  const crypto = new SettingsCryptoService(config);

  it('round-trips arbitrary strings', () => {
    for (const secret of ['hunter2', 'বাংলা-কী-🔑', '', ' spaced  value ']) {
      expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
    }
  });

  it('produces a fresh envelope per call (random IV)', () => {
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('fails closed on tampered ciphertext (GCM auth)', () => {
    const envelope = crypto.encrypt('sensitive');
    const [iv, tag, cipher] = envelope.split('.');
    const flipped = cipher.startsWith('A')
      ? `B${cipher.slice(1)}`
      : `A${cipher.slice(1)}`;
    expect(() => crypto.decrypt([iv, tag, flipped].join('.'))).toThrow();
  });

  it('fails closed under a different key', () => {
    const other = new SettingsCryptoService({
      getOrThrow: () => 'x'.repeat(32),
    } as unknown as ConfigService);
    const envelope = crypto.encrypt('sensitive');
    expect(() => other.decrypt(envelope)).toThrow();
  });
});
