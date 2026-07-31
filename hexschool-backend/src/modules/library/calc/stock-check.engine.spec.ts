import {
  diffStock,
  type ScanRecord,
  type ShelfCopy,
} from './stock-check.engine';

const copy = (over: Partial<ShelfCopy> & { id: string }): ShelfCopy => ({
  accessionNo: `ACC-${over.id}`,
  status: 'AVAILABLE',
  bookTitle: 'Physics',
  rackNo: 'A1',
  ...over,
});

const scan = (
  accessionNo: string,
  copyId: string | null = null,
): ScanRecord => ({
  accessionNo,
  copyId,
});

describe('diffStock', () => {
  it('verifies a shelf that was counted completely', () => {
    const copies = [copy({ id: '1' }), copy({ id: '2' })];
    const diff = diffStock(copies, [scan('ACC-1'), scan('ACC-2')]);

    expect(diff.expectedCount).toBe(2);
    expect(diff.scannedCount).toBe(2);
    expect(diff.verifiedCount).toBe(2);
    expect(diff.missing).toHaveLength(0);
    expect(diff.unexpected).toHaveLength(0);
  });

  it('reports an expected copy that was never scanned', () => {
    const copies = [copy({ id: '1' }), copy({ id: '2' })];
    const diff = diffStock(copies, [scan('ACC-1')]);

    expect(diff.missing.map((c) => c.id)).toEqual(['2']);
    expect(diff.verifiedCount).toBe(1);
  });

  /**
   * The rule the whole engine turns on: a book on loan is legitimately
   * not on the shelf. Counting it as missing would send a librarian
   * looking for a book that is on a student's desk — and would do it for
   * every book in circulation, which is most of the useful ones.
   */
  it('does not expect a copy that is on loan', () => {
    const copies = [copy({ id: '1', status: 'ISSUED' }), copy({ id: '2' })];
    const diff = diffStock(copies, [scan('ACC-2')]);

    expect(diff.expectedCount).toBe(1);
    expect(diff.missing).toHaveLength(0);
  });

  it.each(['LOST', 'DAMAGED', 'WITHDRAWN'] as const)(
    'does not expect a %s copy',
    (status) => {
      const diff = diffStock([copy({ id: '1', status })], []);
      expect(diff.expectedCount).toBe(0);
      expect(diff.missing).toHaveLength(0);
    },
  );

  it('expects a copy being held on the reserve shelf', () => {
    const diff = diffStock([copy({ id: '1', status: 'RESERVED' })], []);
    expect(diff.expectedCount).toBe(1);
    expect(diff.missing).toHaveLength(1);
  });

  describe('unexpected scans', () => {
    it('flags a scan of a copy the system thinks is on loan', () => {
      const copies = [copy({ id: '1', status: 'ISSUED' })];
      const diff = diffStock(copies, [scan('ACC-1')]);

      expect(diff.unexpected).toEqual([
        { accessionNo: 'ACC-1', copy: copies[0], reason: 'ON_LOAN' },
      ]);
    });

    it('flags a scan of a written-off copy', () => {
      const copies = [copy({ id: '1', status: 'LOST' })];
      const diff = diffStock(copies, [scan('ACC-1')]);
      expect(diff.unexpected[0].reason).toBe('OUT_OF_CIRCULATION');
    });

    it('flags a code that is in no catalogue at all', () => {
      const diff = diffStock(
        [copy({ id: '1' })],
        [scan('ACC-1'), scan('ACC-999')],
      );
      expect(diff.unexpected).toEqual([
        { accessionNo: 'ACC-999', copy: null, reason: 'UNKNOWN' },
      ]);
    });
  });

  /**
   * Scanning one shelf twice is what actually happens during a
   * stock-take. A count reporting 1,200 of 900 books is a count the
   * person running it throws away.
   */
  it('counts a copy scanned twice only once', () => {
    const copies = [copy({ id: '1' })];
    const diff = diffStock(copies, [
      scan('ACC-1'),
      scan('ACC-1'),
      scan('ACC-1'),
    ]);

    expect(diff.scannedCount).toBe(1);
    expect(diff.verifiedCount).toBe(1);
    expect(diff.unexpected).toHaveLength(0);
  });

  /** Roadmap §8's Enter suffix, arriving in a batch of scans. */
  it('matches a scan carrying scanner noise', () => {
    const copies = [copy({ id: '1', accessionNo: 'ACC-26-0001' })];
    const diff = diffStock(copies, [scan('  acc-26-0001\r\n')]);

    expect(diff.missing).toHaveLength(0);
    expect(diff.verifiedCount).toBe(1);
  });

  it('resolves a scan by copy id when one was recorded', () => {
    const copies = [copy({ id: '1', accessionNo: 'ACC-1' })];
    const diff = diffStock(copies, [scan('ACC-1', '1')]);
    expect(diff.verifiedCount).toBe(1);
  });

  describe('a rack-scoped count', () => {
    const copies = [
      copy({ id: '1', rackNo: 'A1' }),
      copy({ id: '2', rackNo: 'A1' }),
      copy({ id: '3', rackNo: 'B2' }),
    ];

    it('expects only the copies shelved in that rack', () => {
      const diff = diffStock(copies, [scan('ACC-1'), scan('ACC-2')], 'A1');
      expect(diff.expectedCount).toBe(2);
      expect(diff.missing).toHaveLength(0);
    });

    /**
     * A book from another rack found in this one is neither missing (it
     * was never expected here) nor unexpected (it exists and is
     * perfectly shelvable) — it is misplaced, which is its own finding
     * and the one a librarian can act on in thirty seconds.
     */
    it('reports an out-of-rack copy as misplaced, not as an error', () => {
      const diff = diffStock(
        copies,
        [scan('ACC-1'), scan('ACC-2'), scan('ACC-3')],
        'A1',
      );
      expect(diff.misplaced.map((c) => c.id)).toEqual(['3']);
      expect(diff.unexpected).toHaveLength(0);
      expect(diff.missing).toHaveLength(0);
    });

    it('matches the rack case- and whitespace-insensitively', () => {
      const diff = diffStock(
        [copy({ id: '1', rackNo: ' a1 ' })],
        [scan('ACC-1')],
        'A1',
      );
      expect(diff.expectedCount).toBe(1);
      expect(diff.misplaced).toHaveLength(0);
    });

    it('treats an empty rack filter as the whole library', () => {
      const diff = diffStock(copies, [scan('ACC-1')], '   ');
      expect(diff.expectedCount).toBe(3);
    });
  });
});
