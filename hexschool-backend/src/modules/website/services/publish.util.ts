import { WebContentStatus } from '../../../common/constants';

/**
 * `published_at` is evidence, not decoration: the DB CHECK
 * (`chk_*_published_evidence`) refuses a PUBLISHED row without one, and
 * the feed sorts and the RSS `<pubDate>` read it. This is the single
 * place that decides what the column becomes on a status change, so no
 * write path can set a status by hand and leave the date behind — the
 * same "derived, never assigned" discipline M16 applies to invoice status.
 *
 * Publishing for the first time stamps now; re-publishing keeps the
 * original date (a correction is not a new announcement); moving back to
 * DRAFT keeps it too, so re-publishing an unchanged post does not jump it
 * back to the top of the feed.
 */
export function publishedAtFor(
  nextStatus: WebContentStatus | undefined,
  existing: Date | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (nextStatus !== WebContentStatus.PUBLISHED) return existing ?? null;
  return existing ?? now;
}
