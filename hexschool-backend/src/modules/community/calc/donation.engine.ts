import { money } from '../../fee/calc/money.util';
import type { DonationMethodCode } from './types';

/**
 * The donation register's arithmetic (roadmap M28 §4, §6, §7), with
 * nothing injected. Reuses M16's `money.util` for NUMERIC(12,2) rounding,
 * exactly as M20's engines do — one definition of what a paisa is.
 *
 * **The rule the whole file turns on: a receipt is immutable.** Roadmap §6
 * says so in four words, and it means the register never has an edit path.
 * A mistyped amount is CANCELLED with a reason and stays visible, which is
 * the M15 re-issue / M20 reversal / M24 purchase-cancellation / M27
 * certificate rule arriving in a fifth ledger. Every total below therefore
 * has to decide what to do about a cancelled row, and the answer is
 * always the same: it is excluded from the money and included in the count
 * of what happened.
 */

export interface DonationRecord {
  id: string;
  amount: number;
  purpose: string | null;
  method: DonationMethodCode;
  receivedAt: Date;
  donorName: string;
  alumniId: string | null;
  cancelledAt: Date | null;
}

/** Roadmap §7: amount > 0. */
export function donationAmountRefusal(amount: number): string | null {
  if (!Number.isFinite(amount)) return 'Enter a donation amount';
  if (money(amount) <= 0) {
    // Zero is not a donation, it is a row somebody created by accident —
    // and it would print a receipt saying the school received nothing.
    return 'A donation must be more than zero';
  }
  return null;
}

/**
 * An IN_KIND gift still carries a value, because that is what goes on the
 * receipt and into the accounts — but it never posts as **cash**. Twenty
 * donated benches are not twenty thousand taka in the cash box, and
 * posting them there would make the cash account disagree with the tin.
 */
export function postsToCash(method: DonationMethodCode): boolean {
  return method !== 'IN_KIND';
}

export function isLive(donation: Pick<DonationRecord, 'cancelledAt'>): boolean {
  return donation.cancelledAt === null;
}

export interface DonationTotals {
  /** Rows in the window, cancelled ones included. */
  count: number;
  /** Live rows only. */
  received: number;
  total: number;
  cancelled: number;
  cancelledAmount: number;
  fromAlumni: number;
  fromAlumniAmount: number;
  largest: number;
  average: number;
}

export function donationTotals(
  donations: readonly DonationRecord[],
): DonationTotals {
  const live = donations.filter(isLive);
  const cancelled = donations.filter((d) => !isLive(d));

  const total = money(live.reduce((sum, d) => sum + d.amount, 0));
  const alumniRows = live.filter((d) => d.alumniId !== null);

  return {
    count: donations.length,
    received: live.length,
    total,
    cancelled: cancelled.length,
    cancelledAmount: money(cancelled.reduce((sum, d) => sum + d.amount, 0)),
    fromAlumni: alumniRows.length,
    fromAlumniAmount: money(alumniRows.reduce((sum, d) => sum + d.amount, 0)),
    largest:
      live.length === 0 ? 0 : money(Math.max(...live.map((d) => d.amount))),
    average: live.length === 0 ? 0 : money(total / live.length),
  };
}

export interface GroupedTotal {
  key: string;
  label: string;
  count: number;
  amount: number;
  /** Share of the live total, to two places. Sums to ~100 by construction. */
  percent: number;
}

function group(
  donations: readonly DonationRecord[],
  keyOf: (donation: DonationRecord) => string,
  labelOf: (key: string) => string,
): GroupedTotal[] {
  const live = donations.filter(isLive);
  const total = money(live.reduce((sum, d) => sum + d.amount, 0));
  const buckets = new Map<string, { count: number; amount: number }>();

  for (const donation of live) {
    const key = keyOf(donation);
    const bucket = buckets.get(key) ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += donation.amount;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: labelOf(key),
      count: bucket.count,
      amount: money(bucket.amount),
      percent: total === 0 ? 0 : round2((bucket.amount / total) * 100),
    }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

/** Roadmap §4's "summary reports" — what the money was given FOR. */
export function byPurpose(
  donations: readonly DonationRecord[],
): GroupedTotal[] {
  return group(
    donations,
    (d) => (d.purpose?.trim() ? d.purpose.trim() : '__unspecified__'),
    (key) => (key === '__unspecified__' ? 'Unspecified' : key),
  );
}

export function byMethod(donations: readonly DonationRecord[]): GroupedTotal[] {
  return group(
    donations,
    (d) => d.method,
    (key) => key,
  );
}

/**
 * Month by month, in the order a fundraising drive is read.
 *
 * Months with nothing in them are **omitted rather than zero-filled**: the
 * caller knows the window it asked for and can fill gaps if it is drawing
 * a chart, whereas an engine that invents rows makes "we received nothing
 * in March" indistinguishable from "March is outside the window".
 */
export function byMonth(donations: readonly DonationRecord[]): GroupedTotal[] {
  return group(
    donations,
    (d) =>
      `${d.receivedAt.getUTCFullYear()}-${String(d.receivedAt.getUTCMonth() + 1).padStart(2, '0')}`,
    (key) => key,
  ).sort((a, b) => a.key.localeCompare(b.key));
}

export interface TopDonor {
  name: string;
  alumniId: string | null;
  count: number;
  amount: number;
}

/**
 * Roadmap §4's donor summary. Grouped by **alumni id when there is one and
 * by name otherwise**: two gifts from the same alumnus are one donor even
 * if the second receipt spelled the name differently, while two unrelated
 * "Abdul Karim"s with no alumni row genuinely cannot be told apart and the
 * register must not pretend otherwise.
 */
export function topDonors(
  donations: readonly DonationRecord[],
  limit = 10,
): TopDonor[] {
  const buckets = new Map<string, TopDonor>();

  for (const donation of donations.filter(isLive)) {
    const key =
      donation.alumniId ?? `name:${donation.donorName.trim().toLowerCase()}`;
    const bucket = buckets.get(key) ?? {
      name: donation.donorName,
      alumniId: donation.alumniId,
      count: 0,
      amount: 0,
    };
    bucket.count += 1;
    bucket.amount += donation.amount;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((donor) => ({ ...donor, amount: money(donor.amount) }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
