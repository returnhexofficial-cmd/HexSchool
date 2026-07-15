"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { Permission } from "@/lib/api/rbac";

interface PermissionMatrixProps {
  catalog: Permission[];
  selected: Set<string>;
  /** Codes that cannot be unchecked (system-role core set). */
  locked: Set<string>;
  disabled?: boolean;
  onChange: (next: Set<string>) => void;
}

/**
 * Permission matrix grouped by module with per-module check-all and
 * search (roadmap M03 §5). Locked (core) codes render checked+disabled.
 */
export function PermissionMatrix({
  catalog,
  selected,
  locked,
  disabled = false,
  onChange,
}: PermissionMatrixProps) {
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const visible = needle
      ? catalog.filter(
          (p) =>
            p.code.toLowerCase().includes(needle) ||
            (p.description ?? "").toLowerCase().includes(needle) ||
            p.module.toLowerCase().includes(needle),
        )
      : catalog;
    const byModule = new Map<string, Permission[]>();
    for (const p of visible) {
      const list = byModule.get(p.module) ?? [];
      list.push(p);
      byModule.set(p.module, list);
    }
    return [...byModule.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog, filter]);

  const toggle = (code: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(code);
    else if (!locked.has(code)) next.delete(code);
    onChange(next);
  };

  const toggleModule = (perms: Permission[], checked: boolean) => {
    const next = new Set(selected);
    for (const p of perms) {
      if (checked) next.add(p.code);
      else if (!locked.has(p.code)) next.delete(p.code);
    }
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="relative w-64">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter permissions…"
          className="pl-8"
          aria-label="Filter permissions"
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No permissions match the filter.
        </p>
      ) : (
        groups.map(([module, perms]) => {
          const allChecked = perms.every((p) => selected.has(p.code));
          return (
            <section key={module} className="rounded-lg border">
              <header className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={allChecked}
                  disabled={disabled}
                  onChange={(e) => toggleModule(perms, e.target.checked)}
                  aria-label={`Toggle all ${module} permissions`}
                />
                <span className="font-medium capitalize">{module}</span>
                <span className="text-xs text-muted-foreground">
                  {perms.filter((p) => selected.has(p.code)).length}/
                  {perms.length}
                </span>
              </header>
              <ul className="divide-y">
                {perms.map((p) => (
                  <li key={p.code} className="flex items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selected.has(p.code)}
                      disabled={disabled || locked.has(p.code)}
                      onChange={(e) => toggle(p.code, e.target.checked)}
                      aria-label={p.code}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm">{p.code}</p>
                      {p.description ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {p.description}
                        </p>
                      ) : null}
                    </div>
                    {locked.has(p.code) ? (
                      <Badge variant="secondary">Core</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
