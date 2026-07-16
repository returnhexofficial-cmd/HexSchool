import { BadRequestException } from '@nestjs/common';

/**
 * Strict YYYY-MM-DD parser. The DTO regex only checks the SHAPE — inputs
 * like "2026-13-99" or "2026-02-30" still produce Invalid/rolled-over
 * Dates, so every service parses through here: the ISO round-trip must
 * reproduce the input exactly or the value is rejected with a 400.
 */
export function parseDate(value: string): Date {
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`"${value}" is not a valid calendar date`);
  }
  return date;
}

/** Date → YYYY-MM-DD. */
export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
