import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { isCommonPassword } from './common-passwords';

/**
 * Hashing (argon2id) + policy enforcement. Complexity rules live in the
 * DTOs (class-validator); this service adds the checks that need code or
 * context: common-password blocklist and new ≠ current.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * @param currentHash when provided, rejects reusing the current password
   *   (roadmap M02 §7: "New password ≠ last password").
   */
  async assertAcceptable(
    newPassword: string,
    currentHash?: string,
  ): Promise<void> {
    if (isCommonPassword(newPassword)) {
      throw new BadRequestException(
        'This password is too common — choose something harder to guess',
      );
    }
    if (currentHash && (await this.verify(currentHash, newPassword))) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }
  }
}
