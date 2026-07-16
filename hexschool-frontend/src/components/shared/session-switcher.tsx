"use client";

import { CalendarRange } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Can } from "@/components/shared/can";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";

/**
 * Global session switcher (admin header, M05). Session-scoped pages read
 * the same selection via useAcademicSession().
 */
export function SessionSwitcher() {
  const { sessions, selected, select } = useAcademicSession();

  if (sessions.length === 0) return null;

  return (
    <Can permission="session.view">
      <div className="flex items-center gap-1.5">
        <CalendarRange className="size-4 text-muted-foreground" />
        <Select
          value={selected?.id ?? ""}
          onValueChange={(id) => id && select(id)}
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Academic session">
            <SelectValue placeholder="Session…" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                {s.isCurrent ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Can>
  );
}
