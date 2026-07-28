import { excerptFrom, htmlToText, sanitizeHtml } from './html-sanitize.util';

describe('html-sanitize.util', () => {
  describe('sanitizeHtml', () => {
    it('keeps ordinary formatting markup', () => {
      const html =
        '<h2>Our History</h2><p>Founded in <strong>1972</strong>.</p><ul><li>One</li></ul>';
      expect(sanitizeHtml(html)).toBe(html);
    });

    it('drops a script tag together with its body', () => {
      expect(
        sanitizeHtml('<p>Hi</p><script>alert(document.cookie)</script>'),
      ).toBe('<p>Hi</p>');
    });

    it('drops style, iframe and form elements whole', () => {
      expect(
        sanitizeHtml(
          '<style>body{display:none}</style><iframe src="http://evil"></iframe><form><input name="pw"></form><p>ok</p>',
        ),
      ).toBe('<p>ok</p>');
    });

    it('unwraps an unknown tag but keeps its text', () => {
      expect(sanitizeHtml('<marquee>Notice</marquee>')).toBe('Notice');
    });

    it('strips event handlers and inline styles', () => {
      expect(
        sanitizeHtml('<p onclick="steal()" style="color:red">Text</p>'),
      ).toBe('<p>Text</p>');
    });

    it('refuses a javascript: URL but keeps the link text', () => {
      expect(sanitizeHtml('<a href="javascript:alert(1)">Click</a>')).toBe(
        '<a>Click</a>',
      );
    });

    it('refuses a data: image source', () => {
      expect(
        sanitizeHtml(
          '<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x" />',
        ),
      ).toBe('<img alt="x" />');
    });

    it('keeps http, https, mailto, tel, anchor and root-relative URLs', () => {
      for (const href of [
        'https://school.edu.bd',
        'http://school.edu.bd',
        '/downloads',
        'mailto:office@school.edu.bd',
        'tel:+8801711111111',
        '#section',
      ]) {
        expect(sanitizeHtml(`<a href="${href}">x</a>`)).toContain(
          `href="${href}"`,
        );
      }
    });

    it('adds rel=noopener to a link that opens a new tab', () => {
      expect(
        sanitizeHtml('<a href="https://x.com" target="_blank">x</a>'),
      ).toBe(
        '<a href="https://x.com" target="_blank" rel="noopener noreferrer">x</a>',
      );
    });

    it('balances unclosed tags', () => {
      expect(sanitizeHtml('<p>One<p>Two')).toBe('<p>One</p><p>Two</p>');
      expect(sanitizeHtml('<ul><li>a<li>b</ul>')).toBe(
        '<ul><li>a</li><li>b</li></ul>',
      );
      expect(sanitizeHtml('<p>Intro<h2>Head</h2>')).toBe(
        '<p>Intro</p><h2>Head</h2>',
      );
    });

    it('closes inner tags left open when an outer tag closes', () => {
      expect(sanitizeHtml('<p><strong>bold</p>')).toBe(
        '<p><strong>bold</strong></p>',
      );
    });

    it('ignores a stray closing tag', () => {
      expect(sanitizeHtml('Hello</p>')).toBe('Hello');
    });

    it('escapes bare angle brackets in text', () => {
      expect(sanitizeHtml('5 < 7 and 9 > 2')).toBe('5 &lt; 7 and 9 &gt; 2');
    });

    it('strips HTML comments (they can hide conditional markup)', () => {
      expect(
        sanitizeHtml('<p>a</p><!--[if IE]><script>x</script><![endif]-->'),
      ).toBe('<p>a</p>');
    });

    it('is idempotent — sanitizing twice changes nothing', () => {
      const dirty =
        '<p onclick="x">Hello <a href="javascript:1" target="_blank">link</a></p><script>y</script>';
      const once = sanitizeHtml(dirty);
      expect(sanitizeHtml(once)).toBe(once);
    });

    it('returns empty for null/undefined/empty input', () => {
      expect(sanitizeHtml(null)).toBe('');
      expect(sanitizeHtml(undefined)).toBe('');
      expect(sanitizeHtml('')).toBe('');
    });

    it('keeps Bangla text intact', () => {
      expect(sanitizeHtml('<p>আমাদের বিদ্যালয়</p>')).toBe(
        '<p>আমাদের বিদ্যালয়</p>',
      );
    });
  });

  describe('htmlToText', () => {
    it('flattens markup and decodes the common entities', () => {
      expect(htmlToText('<p>Rock &amp; Roll</p><p>Second</p>')).toBe(
        'Rock & Roll Second',
      );
    });

    it('drops script bodies rather than reading them as text', () => {
      expect(htmlToText('<p>a</p><script>var x = 1;</script>')).toBe('a');
    });
  });

  describe('excerptFrom', () => {
    it('returns the whole text when it is short', () => {
      expect(excerptFrom('<p>Short note</p>', 200)).toBe('Short note');
    });

    it('cuts on a word boundary and ellipsizes', () => {
      const text = `<p>${'alpha '.repeat(40)}</p>`;
      const excerpt = excerptFrom(text, 50);
      expect(excerpt.length).toBeLessThanOrEqual(51);
      expect(excerpt.endsWith('…')).toBe(true);
      expect(excerpt).not.toMatch(/ …$/);
    });
  });
});
