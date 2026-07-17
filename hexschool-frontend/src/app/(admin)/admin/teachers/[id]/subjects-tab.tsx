"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi, type Subject } from "@/lib/api/structure";
import { teachersApi } from "@/lib/api/teachers";
import { usePermissions } from "@/lib/hooks/use-permissions";

/** Expertise editor: what this teacher CAN teach (assignments check it). */
export function SubjectsTab({ teacherId }: { teacherId: string }) {
  const expertise = useQuery({
    queryKey: ["teacher-subjects", teacherId],
    queryFn: () => teachersApi.getSubjects(teacherId),
  });
  const catalog = useQuery({
    queryKey: ["subjects", "all"],
    queryFn: () => structureApi.subjects.list({ limit: 100 }),
    staleTime: 60_000,
  });

  if (expertise.isPending || catalog.isPending) return <LoadingBlock />;
  if (expertise.isError || catalog.isError) {
    return (
      <ErrorState
        error={expertise.error ?? catalog.error}
        onRetry={() => {
          void expertise.refetch();
          void catalog.refetch();
        }}
      />
    );
  }

  return (
    <SubjectsEditor
      key={expertise.data
        .map((s) => s.id)
        .sort()
        .join(",")}
      teacherId={teacherId}
      current={expertise.data.map((s) => s.id)}
      catalog={catalog.data.data}
    />
  );
}

function SubjectsEditor({
  teacherId,
  current,
  catalog,
}: {
  teacherId: string;
  current: string[];
  catalog: Subject[];
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(current));

  const save = useMutation({
    mutationFn: () => teachersApi.setSubjects(teacherId, [...selected]),
    onSuccess: () => {
      toast.success("Expertise saved");
      void queryClient.invalidateQueries({
        queryKey: ["teacher-subjects", teacherId],
      });
      void queryClient.invalidateQueries({ queryKey: ["teachers"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const editable = can("teacher.subject.assign");
  const currentSet = new Set(current);
  const dirty =
    selected.size !== currentSet.size ||
    [...selected].some((id) => !currentSet.has(id));

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Assignments outside this set need the override permission.
        </p>
        {editable ? (
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
            Save expertise
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {catalog.map((subject) => {
          const checked = selected.has(subject.id);
          return (
            <label
              key={subject.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-accent/40"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                disabled={!editable}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(subject.id);
                    else next.delete(subject.id);
                    return next;
                  });
                }}
              />
              <span className="flex-1 font-medium">{subject.name}</span>
              <Badge variant="outline">{subject.code}</Badge>
            </label>
          );
        })}
      </div>
    </div>
  );
}
