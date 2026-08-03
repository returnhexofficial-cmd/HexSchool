/**
 * The hostel half of a monthly bill (roadmap M26 §4's "hostel + mess fee
 * lines to Module 16 (prorated)").
 *
 * Dependency-free and golden-tested. It composes `residency.engine` and
 * `mess.engine` into the **two or three lines** an invoice actually
 * carries, and it is the only place that decides what those lines are.
 *
 * **Why two lines and not one.** A school's hostel bill is a room charge
 * and a food charge, and they move independently: a boarder can suspend
 * their mess plan without giving up their bed, the two are often set by
 * different people, and a parent querying a bill asks about one or the
 * other. Merging them would also make the meal-off credit impossible to
 * show, because a credit that silently reduces a combined figure is
 * indistinguishable from a mistake.
 *
 * **Roadmap §8's proration precedence, stated once and obeyed
 * everywhere:** the *allocation* window first, then everything inside it.
 * The mess window is intersected with the residency before it is
 * prorated, and meal-off days are counted only where they overlap the
 * residency. A boarder who left on the 10th cannot be credited for being
 * away on the 20th, because they were not being charged for the 20th.
 *
 * **Each line arrives already prorated**, so M16 must add them with
 * `prorated: false` — M25's rule, and the reason for it is unchanged:
 * proration by enrolment date and proration by residency window answer
 * different questions, and multiplying them bills a mid-month joiner
 * (21/31)² of the rent, which is an error nobody spots because the number
 * still looks plausible.
 */

import { money } from '../../fee/calc/money.util';
import { mealOffCredit, messCharge, type MealOffCredit } from './mess.engine';
import {
  intersect,
  monthlyRent,
  rentDescription,
  type ResidencyWindow,
} from './residency.engine';
import type { IsoDate, IsoMonth } from './types';

export type HostelLineKind = 'RENT' | 'MESS' | 'MESS_CREDIT';

export interface HostelLine {
  kind: HostelLineKind;
  /** Negative for a credit — see `monthlyLines`. */
  amount: number;
  description: string;
  days: number;
  daysInMonth: number;
}

export interface MonthlyLinesInput {
  month: IsoMonth;
  hostelName: string;
  roomNo: string;
  /** The room's `monthly_fee`. */
  roomFee: number;
  residency: ResidencyWindow;
  /** `null` when the boarder is on no mess plan. */
  mess: {
    planName: string;
    monthlyCharge: number;
    window: ResidencyWindow;
  } | null;
  /** Approved meal-offs whose `credit_month` is this month. */
  mealOffs: ReadonlyArray<{
    fromDate: IsoDate;
    toDate: IsoDate;
    monthlyCharge: number;
  }>;
  /** `hostel.mess_day_rate`; 0 derives from the plan. */
  messDayRate: number;
  prorate: boolean;
}

export interface MonthlyLines {
  lines: HostelLine[];
  /** Rent + mess − credit, never below zero. */
  total: number;
  credit: MealOffCredit;
}

/**
 * The lines for one boarder for one month.
 *
 * **A credit is a negative line, and the total is floored at zero.** The
 * negative line is what a parent needs to see ("you were charged, and
 * here is what came back"), and the floor is what stops a boarder who was
 * away for six weeks from generating an invoice that owes *them* money —
 * M16 has no concept of a negative payable, and `chk_invoices_payable`
 * would refuse the row anyway. The unspent remainder is deliberately not
 * carried forward: a school that owes a family money settles it at the
 * desk, not by an invoice that reads like a bill.
 */
export function monthlyLines(input: MonthlyLinesInput): MonthlyLines {
  const lines: HostelLine[] = [];

  const rent = monthlyRent({
    monthlyFee: input.roomFee,
    month: input.month,
    window: input.residency,
    prorate: input.prorate,
  });
  if (rent.amount > 0) {
    lines.push({
      kind: 'RENT',
      amount: rent.amount,
      description: rentDescription(input.hostelName, input.roomNo, rent),
      days: rent.residentDays,
      daysInMonth: rent.daysInMonth,
    });
  }

  let messAmount = 0;
  if (input.mess) {
    // Roadmap §8: the allocation window first, then the mess inside it.
    const window = intersect(input.residency, input.mess.window);
    if (window !== null) {
      const charge = messCharge({
        monthlyCharge: input.mess.monthlyCharge,
        month: input.month,
        window,
        prorate: input.prorate,
      });
      if (charge.amount > 0) {
        messAmount = charge.amount;
        lines.push({
          kind: 'MESS',
          amount: charge.amount,
          description: `Mess — ${input.mess.planName}${
            charge.prorated
              ? `, ${charge.messDays}/${charge.daysInMonth} days`
              : ''
          }`,
          days: charge.messDays,
          daysInMonth: charge.daysInMonth,
        });
      }
    }
  }

  const credit = mealOffCredit({
    entries: input.mealOffs,
    flatRate: input.messDayRate,
    residency: input.residency,
    // The cap is THIS month's mess charge: the credit is a refund of food
    // billed, and there is nothing to refund beyond what was billed.
    cap: messAmount,
  });
  if (credit.amount > 0) {
    lines.push({
      kind: 'MESS_CREDIT',
      amount: -credit.amount,
      description: `Mess credit — ${credit.days} day(s) away${
        credit.capped ? ' (capped at this month’s mess charge)' : ''
      }`,
      days: credit.days,
      daysInMonth: 0,
    });
  }

  const total = money(Math.max(0, rent.amount + messAmount - credit.amount));
  return { lines, total, credit };
}

/**
 * Collapse the lines into what M16's `buildInvoice` can take: one figure
 * per fee head, never negative.
 *
 * The credit is netted **into the mess head** rather than becoming a line
 * of its own, because M16's invoice items hang off a fee head and a
 * "credit" head would show up in every fee report the school runs as a
 * income line that is always negative. The description keeps the story:
 * the parent sees "Mess — Full board, less 6 day(s) away".
 */
export function billableHeads(lines: MonthlyLines): Array<{
  kind: 'RENT' | 'MESS';
  amount: number;
  description: string;
}> {
  const out: Array<{
    kind: 'RENT' | 'MESS';
    amount: number;
    description: string;
  }> = [];

  const rent = lines.lines.find((line) => line.kind === 'RENT');
  if (rent && rent.amount > 0) {
    out.push({
      kind: 'RENT',
      amount: rent.amount,
      description: rent.description,
    });
  }

  const mess = lines.lines.find((line) => line.kind === 'MESS');
  const credit = lines.lines.find((line) => line.kind === 'MESS_CREDIT');
  if (mess) {
    const net = money(Math.max(0, mess.amount + (credit?.amount ?? 0)));
    if (net > 0 || credit) {
      out.push({
        kind: 'MESS',
        amount: net,
        description: credit
          ? `${mess.description}, less ${credit.days} day(s) away`
          : mess.description,
      });
    }
  }

  return out.filter((head) => head.amount > 0);
}
