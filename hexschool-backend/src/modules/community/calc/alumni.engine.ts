import type { AlumniStatusCode } from './types';

/**
 * The alumni directory's rules (roadmap M28 §6, §7, §8), with nothing
 * injected.
 *
 * **The privacy filter is the reason this file exists.** Roadmap §6 says
 * the directory "exposes only opted-in fields", and there are two ways to
 * build that: query the whole row and drop fields on the way out, or never
 * fetch what may not be shown. This module does the first *and* the second
 * — the repository filters on `is_public_profile` in the WHERE clause (the
 * M19 rule that the SELECT list is the privacy policy), and `publicProfile`
 * below is the shape that leaves the building. Two locks on one door,
 * because the failure mode is a former student's phone number on a public
 * page and there is no taking it back.
 *
 * The second rule worth reading twice is `matchScore`. Roadmap §4 asks for
 * a "match hint against past GRADUATED students" and §8 for a conflict
 * queue. Both are the same problem seen from either end, and the answer to
 * both is that **the system never links a claim by itself**. It ranks
 * candidates and a human decides, because "Md. Rahman, batch 2015"
 * describes several real people at any BD school of size.
 */

export interface AlumniRecord {
  id: string;
  name: string;
  batchYear: number;
  lastClass: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  profession: string | null;
  organization: string | null;
  photoUrl: string | null;
  bio: string | null;
  isPublicProfile: boolean;
  status: AlumniStatusCode;
}

/**
 * What an anonymous visitor may see. Note what is missing and why:
 *
 *   - **phone, email and address are never here.** They are what a
 *     directory scraper wants and what an alumnus consented to share with
 *     the *school*, not with the internet. A school that wants a "contact
 *     this alumnus" feature needs a relay, not a published number.
 *   - `profession` and `organization` are the point of an alumni directory
 *     ("who from here works in medicine"), so they stay.
 */
export interface PublicAlumniProfile {
  id: string;
  name: string;
  batchYear: number;
  lastClass: string | null;
  profession: string | null;
  organization: string | null;
  photoUrl: string | null;
  bio: string | null;
}

/**
 * Returns `null` for anybody who has not opted in or is not approved —
 * `null` rather than a trimmed object, so a caller that forgets to check
 * renders nothing rather than a half-empty card.
 */
export function publicProfile(
  alumni: AlumniRecord,
): PublicAlumniProfile | null {
  if (alumni.status !== 'APPROVED' || !alumni.isPublicProfile) return null;
  return {
    id: alumni.id,
    name: alumni.name,
    batchYear: alumni.batchYear,
    lastClass: alumni.lastClass,
    profession: alumni.profession,
    organization: alumni.organization,
    photoUrl: alumni.photoUrl,
    bio: alumni.bio,
  };
}

export function publicDirectory(
  records: readonly AlumniRecord[],
): PublicAlumniProfile[] {
  return records
    .map(publicProfile)
    .filter((profile): profile is PublicAlumniProfile => profile !== null);
}

/**
 * Roadmap §7: `batch_year` 1950–current.
 *
 * The upper bound is `currentYear`, not `currentYear + 1`: somebody
 * finishing this coming December is a student, not an alumnus, and the
 * directory is not where they belong yet. The DB CHECK carries a wide
 * sanity range instead, because a constraint over `CURRENT_DATE` is not
 * IMMUTABLE and would make a January restore reject rows that were legal
 * when they were written.
 */
export function batchYearRefusal(
  batchYear: number,
  currentYear: number,
  minYear: number,
): string | null {
  if (!Number.isInteger(batchYear)) {
    return 'The batch year must be a whole year';
  }
  if (batchYear < minYear) {
    return `The batch year must be ${minYear} or later`;
  }
  if (batchYear > currentYear) {
    return `The batch year cannot be in the future (this year is ${currentYear})`;
  }
  return null;
}

export interface GraduateCandidate {
  studentId: string;
  studentUid: string;
  name: string;
  /** The year the school recorded them as GRADUATED, when it knows it. */
  graduationYear: number | null;
  lastClass: string | null;
  phone: string | null;
}

export interface MatchHint extends GraduateCandidate {
  /** 0–100. Ranking only — nothing auto-links on it. */
  score: number;
  reasons: string[];
  /** Somebody already holds an APPROVED claim on this student. */
  alreadyClaimed: boolean;
}

/**
 * Rank the school's graduates against a registration.
 *
 * The weights say what the school actually knows. A phone number is the
 * strongest signal a BD school has — it is how the guardian was contacted
 * for five years — and matching it is worth more than a name, because
 * names repeat and are transliterated half a dozen ways. The batch year
 * is a strong *filter* and a weak *confirmation*: getting it right proves
 * little (everyone in the list has it), getting it wrong is disqualifying.
 *
 * **Nothing here decides anything.** The highest score is a suggestion at
 * the top of an approver's screen.
 */
export function matchScore(
  claim: { name: string; batchYear: number; phone: string | null },
  candidate: GraduateCandidate,
  claimedStudentIds: ReadonlySet<string> = new Set(),
): MatchHint {
  const reasons: string[] = [];
  let score = 0;

  if (
    claim.phone &&
    candidate.phone &&
    samePhone(claim.phone, candidate.phone)
  ) {
    score += 55;
    reasons.push('The phone number on file matches');
  }

  const nameScore = nameSimilarity(claim.name, candidate.name);
  if (nameScore > 0) {
    score += Math.round(nameScore * 30);
    if (nameScore === 1) reasons.push('The name matches exactly');
    else if (nameScore >= 0.5) reasons.push('The name is a close match');
  }

  if (candidate.graduationYear !== null) {
    const gap = Math.abs(candidate.graduationYear - claim.batchYear);
    if (gap === 0) {
      score += 15;
      reasons.push('Graduated in the batch year claimed');
    } else if (gap === 1) {
      score += 5;
      reasons.push('Graduated within a year of the batch claimed');
    }
  }

  return {
    ...candidate,
    score: Math.min(100, score),
    reasons,
    alreadyClaimed: claimedStudentIds.has(candidate.studentId),
  };
}

export function matchHints(
  claim: { name: string; batchYear: number; phone: string | null },
  candidates: readonly GraduateCandidate[],
  claimedStudentIds: ReadonlySet<string> = new Set(),
  limit = 5,
): MatchHint[] {
  return candidates
    .map((candidate) => matchScore(claim, candidate, claimedStudentIds))
    .filter((hint) => hint.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Deterministic on a tie, and asserted both ways in the spec: the
        // M14 lesson that an id comparison which only ever sees one order
        // in its fixtures is a bug waiting for production UUIDs.
        a.studentUid.localeCompare(b.studentUid),
    )
    .slice(0, limit);
}

/**
 * Roadmap §8's conflict: a claim on a student record somebody already
 * holds. The refusal is at approval, never at registration — a genuine
 * alumnus whose identity was claimed first by somebody else must still be
 * able to apply, and the school must be able to see both and choose.
 */
export function claimConflictRefusal(input: {
  studentId: string | null;
  claimedStudentIds: ReadonlySet<string>;
  /** The row being approved, so re-approving itself is not a conflict. */
  ownStudentId: string | null;
}): string | null {
  if (!input.studentId) return null;
  if (input.studentId === input.ownStudentId) return null;
  if (input.claimedStudentIds.has(input.studentId)) {
    return 'Another alumni profile has already been approved against this student record. Resolve the duplicate before approving this one.';
  }
  return null;
}

export interface EventCapacityView {
  capacity: number | null;
  /** Seats already taken: registrations plus their guests. */
  taken: number;
}

/** Seats a registration consumes: the alumnus, plus anybody they bring. */
export function seatsFor(guests: number): number {
  return 1 + Math.max(0, guests);
}

/**
 * Over capacity **warns**, it does not refuse — the M25 bus rule. A
 * reunion that seats a hundred and has a hundred and two people wanting to
 * come is a real thing that happens, and a system that made it
 * unrecordable would simply be lied to.
 */
export function capacityWarning(
  event: EventCapacityView,
  incomingSeats: number,
): string | null {
  if (event.capacity === null) return null;
  const after = event.taken + incomingSeats;
  if (after <= event.capacity) return null;
  return `This registration takes the event to ${after} of ${event.capacity} places.`;
}

export function registrationClosedRefusal(
  deadline: Date | null,
  eventDate: Date,
  now: Date,
): string | null {
  const cutoff = deadline ?? eventDate;
  if (startOfDay(now).getTime() > startOfDay(cutoff).getTime()) {
    return `Registration closed on ${startOfDay(cutoff).toISOString().slice(0, 10)}.`;
  }
  return null;
}

// ── helpers ───────────────────────────────────────────────────────────

/** Compares the last 10 digits, which is how a BD number is quoted. */
function samePhone(a: string, b: string): boolean {
  const digits = (v: string) => v.replace(/\D/g, '').slice(-10);
  const left = digits(a);
  return left.length >= 10 && left === digits(b);
}

/**
 * Token overlap, deliberately crude. A BD school's records hold "Md.
 * Rahman", "Mohammad Rahman" and "MD RAHMAN" for the same person, so this
 * normalizes the honorific away and compares the rest as a set. It is not
 * a fuzzy matcher and does not pretend to be — anything cleverer would
 * start being trusted, and the whole design here is that a human decides.
 */
export function nameSimilarity(a: string, b: string): number {
  const tokens = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-zঀ-৿\s]/g, ' ')
      .split(/\s+/)
      .map((token) =>
        token === 'mohammad' || token === 'muhammad' ? 'md' : token,
      )
      .filter((token) => token.length > 1);

  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
