import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
} from "lucide-react";

/**
 * Admin sidebar config — each item declares the permission it needs
 * (global convention: menu items render inside <Can>). Later modules
 * append entries here (students, fees, exams, …).
 */
export interface AdminMenuItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** All listed codes required; omit for always-visible items. */
  permission?: string | string[];
  /** OR alternative to `permission`. */
  anyOf?: string[];
}

export const ADMIN_MENU: AdminMenuItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  {
    label: "Roles & Permissions",
    href: "/admin/roles",
    icon: ShieldCheck,
    permission: "role.view",
  },
  {
    label: "Audit Logs",
    href: "/admin/audit-logs",
    icon: ScrollText,
    permission: "audit.view",
  },
  {
    label: "Settings",
    href: "/admin/settings",
    icon: Settings,
    anyOf: ["school.update", "settings.view", "grading.view"],
  },
];
