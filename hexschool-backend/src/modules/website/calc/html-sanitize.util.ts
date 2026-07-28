/**
 * Allow-list HTML sanitizer for author-supplied website content
 * (roadmap M19 §7 "upload types whitelisted" — the same instinct applied
 * to markup). Dependency-free and golden-tested.
 *
 * Why sanitize content an *admin* wrote: the public site renders this
 * markup into every visitor's browser without a session, so a compromised
 * or careless CMS account would otherwise become stored XSS against the
 * whole internet. Sanitizing on WRITE (not on render) means the stored
 * row is already safe — every reader, including a future mobile client or
 * an RSS consumer, benefits without repeating the check.
 *
 * The rule is an allow-list, never a blocklist: unknown tags are unwrapped
 * (their text survives), `<script>`/`<style>`/`<iframe>` bodies are
 * dropped whole, and only vetted attributes with vetted URL schemes stay.
 */

/** Tags whose markup is kept. */
const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'sup',
  'sub',
  'blockquote',
  'pre',
  'code',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'div',
  'span',
]);

/** Tags whose *content* is discarded along with the tag. */
const DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
]);

/** Void elements that must not be given a closing tag. */
const VOID_TAGS: ReadonlySet<string> = new Set(['br', 'hr', 'img']);

/**
 * HTML's optional end tags. An author who writes `<p>One<p>Two` means two
 * paragraphs, and a browser reads it that way — so the sanitizer must
 * too, or the balancer would nest them and the page would render wrong.
 * Each key lists the open elements it implicitly closes.
 */
const IMPLIED_CLOSE: Readonly<Record<string, ReadonlySet<string>>> = {
  p: new Set(['p']),
  li: new Set(['li']),
  tr: new Set(['tr', 'td', 'th']),
  td: new Set(['td', 'th']),
  th: new Set(['td', 'th']),
  h1: new Set(['p']),
  h2: new Set(['p']),
  h3: new Set(['p']),
  h4: new Set(['p']),
  h5: new Set(['p']),
  h6: new Set(['p']),
  ul: new Set(['p']),
  ol: new Set(['p']),
  blockquote: new Set(['p']),
  pre: new Set(['p']),
  table: new Set(['p']),
  hr: new Set(['p']),
};

/** Attributes kept, per tag (`*` applies to every allowed tag). */
const ALLOWED_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
  '*': new Set(['title']),
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
};

/** URL schemes an `href`/`src` may use. */
const SAFE_URL = /^(?:https?:\/\/|\/|mailto:|tel:|#)/i;

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
const ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function escapeText(text: string): string {
  return text
    .replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function allowedAttrsFor(tag: string): ReadonlySet<string> {
  const specific = ALLOWED_ATTRS[tag];
  const shared = ALLOWED_ATTRS['*'];
  if (!specific) return shared;
  return new Set([...shared, ...specific]);
}

function sanitizeAttributes(tag: string, raw: string): string {
  const allowed = allowedAttrsFor(tag);
  const parts: string[] = [];
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    if (!allowed.has(name)) continue;
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if ((name === 'href' || name === 'src') && !SAFE_URL.test(value)) continue;
    parts.push(`${name}="${escapeAttr(value)}"`);
  }
  // A link that opens a new tab without rel=noopener hands the opener
  // window to the target page — added rather than rejected.
  if (tag === 'a' && parts.some((p) => p.startsWith('target='))) {
    if (!parts.some((p) => p.startsWith('rel='))) {
      parts.push('rel="noopener noreferrer"');
    }
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Returns the safe rendering of `html`. Text is preserved, disallowed
 * markup is removed; the output is idempotent (sanitizing twice changes
 * nothing), which matters because an edit round-trips through the editor.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';

  // Comments can hide conditional markup (`<!--[if IE]><script…`).
  let input = html.replace(/<!--[\s\S]*?-->/g, '');

  // Drop dangerous elements together with everything inside them.
  for (const tag of DROP_WITH_CONTENT) {
    const withBody = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    input = input.replace(withBody, '');
    const selfClosing = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    input = input.replace(selfClosing, '');
  }

  const out: string[] = [];
  const open: string[] = [];
  let cursor = 0;
  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(input)) !== null) {
    out.push(escapeText(input.slice(cursor, match.index)));
    cursor = match.index + match[0].length;

    const tag = match[1].toLowerCase();
    const isClosing = match[0].startsWith('</');
    if (!ALLOWED_TAGS.has(tag)) continue; // unwrap: keep the text, drop the tag

    if (isClosing) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue; // stray close tag
      // Close anything left open inside it, innermost first.
      for (let i = open.length - 1; i >= at; i -= 1) {
        out.push(`</${open[i]}>`);
      }
      open.splice(at);
      continue;
    }

    // Close whatever this tag implicitly ends (`<p>a<p>b` is two paras).
    const implied = IMPLIED_CLOSE[tag];
    while (implied && open.length > 0 && implied.has(open[open.length - 1])) {
      out.push(`</${open.pop() as string}>`);
    }

    if (VOID_TAGS.has(tag)) {
      out.push(`<${tag}${sanitizeAttributes(tag, match[2] ?? '')} />`);
      continue;
    }
    out.push(`<${tag}${sanitizeAttributes(tag, match[2] ?? '')}>`);
    open.push(tag);
  }
  out.push(escapeText(input.slice(cursor)));

  // Balance whatever the author left open.
  for (let i = open.length - 1; i >= 0; i -= 1) out.push(`</${open[i]}>`);

  return out.join('').trim();
}

/**
 * Plain-text rendering of markup — used for meta descriptions, RSS
 * excerpts and the search index, where tags are noise.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** First `limit` characters of the plain text, cut on a word boundary. */
export function excerptFrom(
  html: string | null | undefined,
  limit = 200,
): string {
  const text = htmlToText(html);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
