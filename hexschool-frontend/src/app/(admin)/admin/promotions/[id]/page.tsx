"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  promotionApi,
  type PromotionDecision,
  type PromotionPreview,
} from "@/lib/api/enrollment";
import { structureApi } from "@/lib/api/structure";
import {
  PROMOTION_DECISION_LABELS,
  PROMOTION_DECISIONS,
} from "@/lib/validations/enrollment";

interface ItemEdit {
  decision: PromotionDecision;
  toClassId: string | null;
  toSectionId: string | null;
}

const DECISION_VARIANT: Record<
  PromotionDecision,
  "default" | "secondary" | "outline" | "destructive"
> = {
  PROMOTE: "default",
  RETAIN: "secondary",
  GRADUATE: "outline",
  EXCLUDE: "destructive",
};

export default function PromotionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["promotion", id],
    queryFn: () => promotionApi.get(id),
    enabled: !!id,
  });
  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });
  const toSessionId = detail.data?.batch.toSessionId ?? "";
  const targetSections = useQuery({
    queryKey: ["sections", { sessionId: toSessionId }],
    queryFn: () =>
      structureApi.sections.list({ sessionId: toSessionId, limit: 200 }),
    enabled: !!toSessionId,
  });

  // Local decision overrides over the server items (keyed by item id);
  // absent entries fall back to the server value at render/save time.
  const [edits, setEdits] = useState<Record<string, ItemEdit>>({});
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [confirmExec, setConfirmExec] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);

  const isDraft = detail.data?.batch.status === "DRAFT";
  const isExecuted = detail.data?.batch.status === "EXECUTED";

  const classesById = useMemo(
    () =>
      new Map((classes.data?.data ?? []).map((c) => [c.id, c] as const)),
    [classes.data],
  );

  const saveItems = useMutation({
    mutationFn: () =>
      promotionApi.updateItems(
        id,
        (detail.data?.items ?? []).map((it) => {
          const e = edits[it.id];
          return {
            itemId: it.id,
            decision: e?.decision ?? it.decision,
            toClassId: e ? e.toClassId : it.toClassId,
            toSectionId: e ? e.toSectionId : it.toSectionId,
          };
        }),
      ),
    onSuccess: () => {
      toast.success("Decisions saved.");
      void qc.invalidateQueries({ queryKey: ["promotion", id] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const runPreview = useMutation({
    mutationFn: () => promotionApi.preview(id),
    onSuccess: (p) => setPreview(p),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const execute = useMutation({
    mutationFn: () => promotionApi.execute(id),
    onSuccess: (r) => {
      toast.success(
        `Executed — ${r.promoted} promoted, ${r.retained} retained, ${r.graduated} graduated, ${r.excluded} excluded.`,
      );
      void qc.invalidateQueries({ queryKey: ["promotion", id] });
      void qc.invalidateQueries({ queryKey: ["promotions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rollback = useMutation({
    mutationFn: () => promotionApi.rollback(id),
    onSuccess: () => {
      toast.success("Promotion rolled back.");
      void qc.invalidateQueries({ queryKey: ["promotion", id] });
      void qc.invalidateQueries({ queryKey: ["promotions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => promotionApi.remove(id),
    onSuccess: () => {
      toast.success("Draft deleted.");
      router.push("/admin/promotions");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (detail.isPending) {
    return (
      <main className="flex flex-1 justify-center p-12">
        <Spinner className="size-6" />
      </main>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <main className="flex-1 p-8">
        <ErrorState onRetry={() => void detail.refetch()} />
      </main>
    );
  }

  const { batch, items } = detail.data;
  const targetSectionsForClass = (classId: string | null) =>
    (targetSections.data?.data ?? []).filter((s) => s.classId === classId);

  const setEdit = (itemId: string, patch: Partial<ItemEdit>) =>
    setEdits((prev) => {
      const it = items.find((x) => x.id === itemId);
      const base: ItemEdit = prev[itemId] ?? {
        decision: it?.decision ?? "PROMOTE",
        toClassId: it?.toClassId ?? null,
        toSectionId: it?.toSectionId ?? null,
      };
      return { ...prev, [itemId]: { ...base, ...patch } };
    });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={`Promotion: ${batch.fromSession.name} → ${batch.toSession.name}`}
        description="Review each student's decision, preview, then execute"
      >
        <Badge variant={batch.status === "EXECUTED" ? "default" : "secondary"}>
          {batch.status}
        </Badge>
        {isDraft ? (
          <>
            <Can permission="promotion.manage">
              <Button
                variant="outline"
                disabled={saveItems.isPending}
                onClick={() => saveItems.mutate()}
              >
                {saveItems.isPending ? <Spinner className="mr-1 size-4" /> : null}
                Save decisions
              </Button>
            </Can>
            <Button
              variant="outline"
              disabled={runPreview.isPending}
              onClick={() => runPreview.mutate()}
            >
              Preview
            </Button>
            <Can permission="promotion.execute">
              <Button onClick={() => setConfirmExec(true)}>Execute</Button>
            </Can>
            <Can permission="promotion.manage">
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => remove.mutate()}
              >
                Delete
              </Button>
            </Can>
          </>
        ) : isExecuted ? (
          <Can permission="promotion.execute">
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setConfirmRollback(true)}
            >
              Roll back
            </Button>
          </Can>
        ) : null}
      </PageHeader>

      {preview ? (
        <Card>
          <CardContent className="flex flex-wrap gap-4 py-4 text-sm">
            {PROMOTION_DECISIONS.map((d) => (
              <span key={d}>
                <span className="font-medium">
                  {PROMOTION_DECISION_LABELS[d]}:
                </span>{" "}
                {preview.counts[d]}
              </span>
            ))}
            {preview.warnings.length > 0 ? (
              <ul className="mt-2 w-full list-disc space-y-0.5 pl-5 text-destructive">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">No blocking issues.</span>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Target class</TableHead>
              <TableHead>Target section</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => {
              const e = edits[it.id] ?? {
                decision: it.decision,
                toClassId: it.toClassId,
                toSectionId: it.toSectionId,
              };
              const movement = e.decision === "PROMOTE" || e.decision === "RETAIN";
              return (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">
                    {it.student.firstName} {it.student.lastName}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {it.student.studentUid}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {it.fromEnrollment
                      ? `${it.fromEnrollment.class.name} · ${it.fromEnrollment.section.name} · roll ${it.fromEnrollment.rollNo}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {isDraft ? (
                      <Select
                        value={e.decision}
                        onValueChange={(v) =>
                          setEdit(it.id, {
                            decision: v as PromotionDecision,
                            ...(v === "GRADUATE" || v === "EXCLUDE"
                              ? { toClassId: null, toSectionId: null }
                              : {}),
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROMOTION_DECISIONS.map((d) => (
                            <SelectItem key={d} value={d}>
                              {PROMOTION_DECISION_LABELS[d]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={DECISION_VARIANT[it.decision]}>
                        {PROMOTION_DECISION_LABELS[it.decision]}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {movement && isDraft ? (
                      <Select
                        value={e.toClassId || undefined}
                        onValueChange={(v) =>
                          setEdit(it.id, { toClassId: v, toSectionId: null })
                        }
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue placeholder="Class" />
                        </SelectTrigger>
                        <SelectContent>
                          {(classes.data?.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : movement ? (
                      (classesById.get(it.toClassId ?? "")?.name ?? "—")
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {movement && isDraft ? (
                      <Select
                        value={e.toSectionId || undefined}
                        onValueChange={(v) => setEdit(it.id, { toSectionId: v })}
                        disabled={!e.toClassId}
                      >
                        <SelectTrigger size="sm" className="w-28">
                          <SelectValue placeholder="Section" />
                        </SelectTrigger>
                        <SelectContent>
                          {targetSectionsForClass(e.toClassId).map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : movement ? (
                      (it.toSection?.name ?? "—")
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={confirmExec}
        onOpenChange={setConfirmExec}
        title="Execute this promotion?"
        description="Old enrollments are closed and new ones created in the target session. Graduating students are marked GRADUATED. You can roll this back only until the new session has attendance/marks."
        confirmLabel="Execute"
        isPending={execute.isPending}
        onConfirm={() => execute.mutate()}
      />
      <ConfirmDialog
        open={confirmRollback}
        onOpenChange={setConfirmRollback}
        title="Roll back this promotion?"
        description="New-session enrollments created by this batch are deleted and the old enrollments reactivated."
        confirmLabel="Roll back"
        destructive
        isPending={rollback.isPending}
        onConfirm={() => rollback.mutate()}
      />
    </main>
  );
}
