import { BadRequestException } from '@nestjs/common';

export interface NormalizedIdentifier {
  email?: string;
  phone?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BD_PHONE_RE = /^01[3-9]\d{8}$/;

/** Strip the +88 / 88 country prefix from a BD number. */
export function normalizeBdPhone(raw: string): string {
  return raw.trim().replace(/^\+?88/, '');
}

/**
 * Login/reset identifier normalization (roadmap M02 §7): trim, lowercase
 * email, normalize BD phone to `01XXXXXXXXX`. Throws when the value is
 * neither a valid email nor a valid BD mobile number.
 */
export function normalizeIdentifier(raw: string): NormalizedIdentifier {
  const value = raw.trim();
  if (value.includes('@')) {
    const email = value.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException('Invalid email or phone number');
    }
    return { email };
  }
  const phone = normalizeBdPhone(value);
  if (!BD_PHONE_RE.test(phone)) {
    throw new BadRequestException('Invalid email or phone number');
  }
  return { phone };
}
