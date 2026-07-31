import {
  encodableCode128,
  encodeCode128B,
  normalizeScannedCode,
} from './barcode.util';

describe('encodeCode128B', () => {
  /**
   * The check symbol is `(startValue + Σ valueᵢ × i) mod 103` over the
   * data characters, 1-indexed. These expectations are worked from that
   * rule by hand rather than read off the implementation — a checksum
   * test whose expected value came from the code under test proves only
   * that the code is consistent with itself.
   *
   * `PJJ123C`: Start B 104 + P(48)×1 + J(42)×2 + J(42)×3 + 1(17)×4 +
   * 2(18)×5 + 3(19)×6 + C(35)×7
   *   = 104 + 48 + 84 + 126 + 68 + 90 + 114 + 245 = 879, and
   *     879 − 8×103 = 55.
   *
   * If the character-value mapping (ASCII − 32) or the position
   * weighting is wrong, this is the number that moves.
   */
  it('computes the check symbol for PJJ123C', () => {
    expect(encodeCode128B('PJJ123C').checksum).toBe(55);
  });

  it('computes the check symbol for a plain accession number', () => {
    // `ACC-001`: 104 + A(33)×1 + C(35)×2 + C(35)×3 + -(13)×4 + 0(16)×5
    //   + 0(16)×6 + 1(17)×7
    //   = 104 + 33 + 70 + 105 + 52 + 80 + 96 + 119 = 659, and
    //     659 − 6×103 = 41.
    expect(encodeCode128B('ACC-001').checksum).toBe(41);
  });

  it('starts with the Start-B pattern and ends with the stop pattern', () => {
    const symbol = encodeCode128B('A', 0);
    // Start B = pattern "211214": bar 2, space 1, bar 1, space 2, bar 1,
    // space 4 — so bars at module 0 (2 wide), 3 (1 wide) and 6 (1 wide).
    expect(symbol.bars.slice(0, 3)).toEqual([
      { x: 0, width: 2 },
      { x: 3, width: 1 },
      { x: 6, width: 1 },
    ]);
    // Stop = "2331112" — 13 modules, four bars, and the symbol ends on a
    // bar rather than a space (the only pattern in the table that does).
    const last = symbol.bars.at(-1)!;
    expect(last.x + last.width).toBe(symbol.modules);
  });

  it('lays every symbol out as 11 modules, plus 13 for the stop', () => {
    const value = 'ACC-26-00001';
    const symbol = encodeCode128B(value, 10);
    // Start + data + checksum = value.length + 2 symbols of 11 modules,
    // then the 13-module stop, plus a quiet zone on each side.
    const expected = (value.length + 2) * 11 + 13 + 20;
    expect(symbol.modules).toBe(expected);
  });

  it('honours a custom quiet zone', () => {
    expect(encodeCode128B('A', 0).bars[0].x).toBe(0);
    expect(encodeCode128B('A', 10).bars[0].x).toBe(10);
  });

  it('produces only 1–4 module bars', () => {
    for (const bar of encodeCode128B('The Quick Brown Fox 0123456789').bars) {
      expect(bar.width).toBeGreaterThanOrEqual(1);
      expect(bar.width).toBeLessThanOrEqual(4);
    }
  });

  it('refuses characters Code 128-B cannot carry', () => {
    expect(() => encodeCode128B('')).toThrow(/cannot be encoded/);
    expect(() => encodeCode128B('বই-০০১')).toThrow(/cannot be encoded/);
    // A control character — what a mis-configured scanner prefix looks
    // like once it reaches the encoder.
    expect(() => encodeCode128B('ACC\x01')).toThrow(/cannot be encoded/);
  });

  it('accepts the printable ASCII boundaries', () => {
    expect(encodableCode128(' ')).toBe(true);
    expect(encodableCode128('~')).toBe(true);
    expect(encodableCode128('')).toBe(false);
  });
});

describe('normalizeScannedCode', () => {
  /**
   * Roadmap §8. A USB barcode scanner is a keyboard, and different
   * models append Enter, a carriage return, or a tab; some pick up
   * leading whitespace from the label's quiet zone. A desk lookup that
   * fails on an invisible character is the most confusing failure a
   * circulation desk can have, so the server strips them too rather than
   * trusting the page to have done it.
   */
  it.each([
    ['ACC-001\n', 'ACC-001'],
    ['ACC-001\r\n', 'ACC-001'],
    ['ACC-001\t', 'ACC-001'],
    ['  ACC-001  ', 'ACC-001'],
    ['acc-001', 'ACC-001'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizeScannedCode(raw)).toBe(expected);
  });

  it('leaves an already-clean code alone', () => {
    expect(normalizeScannedCode('ACC-26-00042')).toBe('ACC-26-00042');
  });
});
