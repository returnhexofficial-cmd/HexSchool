import { randomInt } from 'crypto';
import { StaffDesignation } from '../../common/constants';

const LOWER = 'abcdefghjkmnpqrstuvwxyz'; // ambiguous i/l/o removed
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGIT = '23456789';

/**
 * Random temporary password that satisfies the M02 policy (≥8, upper,
 * lower, digit). Delivered once via SMS/email; `must_change_password`
 * forces rotation on first login.
 */
export function generateTempPassword(length = 10): string {
  const all = LOWER + UPPER + DIGIT;
  const chars = [
    UPPER[randomInt(UPPER.length)],
    LOWER[randomInt(LOWER.length)],
    DIGIT[randomInt(DIGIT.length)],
  ];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  // Fisher–Yates so the guaranteed classes aren't always up front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * Default system role granted with the new account (keeps the ≥1-role
 * invariant from day one). Admins refine assignments in the role UI.
 */
export function defaultRoleSlugFor(designation: StaffDesignation): string {
  switch (designation) {
    case StaffDesignation.PRINCIPAL:
      return 'principal';
    case StaffDesignation.VICE_PRINCIPAL:
      return 'vice-principal';
    case StaffDesignation.ACCOUNTANT:
      return 'accountant';
    case StaffDesignation.ADMISSION_OFFICER:
      return 'admission-officer';
    case StaffDesignation.LIBRARIAN:
      return 'librarian';
    default:
      return 'office-staff';
  }
}
