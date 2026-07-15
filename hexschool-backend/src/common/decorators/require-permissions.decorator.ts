import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';
export const REQUIRE_ANY_PERMISSION_KEY = 'requireAnyPermission';

/**
 * AND semantics: the caller must hold EVERY listed permission code
 * (checked by the global PermissionsGuard; Super Admin bypasses).
 * Usable on a handler or a whole controller.
 */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, codes);

/** OR semantics: the caller must hold AT LEAST ONE listed code. */
export const RequireAnyPermission = (...codes: string[]) =>
  SetMetadata(REQUIRE_ANY_PERMISSION_KEY, codes);
