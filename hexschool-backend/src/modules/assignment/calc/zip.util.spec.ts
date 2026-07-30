import {
  buildZip,
  crc32,
  dedupeEntryNames,
  dosDateTime,
  safeEntryName,
} from './zip.util';

describe('crc32', () => {
  // Golden values from the IEEE 802.3 reference implementation.
  it('matches the reference CRC for known inputs', () => {
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('a'))).toBe(0xe8b7be43);
    expect(crc32(Buffer.from('abc'))).toBe(0x352441c2);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(
      crc32(Buffer.from('The quick brown fox jumps over the lazy dog')),
    ).toBe(0x414fa339);
  });

  it('handles bytes above 0x7f', () => {
    expect(crc32(Buffer.from([0xff, 0x00, 0xff]))).toBe(
      crc32(Buffer.from([0xff, 0x00, 0xff])),
    );
    expect(crc32(Buffer.from([0xff]))).not.toBe(crc32(Buffer.from([0xfe])));
  });
});

describe('dosDateTime', () => {
  it('encodes a date into the MS-DOS pair', () => {
    const { time, date } = dosDateTime(new Date(2026, 6, 30, 14, 35, 20));
    expect(date).toBe(((2026 - 1980) << 9) | (7 << 5) | 30);
    expect(time).toBe((14 << 11) | (35 << 5) | 10);
  });

  it('loses the odd second — a ZIP stores two-second resolution', () => {
    const odd = dosDateTime(new Date(2026, 0, 1, 0, 0, 21));
    const even = dosDateTime(new Date(2026, 0, 1, 0, 0, 20));
    expect(odd.time).toBe(even.time);
  });

  it('clamps a pre-1980 date instead of writing a negative year', () => {
    expect(dosDateTime(new Date(1970, 0, 1))).toEqual({
      time: 0,
      date: (1 << 5) | 1,
    });
  });
});

describe('safeEntryName', () => {
  it('leaves an ordinary name alone', () => {
    expect(safeEntryName('Rahim Uddin/essay.pdf')).toBe(
      'Rahim Uddin/essay.pdf',
    );
  });

  it('strips traversal segments — the zip-slip vector', () => {
    expect(safeEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(safeEntryName('a/../../b.txt')).toBe('a/b.txt');
  });

  it('strips an absolute path and a drive letter', () => {
    expect(safeEntryName('/etc/passwd')).toBe('etc/passwd');
    expect(safeEntryName('C:\\Windows\\evil.dll')).toBe('Windows/evil.dll');
  });

  it('replaces characters Windows cannot open', () => {
    expect(safeEntryName('re:port?.pdf')).toBe('re_port_.pdf');
  });

  it('never returns an empty name', () => {
    expect(safeEntryName('../..')).toBe('file');
    expect(safeEntryName('')).toBe('file');
  });

  it('keeps Bangla characters', () => {
    expect(safeEntryName('বাংলা.pdf')).toBe('বাংলা.pdf');
  });
});

describe('dedupeEntryNames', () => {
  it('suffixes repeats before the extension', () => {
    expect(dedupeEntryNames(['a.pdf', 'a.pdf', 'a.pdf'])).toEqual([
      'a.pdf',
      'a (2).pdf',
      'a (3).pdf',
    ]);
  });

  it('compares case-insensitively, because Windows does', () => {
    expect(dedupeEntryNames(['A.pdf', 'a.pdf'])).toEqual([
      'A.pdf',
      'a (2).pdf',
    ]);
  });

  it('keeps same-named files in different folders apart', () => {
    expect(dedupeEntryNames(['x/a.pdf', 'y/a.pdf'])).toEqual([
      'x/a.pdf',
      'y/a.pdf',
    ]);
  });

  it('suffixes an extensionless name at the end', () => {
    expect(dedupeEntryNames(['notes', 'notes'])).toEqual([
      'notes',
      'notes (2)',
    ]);
  });
});

describe('buildZip', () => {
  const readEocd = (zip: Buffer) => {
    const at = zip.length - 22;
    return {
      signature: zip.readUInt32LE(at),
      entries: zip.readUInt16LE(at + 10),
      centralSize: zip.readUInt32LE(at + 12),
      centralOffset: zip.readUInt32LE(at + 16),
    };
  };

  it('writes a well-formed empty archive', () => {
    const zip = buildZip([]);
    expect(zip).toHaveLength(22);
    expect(readEocd(zip)).toMatchObject({
      signature: 0x06054b50,
      entries: 0,
      centralSize: 0,
      centralOffset: 0,
    });
  });

  it('writes local header, payload and central directory in order', () => {
    const data = Buffer.from('hello');
    const zip = buildZip([
      { name: 'a.txt', data, date: new Date(2026, 6, 30, 12, 0, 0) },
    ]);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local header
    expect(zip.readUInt16LE(8)).toBe(0); // stored, not deflated
    expect(zip.readUInt32LE(14)).toBe(crc32(data));
    expect(zip.readUInt32LE(18)).toBe(data.length);
    expect(zip.readUInt32LE(22)).toBe(data.length);
    expect(zip.subarray(30, 35).toString()).toBe('a.txt');
    expect(zip.subarray(35, 40).toString()).toBe('hello');

    const eocd = readEocd(zip);
    expect(eocd.entries).toBe(1);
    expect(eocd.centralOffset).toBe(40); // 30 header + 5 name + 5 payload
    expect(zip.readUInt32LE(eocd.centralOffset)).toBe(0x02014b50);
  });

  it('sets the UTF-8 name flag so a Bangla filename survives', () => {
    const zip = buildZip([{ name: 'বাংলা.txt', data: Buffer.from('x') }]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString('utf8')).toBe(
      'বাংলা.txt',
    );
  });

  it('records each entry offset so the central directory points at the right header', () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('one') },
      { name: 'b.txt', data: Buffer.from('two!') },
    ]);
    const eocd = readEocd(zip);
    expect(eocd.entries).toBe(2);

    const firstOffset = zip.readUInt32LE(eocd.centralOffset + 42);
    const secondOffset = zip.readUInt32LE(eocd.centralOffset + 46 + 5 + 42);
    expect(firstOffset).toBe(0);
    expect(secondOffset).toBe(30 + 5 + 3);
    expect(zip.readUInt32LE(secondOffset)).toBe(0x04034b50);
  });

  it('sanitizes and de-duplicates the names it is given', () => {
    const zip = buildZip([
      { name: '../a.txt', data: Buffer.from('1') },
      { name: 'a.txt', data: Buffer.from('2') },
    ]);
    expect(zip.subarray(30, 35).toString()).toBe('a.txt');
    const second = 30 + 5 + 1;
    const nameLength = zip.readUInt16LE(second + 26);
    expect(zip.subarray(second + 30, second + 30 + nameLength).toString()).toBe(
      'a (2).txt',
    );
  });

  it('leaves binary payloads byte-identical', () => {
    const data = Buffer.from([0x00, 0xff, 0x1a, 0x50, 0x4b]);
    const zip = buildZip([{ name: 'b.bin', data }]);
    expect(zip.subarray(35, 40)).toEqual(data);
  });
});
