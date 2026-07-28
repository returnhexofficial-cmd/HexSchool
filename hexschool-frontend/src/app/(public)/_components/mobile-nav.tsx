"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The one interactive piece of the site header — a drawer, so the rest of
 * the chrome can stay a server component and ship no JavaScript.
 */
export function MobileNav({
  links,
}: {
  links: Array<{ href: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </Button>

      {open ? (
        <div className="absolute inset-x-0 top-full border-b bg-background shadow-lg">
          <nav className="mx-auto flex w-full max-w-6xl flex-col p-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded px-3 py-2.5 text-sm hover:bg-muted"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="mt-1 rounded bg-primary px-3 py-2.5 text-center text-sm font-medium text-primary-foreground"
            >
              Sign in
            </Link>
          </nav>
        </div>
      ) : null}
    </>
  );
}
