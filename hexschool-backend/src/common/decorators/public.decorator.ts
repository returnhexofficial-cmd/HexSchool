import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as exempt from the global JwtAuthGuard. Per API convention
 * §7, `@Public()` routes are the explicit exception list — use sparingly.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
