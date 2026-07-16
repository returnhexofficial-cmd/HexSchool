"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

/** Tab strip per roadmap M04 §5 — routes, not stateful tabs. */
const TABS = [
  { label: "School Profile", href: "/admin/settings/profile" },
  { label: "Academic", href: "/admin/settings/academic" },
  { label: "Grading Systems", href: "/admin/settings/grading" },
  { label: "SMS Gateway", href: "/admin/settings/sms" },
  { label: "Email", href: "/admin/settings/email" },
  { label: "Payment Gateways", href: "/admin/settings/payment" },
  { label: "General", href: "/admin/settings/general" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Settings"
        description="School identity, grading, and gateway configuration"
      />
      <nav className="flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors",
              pathname === tab.href
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
