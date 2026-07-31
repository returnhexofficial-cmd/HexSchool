/**
 * A hand-rolled **Code 128-B** encoder (roadmap §4: "barcode label PDF
 * sheets (Code128)").
 *
 * Dependency-free for the reason `ics.util.ts` (M05), `feed.util.ts`
 * (M19) and `zip.util.ts` (M22) are: the spec is small, completely
 * specified, and golden-testable against known-good check digits, and
 * pulling a barcode library in to draw ~90 rectangles would add a
 * transitive dependency to a printing path that must not break.
 *
 * The encoder emits **module widths**, not pixels — a bar is 1–4 modules
 * wide and the caller decides how wide a module is on the page. That is
 * what keeps this pure and lets the same output drive a 40 mm spine
 * label and a full A4 sheet.
 */

/**
 * The 107 Code 128 symbol patterns, indexed by symbol value. Each is six
 * alternating bar/space widths (11 modules) except the stop pattern,
 * which is seven (13 modules).
 *
 * This table is the specification; it is not derived from anything and
 * must not be "simplified". The golden test checks the three values
 * every implementation gets wrong — value 0, Start B (104) and Stop
 * (106) — plus a full symbol against a published check digit.
 */
const PATTERNS: readonly string[] = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

const START_B = 104;
const STOP = 106;

/** One drawable element of the symbol. */
export interface BarcodeBar {
  /** Module offset from the left edge of the symbol. */
  x: number;
  /** Width in modules (1–4). */
  width: number;
}

export interface Code128Symbol {
  /** The bars only — spaces are the gaps between them. */
  bars: BarcodeBar[];
  /** Total symbol width in modules, including the quiet zones. */
  modules: number;
  /** Modules of blank on each side; the spec asks for at least 10. */
  quietZone: number;
  /** The computed check symbol value, exposed for the golden test. */
  checksum: number;
}

/**
 * Code 128-B covers ASCII 32–126, which is every character an accession
 * number can legally contain (`accessionPattern` is alphanumeric plus
 * `-` and `/`). Anything outside it is a caller error rather than
 * something to silently transliterate — a label that scans as a
 * different string than the one printed under it is worse than no label.
 */
export function encodableCode128(value: string): boolean {
  return /^[\x20-\x7E]+$/.test(value) && value.length > 0;
}

export function encodeCode128B(value: string, quietZone = 10): Code128Symbol {
  if (!encodableCode128(value)) {
    throw new Error(
      `"${value}" cannot be encoded as Code 128-B — only printable ASCII is supported`,
    );
  }

  // Symbol values: Start B, then each character as (charCode − 32).
  const values = [START_B, ...[...value].map((ch) => ch.charCodeAt(0) - 32)];

  // Checksum: start value + Σ (value × position), position 1-based over
  // the data characters only, modulo 103.
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  const checksum = sum % 103;

  const symbols = [...values, checksum, STOP];

  const bars: BarcodeBar[] = [];
  let x = quietZone;
  for (const symbol of symbols) {
    const pattern = PATTERNS[symbol];
    // Widths alternate bar, space, bar, space… starting with a bar.
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
  }

  return { bars, modules: x + quietZone, quietZone, checksum };
}

/**
 * What a barcode scanner actually sends.
 *
 * Roadmap §8: "Barcode scanner sends Enter suffix → desk inputs handle
 * it." A USB scanner is a keyboard: it types the code and presses Enter,
 * and depending on the model it may also send a carriage return, a tab,
 * or leading whitespace picked up from the label's quiet zone. The desk
 * screen strips those client-side, and **so does the server** — because
 * a code arriving through the API from a scanner-driven page is exactly
 * as likely to carry a stray `\r` as one typed by hand, and a lookup
 * that fails on an invisible character is the single most confusing
 * failure a circulation desk can have.
 */
export function normalizeScannedCode(raw: string): string {
  return raw
    .replace(/[\r\n\t]/g, '')
    .trim()
    .toUpperCase();
}
