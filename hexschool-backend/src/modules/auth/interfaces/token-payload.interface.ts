import { UserType } from '../../../common/constants';

/** Access-token JWT claims. Permissions are NOT embedded (PROJECT_CONTEXT §16). */
export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  schoolId: string;
  userType: UserType;
}

/** Short-lived token minted by verify-otp, consumed by reset-password. */
export interface ResetTokenPayload {
  sub: string;
  purpose: 'PASSWORD_RESET';
}
