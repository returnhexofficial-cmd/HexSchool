"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi, type CloneReport } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";

/**
 * Clone-to-session wizard (roadmap M06 §5): pick source/target, preview
 * the diff (dry run), then clone. Additive + idempotent server-side.
 */
export default function CloneStructurePage() {
  const { sessions } = useAcademicSession();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [report, setReport] = useState<CloneReport | null>(null);

  const run = useMutation({
    mutationFn: (preview: boolean) =>
      structureApi.cloneStructure({
        fromSessionId: fromId,
        toSessionId: toId,
        preview,
      }),
    onSuccess: (result) => {
      setReport(result);
      if (!result.preview) {
        toast.success(
          `Cloned ${result.sections.toCreate} section(s) and ${result.classSubjects.toCreate} mapping(s) into ${result.toSession}`,
        );
      }
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const ready = fromId && toId && fromId !== toId;

  return (
    <Can
      permission="structure.clone"
      fallback={
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to clone structure.
        </p>
      }
    >
      <div className="max-w-2xl space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label>Copy from</Label>
                <Select
                  value={fromId}
                  onValueChange={(v) => {
                    setFromId(v);
                    setReport(null);
                  }}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Source session" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ArrowRight className="mb-2.5 size-4 text-muted-foreground" />
              <div className="space-y-2">
                <Label>Into</Label>
                <Select
                  value={toId}
                  onValueChange={(v) => {
                    setToId(v);
                    setReport(null);
                  }}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Target session" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions
                      .filter((s) => s.id !== fromId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                disabled={!ready || run.isPending}
                onClick={() => run.mutate(true)}
              >
                Preview
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Copies sections (without class teachers) and class-subject
              mappings. Rows that already exist in the target are skipped —
              cloning twice is safe.
            </p>
          </CardContent>
        </Card>

        {report ? (
          <Card>
            <CardContent className="space-y-4 pt-6">
              <h3 className="font-medium">
                {report.preview ? "Preview" : "Cloned"}: {report.fromSession} →{" "}
                {report.toSession}
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="rounded-lg border p-4">
                  <p className="text-2xl font-semibold tabular-nums">
                    {report.sections.toCreate}
                  </p>
                  <p className="text-muted-foreground">
                    section(s) {report.preview ? "to create" : "created"} ·{" "}
                    {report.sections.alreadyPresent} already present
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-2xl font-semibold tabular-nums">
                    {report.classSubjects.toCreate}
                  </p>
                  <p className="text-muted-foreground">
                    subject mapping(s){" "}
                    {report.preview ? "to create" : "created"} ·{" "}
                    {report.classSubjects.alreadyPresent} already present
                  </p>
                </div>
              </div>
              {report.preview ? (
                <Button
                  disabled={run.isPending}
                  onClick={() => run.mutate(false)}
                >
                  {run.isPending ? "Cloning…" : "Clone now"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Can>
  );
}
