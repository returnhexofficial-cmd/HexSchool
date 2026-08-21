import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Source guard for QA finding **F29**.
 *
 * `new Date().toISOString().slice(0, 10)` reads as "today" and is not: it is
 * today **in UTC**. Bangladesh is UTC+6, so between 18:00 and midnight UTC —
 * every night from midnight to 6 AM in Dhaka — it returns *yesterday*.
 *
 * Eight call sites had it, and they were not cosmetic:
 *
 *  - a certificate's `issueDate`, printed on the document;
 *  - the `admissionDate` written when an application becomes a student;
 *  - a new routine's `effective_from`, which is what surfaced it — a routine
 *    created on 19 August in Dhaka came out effective from the 18th;
 *  - the default date on an attendance dashboard, which would open on the
 *    wrong day's register.
 *
 * `dhakaToday()` in `clock.util.ts` has existed since M12 and is exactly this,
 * done right. The mistake is that the raw idiom reads correct at a glance.
 *
 * Legitimate uses of `toISOString().slice(0, 10)` on a *specific* Date remain
 * fine — this only bans it on `new Date()` with no argument, i.e. "now".
 */

const SRC = path.resolve(__dirname, '../..');

const ALLOWED = [
  path.join('common', 'utils', 'clock.util.ts'),
  path.join('common', 'utils', 'no-utc-today.spec.ts'),
];

/** `new Date()` — no argument — truncated to a date. */
const UTC_TODAY = /new Date\(\s*\)\s*\.\s*toISOString\(\s*\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('no UTC-day "today"', () => {
  it('every "today" is the Dhaka day', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      if (file.endsWith('.spec.ts')) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(UTC_TODAY)) {
        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(
          `${path.relative(SRC, file).replace(/\\/g, '/')}:${line}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the guard matches "now" but not a specific date', () => {
    // Without this a broken pattern would make the test above pass silently.
    expect(
      'const today = new Date().toISOString().slice(0, 10);'.match(UTC_TODAY),
    ).not.toBeNull();

    // A named instant truncated to its date is a different, legitimate thing.
    for (const ok of [
      'row.createdAt.toISOString().slice(0, 10)',
      'new Date(value).toISOString().slice(0, 10)',
      'dhakaToday()',
    ]) {
      expect(ok.match(UTC_TODAY)).toBeNull();
    }
  });
});
