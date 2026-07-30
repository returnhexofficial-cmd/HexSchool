import {
  attachmentSetIssues,
  extensionOf,
  fileIssues,
  humanBytes,
  linkIssues,
  type AttachmentLimits,
} from './attachment.util';

const MB = 1024 * 1024;
const limits: AttachmentLimits = {
  maxCount: 3,
  maxBytes: 10 * MB,
  allowedTypes: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'],
};

describe('extensionOf', () => {
  it('takes the last extension and lower-cases it', () => {
    expect(extensionOf('Report FINAL.v2.PDF')).toBe('pdf');
  });

  it('returns empty for a name with no extension', () => {
    expect(extensionOf('homework')).toBe('');
  });

  it('returns empty for a trailing dot', () => {
    expect(extensionOf('homework.')).toBe('');
  });

  it('does not treat a dotfile as an extension-only name', () => {
    expect(extensionOf('.gitignore')).toBe('gitignore');
  });
});

describe('humanBytes', () => {
  it('scales the unit', () => {
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(2048)).toBe('2 KB');
    expect(humanBytes(10 * MB)).toBe('10 MB');
  });
});

describe('fileIssues', () => {
  it('accepts an allowed type inside the size limit', () => {
    expect(fileIssues({ name: 'essay.pdf', size: 2 * MB }, limits)).toEqual([]);
  });

  it('refuses a disallowed type and names the allowed ones', () => {
    const issues = fileIssues({ name: 'payload.exe', size: 100 }, limits);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('pdf');
  });

  it('refuses a file with no extension at all', () => {
    expect(fileIssues({ name: 'homework', size: 100 }, limits)).toHaveLength(1);
  });

  it('refuses an over-size file and says both figures', () => {
    const issues = fileIssues({ name: 'video.png', size: 11 * MB }, limits);
    expect(issues[0]).toContain('11 MB');
    expect(issues[0]).toContain('10 MB');
  });

  it('accepts a file of exactly the limit', () => {
    expect(fileIssues({ name: 'scan.jpg', size: 10 * MB }, limits)).toEqual([]);
  });

  it('refuses an empty file', () => {
    expect(fileIssues({ name: 'blank.pdf', size: 0 }, limits)).toHaveLength(1);
  });

  it('reports both problems at once', () => {
    expect(
      fileIssues({ name: 'huge.exe', size: 50 * MB }, limits),
    ).toHaveLength(2);
  });
});

describe('attachmentSetIssues', () => {
  it('accepts a set at the count limit', () => {
    expect(
      attachmentSetIssues(
        [
          { name: 'a.pdf', size: 1 },
          { name: 'b.pdf', size: 1 },
          { name: 'c.pdf', size: 1 },
        ],
        limits,
      ),
    ).toEqual([]);
  });

  it('refuses one file too many and still validates each file', () => {
    const issues = attachmentSetIssues(
      [
        { name: 'a.pdf', size: 1 },
        { name: 'b.pdf', size: 1 },
        { name: 'c.pdf', size: 1 },
        { name: 'd.exe', size: 1 },
      ],
      limits,
    );
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('At most 3');
  });

  it('accepts an empty set — a text-only answer is a valid submission', () => {
    expect(attachmentSetIssues([], limits)).toEqual([]);
  });
});

describe('linkIssues', () => {
  const hosts = ['youtube.com', 'youtu.be', 'drive.google.com'];

  it('accepts an allow-listed host', () => {
    expect(linkIssues('https://youtube.com/watch?v=x', hosts)).toEqual([]);
  });

  it('accepts a subdomain of an allow-listed host', () => {
    expect(linkIssues('https://www.youtube.com/watch?v=x', hosts)).toEqual([]);
    expect(linkIssues('https://m.youtube.com/watch?v=x', hosts)).toEqual([]);
  });

  it('refuses a look-alike host that merely CONTAINS an allowed one', () => {
    // `youtube.com.evil.test` ends with neither `youtube.com` nor
    // `.youtube.com`, which is exactly why the match is anchored at a
    // label boundary rather than done with `includes`.
    expect(linkIssues('https://youtube.com.evil.test/x', hosts)).toHaveLength(
      1,
    );
    expect(linkIssues('https://notyoutube.com/x', hosts)).toHaveLength(1);
  });

  it('refuses http, always', () => {
    expect(linkIssues('http://youtube.com/x', hosts)).toEqual([
      'Links must use https',
    ]);
  });

  it('refuses a javascript: URL even when the allow-list is empty', () => {
    expect(linkIssues('javascript:alert(1)', [])).toEqual([
      'Links must use https',
    ]);
  });

  it('treats an EMPTY allow-list as "any https host"', () => {
    // A school that has not restricted anything has not asked us to
    // refuse anything.
    expect(linkIssues('https://example.test/notes', [])).toEqual([]);
  });

  it('refuses a missing or unparseable link', () => {
    expect(linkIssues(null, hosts)).toHaveLength(1);
    expect(linkIssues('   ', hosts)).toHaveLength(1);
    expect(linkIssues('not a url', hosts)).toHaveLength(1);
  });

  it('ignores case and surrounding whitespace on both sides', () => {
    expect(
      linkIssues('  https://WWW.YouTube.com/x  ', ['YouTube.com ']),
    ).toEqual([]);
  });

  it('accepts a `*.` prefixed allow-list entry', () => {
    expect(
      linkIssues('https://cdn.example.test/a', ['*.example.test']),
    ).toEqual([]);
  });
});
