import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export const PREVIEW_TOKEN_TTL = '30m';
const PREVIEW_PURPOSE = 'website-preview';

export type PreviewSubject = 'page' | 'news';

interface PreviewTokenPayload {
  type: PreviewSubject;
  id: string;
  purpose: typeof PREVIEW_PURPOSE;
}

/**
 * Signed draft-preview tokens (roadmap M19 §6 — "drafts previewable via
 * signed preview token"). An editor with `website.view` mints one for a
 * specific row; the public read endpoint accepts it and, only then,
 * serves that DRAFT.
 *
 * The token names the exact row, so it cannot be replayed against another
 * page, and it expires in 30 minutes — a link pasted into a group chat
 * stops working before the draft is forgotten. Signed with the access
 * secret and holding no DB row (the M10 phone-token pattern).
 */
@Injectable()
export class PreviewTokenService {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('jwt.accessSecret');
  }

  sign(type: PreviewSubject, id: string): string {
    const payload: PreviewTokenPayload = { type, id, purpose: PREVIEW_PURPOSE };
    return this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: PREVIEW_TOKEN_TTL,
    });
  }

  /**
   * True when `token` authorises previewing exactly this row. Never
   * throws: an expired or forged token simply means "no preview", and the
   * caller then answers 404 as it would for any unpublished content —
   * a preview failure must not tell an anonymous visitor that a draft
   * exists.
   */
  authorises(
    token: string | undefined,
    type: PreviewSubject,
    id: string,
  ): boolean {
    if (!token) return false;
    try {
      const payload = this.jwt.verify<PreviewTokenPayload>(token, {
        secret: this.secret,
        clockTolerance: 30,
      });
      return (
        payload.purpose === PREVIEW_PURPOSE &&
        payload.type === type &&
        payload.id === id
      );
    } catch {
      return false;
    }
  }
}
