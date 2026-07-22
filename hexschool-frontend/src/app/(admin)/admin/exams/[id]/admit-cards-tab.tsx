"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import { examApi } from "@/lib/api/exam";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";

/**
 * Admit card batches. A card carries the candidate's identity and photo,
 * their class's sitting schedule, and their seat where a plan exists.
 *
 * The dues block is real code behind an inert gate: `exam.admit_card_
 * block_dues` does nothing until Module 16 binds a ledger, at which
 * point this toggle starts mattering.
 */
export function AdmitCardsTab({
  examId,
  classIds,
}: {
  examId: string;
  classIds: Array<{ classId: string; class: { id: string; name: string } }>;
}) {
  const { selected: session } = useAcademicSession();
  const [scope, setScope] = useState<"class" | "section">("class");
  const [classId, setClassId] = useState(classIds[0]?.classId ?? "");
  const [sectionId, setSectionId] = useState("");
  const [ignoreDues, setIgnoreDues] = useState(false);
  const [result, setResult] = useState<{
    issued: number;
    incomplete: number;
    blocked: number;
  } | null>(null);

  const sections = useQuery({
    queryKey: ["sections", { sessionId: session?.id, classId }],
    queryFn: () =>
      structureApi.sections.list({
        sessionId: session?.id ?? "",
        classId,
        limit: 100,
      }),
    enabled: scope === "section" && !!classId && !!session?.id,
  });

  const generate = useMutation({
    mutationFn: () =>
      examApi.admitCards(examId, {
        ...(scope === "class" ? { classId } : { sectionId }),
        ignoreDues,
      }),
    onSuccess: (counts) => {
      setResult(counts);
      toast.success(`${counts.issued} admit card(s) downloaded.`);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (classIds.length === 0) {
    return (
      <EmptyState
        title="No classes attached"
        description="Attach at least one class to this exam before issuing admit cards."
      />
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1">
        <Label>Issue for</Label>
        <Select
          value={scope}
          onValueChange={(v) => setScope(v as "class" | "section")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="class">A whole class</SelectItem>
            <SelectItem value="section">One section</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Class</Label>
        <Select
          value={classId || undefined}
          onValueChange={(v) => {
            setClassId(v);
            setSectionId("");
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a class" />
          </SelectTrigger>
          <SelectContent>
            {classIds.map((c) => (
              <SelectItem key={c.classId} value={c.classId}>
                {c.class.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {scope === "section" ? (
        <div className="space-y-1">
          <Label>Section</Label>
          <Select
            value={sectionId || undefined}
            onValueChange={setSectionId}
            disabled={!classId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a section" />
            </SelectTrigger>
            <SelectContent>
              {(sections.data?.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={ignoreDues}
          onCheckedChange={(v) => setIgnoreDues(v === true)}
        />
        <span>
          Issue despite outstanding dues
          <span className="block text-xs text-muted-foreground">
            Only matters once the dues block is switched on in Settings and
            Module 16 supplies a ledger. Requires{" "}
            <code>exam.admit-card.dues-override</code>.
          </span>
        </span>
      </label>

      <Can permission="exam.admit-card">
        <Button
          disabled={
            generate.isPending ||
            (scope === "class" ? !classId : !sectionId)
          }
          onClick={() => {
            setResult(null);
            generate.mutate();
          }}
        >
          {generate.isPending ? <Spinner className="mr-1 size-4" /> : null}
          Generate admit cards
        </Button>
      </Can>

      {result ? (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">{result.issued} card(s) issued</p>
          {result.incomplete > 0 ? (
            <p className="mt-1 text-muted-foreground">
              {result.incomplete} printed without a photo — the card is valid
              but flagged incomplete.
            </p>
          ) : null}
          {result.blocked > 0 ? (
            <p className="mt-1 text-destructive">
              {result.blocked} candidate(s) blocked for outstanding dues.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
