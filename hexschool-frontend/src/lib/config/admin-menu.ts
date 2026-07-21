import type { LucideIcon } from "lucide-react";
import {
  ArrowUpNarrowWide,
  BookUser,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  GraduationCap,
  LayoutDashboard,
  Network,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCheck,
  Users,
  UsersRound,
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
    label: "Academic Sessions",
    href: "/admin/sessions",
    icon: CalendarRange,
    permission: "session.view",
  },
  {
    label: "Calendar",
    href: "/admin/calendar",
    icon: CalendarDays,
    permission: "calendar.view",
  },
  {
    label: "Academic Structure",
    href: "/admin/structure",
    icon: Network,
    permission: "structure.view",
  },
  {
    label: "Admissions",
    href: "/admin/admissions",
    icon: ClipboardList,
    permission: "admission.view",
  },
  {
    label: "Students",
    href: "/admin/students",
    icon: BookUser,
    permission: "student.view",
  },
  {
    label: "Guardians",
    href: "/admin/guardians",
    icon: UsersRound,
    permission: "guardian.view",
  },
  {
    label: "Enrollment",
    href: "/admin/enrollments",
    icon: ClipboardCheck,
    permission: "enrollment.view",
  },
  {
    label: "Promotions",
    href: "/admin/promotions",
    icon: ArrowUpNarrowWide,
    permission: "promotion.view",
  },
  {
    label: "Attendance",
    href: "/admin/attendance",
    icon: CalendarCheck,
    permission: "attendance.view",
  },
  {
    label: "Staff Attendance",
    href: "/admin/attendance/staff",
    icon: UserCheck,
    permission: "attendance.staff.view",
  },
  {
    label: "Student Leave",
    href: "/admin/attendance/leaves",
    icon: FileClock,
    permission: "student.leave.view",
  },
  {
    label: "Teachers",
    href: "/admin/teachers",
    icon: GraduationCap,
    permission: "teacher.view",
  },
  {
    label: "Staff",
    href: "/admin/staff",
    icon: BriefcaseBusiness,
    permission: "staff.view",
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: Users,
    permission: "user.view",
  },
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
