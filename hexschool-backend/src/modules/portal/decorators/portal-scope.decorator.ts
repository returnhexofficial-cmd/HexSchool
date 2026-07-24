import { SetMetadata } from '@nestjs/common';

export const OWNS_STUDENT_KEY = 'ownsStudent';

/**
 * Marks a portal route whose `:param` (or `?query`) names a student the
 * caller must own — the `OwnershipGuard` reads this key and 403s an IDOR
 * attempt (roadmap M18 §7 "ownership guard on every :id the portal
 * touches"). Default source is the `childId` route param.
 */
export const OwnsStudent = (key = 'childId') =>
  SetMetadata(OWNS_STUDENT_KEY, key);
