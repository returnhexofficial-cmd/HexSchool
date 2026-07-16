"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Classes", href: "/admin/structure/classes" },
  { label: "Subjects", href: "/admin/structure/subjects" },
  { label: "Departments", href: "/admin/structure/departments" },
  { label: "Shifts", href: "/admin/structure/shifts" },
  { label: "Groups", href: "/admin/structure/groups" },
  { label: "Clone to Session", href: "/admin/structure/clone" },
];

export default function StructureLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Academic Structure"
        description="Classes, sections, subjects, and how they fit together per session"
      />
      <nav className="flex flex-wrap gap-1 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors",
              pathname.startsWith(tab.href)
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
