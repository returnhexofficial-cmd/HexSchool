"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { academicApi } from "@/lib/api/academic";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  promotionApi,
  type PromotionBatch,
  type PromotionBatchStatus,
  type PromotionMapping,
} from "@/lib/api/enrollment";
import { structureApi } from "@/lib/api/structure";

const STATUS_VARIANT: Record<
  PromotionBatchStatus,
  "default" | "secondary" | "outline"
> = {
  DRAFT: "secondary",
  EXECUTED: "default",
  ROLLED_BACK: "outline",
};

export default function PromotionsPage() {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);

  const batches = useQuery({
    queryKey: ["promotions"],
    queryFn: () => promotionApi.list({ limit: 50 }),
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Promotions"
        description="Yearly class promotion — build, preview, execute, roll back"
      >
        <Can permission="promotion.manage">
          <Button onClick={() => setNewOpen(true)}>New promotion</Button>
        </Can>
      </PageHeader>

      {batches.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : batches.isError ? (
        <ErrorState onRetry={() => void batches.refetch()} />
      ) : batches.data && batches.data.data.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From → To</TableHead>
                <TableHead>Students</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.data.data.map((b: PromotionBatch) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    {b.fromSession.name} → {b.toSession.name}
                  </TableCell>
                  <TableCell>{b._count.items}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
                  </TableCell>
                  <TableCell>{b.createdAt.slice(0, 10)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => router.push(`/admin/promotions/${b.id}`)}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No promotion batches"
          description="Create one to promote a session's students into the next session."
        />
      )}

      {newOpen ? (
        <NewPromotionDialog
          onClose={() => setNewOpen(false)}
          onCreated={(id) => router.push(`/admin/promotions/${id}`)}
        />
      ) : null}
    </main>
  );
}

function NewPromotionDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [fromSessionId, setFrom] = useState("");
  const [toSessionId, setTo] = useState("");

  const sessions = useQuery({
    queryKey: ["academic-sessions", "switcher"],
    queryFn: () => academicApi.listSessions({ limit: 100, sort: "startDate:desc" }),
  });
  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
  });
  const targetSections = useQuery({
    queryKey: ["sections", { sessionId: toSessionId }],
    queryFn: () =>
      structureApi.sections.list({ sessionId: toSessionId, limit: 200 }),
    enabled: !!toSessionId,
  });

  // Auto-map Class N → Class N+1, defaulting the target section to the
  // first section of that class in the target session.
  const mappings = useMemo<PromotionMapping[]>(() => {
    const cls = classes.data?.data ?? [];
    const secs = targetSections.data?.data ?? [];
    return cls.map((c) => {
      const next = cls.find((t) => t.numericLevel === c.numericLevel + 1);
      if (!next) return { fromClassId: c.id }; // final class → graduate
      const section = secs.find((s) => s.classId === next.id);
      return {
        fromClassId: c.id,
        toClassId: next.id,
        toSectionId: section?.id,
      };
    });
  }, [classes.data, targetSections.data]);

  const create = useMutation({
    mutationFn: () =>
      promotionApi.create({ fromSessionId, toSessionId, mappings }),
    onSuccess: (res) => {
      toast.success("Promotion batch created.");
      onCreated(res.batch.id);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const invalid = !fromSessionId || !toSessionId || fromSessionId === toSessionId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New promotion batch</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>From session (source)</Label>
            <Select value={fromSessionId || undefined} onValueChange={setFrom}>
              <SelectTrigger>
                <SelectValue placeholder="Select a session" />
              </SelectTrigger>
              <SelectContent>
                {(sessions.data?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>To session (target)</Label>
            <Select value={toSessionId || undefined} onValueChange={setTo}>
              <SelectTrigger>
                <SelectValue placeholder="Select a session" />
              </SelectTrigger>
              <SelectContent>
                {(sessions.data?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {fromSessionId && toSessionId && fromSessionId === toSessionId ? (
            <p className="text-sm text-destructive">
              Source and target sessions must differ.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Classes auto-map to the next level (Class N → Class N+1); the final
            class graduates. You can refine each student&apos;s decision after
            the draft is created.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            disabled={invalid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
