import { normalizeScannedCode } from './barcode.util';

/**
 * The physical stock-take diff (roadmap §4: "stock-check — physical
 * verification mode: scan-all, diff report").
 *
 * Dependency-free set arithmetic, and the whole difficulty is in what
 * counts as "should be on the shelf". A copy that is **on loan** is
 * legitimately absent; a copy marked LOST or WITHDRAWN is legitimately
 * absent too. Only AVAILABLE and RESERVED copies are expected to be
 * physically present — which is why the expected set is computed at the
 * moment the count is *closed* rather than when it was opened: a book
 * issued during a week-long stock-take would otherwise be reported
 * missing, and the librarian would spend an afternoon looking for a book
 * that is on a student's desk.
 */

export type ShelfStatus =
  'AVAILABLE' | 'ISSUED' | 'RESERVED' | 'LOST' | 'DAMAGED' | 'WITHDRAWN';

/** The statuses that mean "this should be on the shelf right now". */
export const EXPECTED_ON_SHELF: ReadonlySet<ShelfStatus> = new Set<ShelfStatus>(
  ['AVAILABLE', 'RESERVED'],
);

export interface ShelfCopy {
  id: string;
  accessionNo: string;
  status: ShelfStatus;
  bookTitle: string;
  rackNo: string | null;
}

export interface ScanRecord {
  /** `null` when the scanned code matched no copy in the catalogue. */
  copyId: string | null;
  accessionNo: string;
}

export interface StockDiff {
  expectedCount: number;
  scannedCount: number;
  /** Expected on the shelf, never scanned. The report that matters. */
  missing: ShelfCopy[];
  /**
   * Scanned but not expected — a copy the system thinks is on loan, or
   * one whose accession number is not in the catalogue at all. Both are
   * real findings: the first is a return somebody forgot to record, the
   * second is a book that was never catalogued.
   */
  unexpected: Array<{
    accessionNo: string;
    copy: ShelfCopy | null;
    reason: 'ON_LOAN' | 'OUT_OF_CIRCULATION' | 'UNKNOWN';
  }>;
  /** Scanned, expected, and found — the boring majority. */
  verifiedCount: number;
  /** Scanned copies whose rack does not match the count's rack filter. */
  misplaced: ShelfCopy[];
}

/**
 * Diff a set of scans against the catalogue.
 *
 * `rackNo` narrows what was *expected*: a stock-take of rack C is not a
 * claim about the rest of the library, so a book from rack A is neither
 * missing (it was not expected) nor unexpected (it exists and is
 * shelvable) — it is **misplaced**, which is its own finding and the one
 * a librarian can act on in thirty seconds.
 */
export function diffStock(
  copies: readonly ShelfCopy[],
  scans: readonly ScanRecord[],
  rackNo?: string | null,
): StockDiff {
  const rack = rackNo?.trim().toUpperCase() || null;

  const byId = new Map(copies.map((c) => [c.id, c]));
  const byAccession = new Map(
    copies.map((c) => [normalizeScannedCode(c.accessionNo), c]),
  );

  const inScope = (copy: ShelfCopy): boolean =>
    rack === null || (copy.rackNo ?? '').trim().toUpperCase() === rack;

  const expected = copies.filter(
    (c) => EXPECTED_ON_SHELF.has(c.status) && inScope(c),
  );

  // De-duplicate: scanning one shelf twice is normal, and a stock-take
  // that reported 1,200 of 900 books would be discarded by the person
  // running it. (The DB's `uq_stock_verification_scans_copy` enforces
  // the same thing for rows that resolved to a copy; this handles the
  // unresolved ones, which have no id to be unique on.)
  const scannedIds = new Set<string>();
  const scannedCodes = new Set<string>();
  for (const scan of scans) {
    const code = normalizeScannedCode(scan.accessionNo);
    scannedCodes.add(code);
    const copy = scan.copyId ? byId.get(scan.copyId) : byAccession.get(code);
    if (copy) scannedIds.add(copy.id);
  }

  const missing = expected.filter((c) => !scannedIds.has(c.id));

  const unexpected: StockDiff['unexpected'] = [];
  const misplaced: ShelfCopy[] = [];
  for (const code of scannedCodes) {
    const copy = byAccession.get(code);
    if (!copy) {
      unexpected.push({ accessionNo: code, copy: null, reason: 'UNKNOWN' });
      continue;
    }
    if (copy.status === 'ISSUED') {
      unexpected.push({
        accessionNo: code,
        copy,
        reason: 'ON_LOAN',
      });
      continue;
    }
    if (!EXPECTED_ON_SHELF.has(copy.status)) {
      unexpected.push({
        accessionNo: code,
        copy,
        reason: 'OUT_OF_CIRCULATION',
      });
      continue;
    }
    if (!inScope(copy)) misplaced.push(copy);
  }

  const verifiedCount = expected.length - missing.length;

  return {
    expectedCount: expected.length,
    scannedCount: scannedCodes.size,
    missing,
    unexpected,
    verifiedCount,
    misplaced,
  };
}
