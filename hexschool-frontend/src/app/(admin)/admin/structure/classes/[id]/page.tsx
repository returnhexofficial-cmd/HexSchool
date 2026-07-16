"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { cn } from "@/lib/utils";
import { SectionsTab } from "./sections-tab";
import { SubjectsTab } from "./subjects-tab";

/**
 * Class detail (roadmap M06 §5): Sections and Subjects tabs, both
 * scoped to the header session switcher (the M05 convention).
 */
export default function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tab, setTab] = useState<"sections" | "subjects">("sections");
  const { selected: session } = useAcademicSession();

  const klass = useQuery({
    queryKey: ["classes", id],
    queryFn: () => structureApi.getClass(id),
  });

  if (klass.isPending) return <LoadingBlock />;
  if (klass.isError) {
    return (
      <ErrorState error={klass.error} onRetry={() => void klass.refetch()} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{klass.data.name}</h2>
        <Badge variant="outline">Level {klass.data.numericLevel}</Badge>
        {session ? (
          <Badge variant="secondary">Session {session.name}</Badge>
        ) : (
          <Badge variant="destructive">
            Select a session in the header first
          </Badge>
        )}
      </div>

      <div className="flex gap-1 border-b">
        {(
          [
            ["sections", "Sections"],
            ["subjects", "Subjects"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            className={cn(
              "-mb-px rounded-b-none border-b-2 border-transparent",
              tab === key && "border-primary",
            )}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {!session ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          Sections and subject mappings are session-scoped — pick an academic
          session in the header.
        </p>
      ) : tab === "sections" ? (
        <SectionsTab
          classId={id}
          classLevel={klass.data.numericLevel}
          sessionId={session.id}
        />
      ) : (
        <SubjectsTab
          classId={id}
          classLevel={klass.data.numericLevel}
          sessionId={session.id}
        />
      )}
    </div>
  );
}
