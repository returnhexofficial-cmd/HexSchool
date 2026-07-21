import { BadRequestException } from '@nestjs/common';

/**
 * Asia/Dhaka clock helpers (PROJECT_CONTEXT §11: store UTC, operate on
 * the school's local day). Bangladesh has a fixed +06:00 offset with no
 * DST, so the arithmetic is a constant shift — no timezone library and
 * no ambiguity around the DST transitions other zones have.
 */
export const DHAKA_OFFSET_MINUTES = 6 * 60;

/** Today's calendar date in Dhaka, as YYYY-MM-DD. */
export function dhakaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + DHAKA_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** Minutes elapsed since midnight in Dhaka (0–1439). */
export function dhakaMinutesOfDay(now: Date = new Date()): number {
  const shifted = new Date(now.getTime() + DHAKA_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** "HH:mm" → minutes since midnight. Rejects malformed settings values. */
export function minutesOfDay(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    throw new BadRequestException(`"${value}" is not a valid HH:mm time`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Same as `minutesOfDay` but falls back instead of throwing (settings). */
export function minutesOfDayOr(value: unknown, fallback: string): number {
  if (typeof value !== 'string') return minutesOfDay(fallback);
  try {
    return minutesOfDay(value);
  } catch {
    return minutesOfDay(fallback);
  }
}

/** A Prisma `@db.Time` value (1970-01-01T08:00:00Z) → minutes of day. */
export function timeColumnMinutes(value: Date): number {
  return value.getUTCHours() * 60 + value.getUTCMinutes();
}

/** Inclusive list of YYYY-MM-DD dates between two UTC-midnight dates. */
export function dateRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (
    let cursor = new Date(from.getTime());
    cursor.getTime() <= to.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    out.push(cursor.toISOString().slice(0, 10));
  }
  return out;
}
