/**
 * Handlebars-lite template rendering (roadmap M17 §3 "handlebars vars
 * `{{student_name}}`", §7 "template variables validated against per-code
 * allowed set"). Dependency-free — a full handlebars engine would pull in
 * partials/helpers/HTML-escaping we neither need nor want in an SMS body.
 *
 * Only `{{ name }}` substitution is supported. An unknown variable renders
 * as the empty string (a message must still send), but authoring-time
 * validation flags it so the template manager can warn before saving.
 */

const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Every distinct variable referenced by a body, in first-seen order. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  VAR_PATTERN.lastIndex = 0;
  while ((match = VAR_PATTERN.exec(body)) !== null) seen.add(match[1]);
  return [...seen];
}

/**
 * Render a body against a variable bag. Missing/undefined values become
 * '' so a half-filled bag never prints `{{gpa}}` to a parent. Values are
 * coerced with String() — numbers and booleans are fine in a message.
 */
export function renderTemplate(
  body: string,
  vars: Record<string, unknown> = {},
): string {
  return body.replace(VAR_PATTERN, (_, name: string) => coerce(vars[name]));
}

/** Scalar coercion for a template variable; objects/arrays render empty. */
function coerce(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return '';
}

export interface TemplateValidation {
  ok: boolean;
  /** Variables used in the body that are not in the allowed set. */
  unknown: string[];
  /** Allowed variables the body never uses (informational, not an error). */
  unused: string[];
}

/**
 * Validate a body's variables against a per-code allow-list. `unknown` is
 * the blocking problem (a typo'd `{{studnet_name}}` would always be
 * blank); `unused` is advisory.
 */
export function validateTemplate(
  body: string,
  allowed: readonly string[],
): TemplateValidation {
  const used = extractVariables(body);
  const allowedSet = new Set(allowed);
  const unknown = used.filter((v) => !allowedSet.has(v));
  const usedSet = new Set(used);
  const unused = allowed.filter((v) => !usedSet.has(v));
  return { ok: unknown.length === 0, unknown, unused };
}
