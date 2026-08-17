import { ADMIN_MENU, type AdminMenuItem } from "./admin-menu";

/**
 * Resolve the permission an admin route requires, by matching the pathname
 * against ADMIN_MENU — the same declarations that gate the sidebar.
 *
 * The menu already knows what every area needs, so route gating does not
 * introduce a second source of truth that could drift from the first.
 *
 * Matching is **longest-prefix**: `/admin/exams/types` must resolve to the
 * `/admin/exams` entry rather than to `/admin`, and `/admin` itself must only
 * ever match exactly, or it would swallow every route below it.
 */
export function resolveRoutePermission(
  pathname: string,
  menu: AdminMenuItem[] = ADMIN_MENU,
): AdminMenuItem | undefined {
  let best: AdminMenuItem | undefined;

  for (const item of menu) {
    const matches =
      item.href === "/admin"
        ? pathname === "/admin"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!matches) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }

  return best;
}

/**
 * Whether the held permission set satisfies a menu item's declaration.
 * Mirrors <Can>: `permission` is AND, `anyOf` is OR, both must pass, and an
 * item declaring neither is open to any authenticated user.
 */
export function satisfiesMenuItem(
  item: AdminMenuItem | undefined,
  check: { can: (...codes: string[]) => boolean; canAny: (...codes: string[]) => boolean },
): boolean {
  if (!item) return true;

  const required =
    item.permission === undefined
      ? []
      : Array.isArray(item.permission)
        ? item.permission
        : [item.permission];

  const allPass = required.length === 0 || check.can(...required);
  const anyPass =
    item.anyOf === undefined || item.anyOf.length === 0 || check.canAny(...item.anyOf);

  return allPass && anyPass;
}
