import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard nonce size

/**
 * Secrets-at-rest encryption for settings values (roadmap M04 §4):
 * AES-256-GCM with the 32-byte SETTINGS_ENCRYPTION_KEY from env.
 * Envelope format: `iv.authTag.ciphertext` (base64url segments) — the
 * GCM tag authenticates, so tampered rows fail closed on decrypt.
 */
@Injectable()
export class SettingsCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    // Joi enforces exactly 32 chars; used as the raw 32-byte key.
    this.key = Buffer.from(
      config.getOrThrow<string>('security.settingsEncryptionKey'),
      'utf8',
    );
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return [
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const [iv, tag, ciphertext] = envelope
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
