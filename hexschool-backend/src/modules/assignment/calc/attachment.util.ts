/**
 * Module 22 — what a student and a teacher are allowed to attach, and
 * what a learning material's external link may point at (roadmap §4
 * "≤ 10 MB × 3, pdf/doc/img" and §7 "VIDEO_URL/LINK must be valid https
 * URLs (YouTube/Drive whitelist setting)").
 *
 * Dependency-free: the limits arrive as arguments from the
 * `assignment.*` settings, so the same functions serve the upload
 * endpoint, the submit endpoint and the frontend mirror.
 */

export interface AttachmentRef {
  /** S3 object key — never a URL, which is signed on read (M04 rule). */
  key: string;
  name: string;
  size: number;
  contentType: string;
}

export interface AttachmentLimits {
  maxCount: number;
  maxBytes: number;
  /** Lower-case extensions without the dot: `['pdf', 'jpg', …]`. */
  allowedTypes: string[];
}

/** `Report FINAL.v2.PDF` → `pdf`; `noext` → `''`. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Validates one file against the school's limits. Returns the problems
 * rather than throwing, so an upload of several reports all of them.
 */
export function fileIssues(
  file: { name: string; size: number },
  limits: AttachmentLimits,
): string[] {
  const issues: string[] = [];
  const ext = extensionOf(file.name);

  if (!ext) {
    issues.push(`"${file.name}" has no file extension`);
  } else if (!limits.allowedTypes.includes(ext)) {
    issues.push(
      `"${file.name}" is a .${ext} file — allowed: ${limits.allowedTypes.join(', ')}`,
    );
  }
  if (file.size <= 0) {
    issues.push(`"${file.name}" is empty`);
  } else if (file.size > limits.maxBytes) {
    issues.push(
      `"${file.name}" is ${humanBytes(file.size)} — the limit is ${humanBytes(limits.maxBytes)}`,
    );
  }
  return issues;
}

/** Validates the whole set a submission or an assignment carries. */
export function attachmentSetIssues(
  files: ReadonlyArray<{ name: string; size: number }>,
  limits: AttachmentLimits,
): string[] {
  const issues: string[] = [];
  if (files.length > limits.maxCount) {
    issues.push(
      `At most ${limits.maxCount} file${limits.maxCount === 1 ? '' : 's'} may be attached (got ${files.length})`,
    );
  }
  for (const file of files) issues.push(...fileIssues(file, limits));
  return issues;
}

// ── external links ────────────────────────────────────────────────────

/**
 * An https URL whose host is on the school's allow-list, matched on the
 * registrable suffix so `www.youtube.com` and `m.youtube.com` both pass
 * a `youtube.com` entry while `youtube.com.evil.test` does not — the
 * suffix has to start at a label boundary.
 *
 * An EMPTY allow-list means "any https host", which is the honest reading
 * of an unconfigured setting: a school that has not restricted anything
 * has not asked us to refuse anything. The `https` requirement is not
 * negotiable either way and is also a DB CHECK.
 */
export function linkIssues(
  url: string | null | undefined,
  allowedHosts: ReadonlyArray<string>,
): string[] {
  if (!url || url.trim().length === 0) return ['A link is required'];

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return [`"${url}" is not a valid URL`];
  }

  if (parsed.protocol !== 'https:') {
    return ['Links must use https'];
  }
  if (allowedHosts.length === 0) return [];

  const host = parsed.hostname.toLowerCase();
  const allowed = allowedHosts.some((raw) => {
    const entry = raw.trim().toLowerCase().replace(/^\*\./, '');
    if (!entry) return false;
    return host === entry || host.endsWith(`.${entry}`);
  });

  return allowed
    ? []
    : [
        `${parsed.hostname} is not an allowed link host (allowed: ${allowedHosts.join(', ')})`,
      ];
}
