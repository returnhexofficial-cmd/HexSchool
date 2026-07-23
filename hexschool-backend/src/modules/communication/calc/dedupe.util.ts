/**
 * Dedupe + recipient merge (roadmap M17 §8 "guardian with two children
 * absent same day → merge into single SMS … dedupe window by
 * destination+template"). Dependency-free.
 *
 * Two levers:
 *   - `dedupeKey` buckets (destination, template) into a window, so the
 *     partial unique `uq_notifications_dedupe` refuses a second identical
 *     send inside that window at the DB level.
 *   - `mergeByDestination` collapses a batch of sends aimed at the same
 *     number+template BEFORE they are queued, joining their variable bags
 *     so one SMS names both children.
 */

/**
 * Bucket key for the dedupe window. Two sends to the same destination for
 * the same template within the same `windowMinutes` bucket collide.
 * `epochMs` is normally Date.now(); a bucket boundary is the only place a
 * near-simultaneous duplicate could slip through, which is acceptable for
 * a cost guard (and the merge below covers the common same-request case).
 */
export function dedupeKey(
  destination: string,
  templateCode: string,
  windowMinutes: number,
  epochMs: number,
): string {
  const bucket =
    windowMinutes > 0
      ? Math.floor(epochMs / (windowMinutes * 60_000))
      : epochMs; // window 0 ⇒ never bucket together (effectively no dedupe)
  return `${destination}|${templateCode}|${bucket}`;
}

export interface MergeableSend<T> {
  destination: string;
  templateCode: string;
  vars: Record<string, unknown>;
  /** Caller payload carried through (e.g. recipient ids to flag). */
  ref: T;
}

export interface MergedSend<T> {
  destination: string;
  templateCode: string;
  vars: Record<string, unknown>;
  refs: T[];
  /** How many raw sends folded into this one. */
  count: number;
}

/**
 * Merge sends that share (destination, template). The first send's
 * variable bag wins for scalar keys; a `mergeVar` list is concatenated
 * comma-separated (e.g. `student_name` becomes "Karim, Rahim"). The order
 * of first appearance is preserved so output is deterministic.
 */
export function mergeByDestination<T>(
  sends: ReadonlyArray<MergeableSend<T>>,
  mergeVars: readonly string[] = [],
): MergedSend<T>[] {
  const groups = new Map<string, MergedSend<T>>();
  const mergeSet = new Set(mergeVars);

  for (const send of sends) {
    const key = `${send.destination}|${send.templateCode}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        destination: send.destination,
        templateCode: send.templateCode,
        vars: { ...send.vars },
        refs: [send.ref],
        count: 1,
      });
      continue;
    }
    existing.refs.push(send.ref);
    existing.count += 1;
    for (const varName of mergeSet) {
      const incoming = scalar(send.vars[varName]);
      if (incoming === '') continue;
      const current = scalar(existing.vars[varName]);
      existing.vars[varName] =
        current === '' ? incoming : `${current}, ${incoming}`;
    }
  }

  return [...groups.values()];
}

/** Scalar coercion; objects/arrays/nullish become the empty string. */
function scalar(value: unknown): string {
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
