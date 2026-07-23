/**
 * SMS segmentation + cost (roadmap M17 §4 "compute parts correctly!",
 * §6 "Bangla body → 70-char segments"). Dependency-free and golden-tested.
 *
 * An SMS is billed per *segment*, and the segment size depends on the
 * alphabet:
 *   - **GSM-7** (plain Latin): 160 chars in a single segment, 153 per
 *     segment once it is concatenated (7 bytes go to the multipart header).
 *   - **UCS-2** (anything outside GSM-7, i.e. every Bangla message): 70
 *     chars single, 67 per segment concatenated.
 *
 * A handful of GSM-7 characters (`^ { } [ ] ~ \ | €`) occupy TWO code
 * units — miscounting them under-bills a message that *looks* one part.
 */

/** The GSM 03.38 basic character set (single code unit each). */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** GSM-7 extension characters — each costs two code units. */
const GSM7_EXTENDED = new Set(['^', '{', '}', '[', ']', '~', '\\', '|', '€']);

const GSM7_BASIC_SET = new Set(GSM7_BASIC.split(''));

/** True when the text needs UCS-2 (any character outside GSM-7). */
export function isUnicode(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC_SET.has(ch) && !GSM7_EXTENDED.has(ch)) return true;
  }
  return false;
}

/** GSM-7 code-unit length (extended chars count twice). */
function gsm7Units(text: string): number {
  let units = 0;
  for (const ch of text) units += GSM7_EXTENDED.has(ch) ? 2 : 1;
  return units;
}

export interface SmsSegmentation {
  unicode: boolean;
  /** Billable code units (GSM-7) or UTF-16 code units (UCS-2). */
  units: number;
  /** Number of billed segments (≥ 1, even for the empty string). */
  segments: number;
  /** Chars that still fit before the next segment rolls over. */
  charsPerSegment: number;
}

/**
 * Segment a body. UCS-2 counts UTF-16 code units, so an emoji or a
 * combined Bangla cluster is measured the way a gateway actually bills it.
 */
export function segmentSms(text: string): SmsSegmentation {
  const unicode = isUnicode(text);

  if (unicode) {
    // UTF-16 code units — [...text].length would under-count surrogate
    // pairs, which a gateway bills as two.
    const units = text.length;
    const single = 70;
    const multi = 67;
    const segments = units <= single ? 1 : Math.ceil(units / multi);
    return { unicode, units, segments, charsPerSegment: multi };
  }

  const units = gsm7Units(text);
  const single = 160;
  const multi = 153;
  const segments = units <= single ? 1 : Math.ceil(units / multi);
  return { unicode, units, segments, charsPerSegment: multi };
}

/** Just the billed part count (≥ 1). */
export function countSegments(text: string): number {
  return segmentSms(text).segments;
}

/**
 * Cost of a message in the ledger's unit (BDT). `ratePerPart` comes from
 * `communication.sms_rate_per_part`; a distinct unicode rate is honoured
 * when the gateway charges Bangla differently.
 */
export function estimateSmsCost(
  text: string,
  ratePerPart: number,
  unicodeRatePerPart?: number,
): number {
  const seg = segmentSms(text);
  const rate =
    seg.unicode && unicodeRatePerPart != null && unicodeRatePerPart > 0
      ? unicodeRatePerPart
      : ratePerPart;
  // Round to 4 dp — the cost column is NUMERIC(8,4).
  return Math.round(seg.segments * rate * 10000) / 10000;
}
