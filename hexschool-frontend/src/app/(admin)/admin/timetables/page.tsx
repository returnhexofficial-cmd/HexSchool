"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { apiErrorMessage } from "@/lib/api/auth";
import { structureApi } from "@/lib/api/structure";
import { timetableApi, type TimetableStatus } from "@/lib/api/timetable";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { TIMETABLE_STATUS_LABELS } from "@/lib/validations/timetable";

const STATUS_VARIANT: Record<
  TimetableStatus,
  "default" | "secondary" | "outline"
> = {
  PUBLISHED: "default",
  DRAFT: "secondary",
  ARCHIVED: "outline",
};

/**
 * Section routines for the selected session. Each section may hold one
 * draft being built and one published version in force; archived
 * versions stay listed as the effective-from history.
 */
export default function TimetablesPage() {
  const { selected: session } = useAcademicSession();
  const sessionId = session?.id ?? "";
  const router = useRouter();

  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState<TimetableStatus | "">("");
  const [newOpen, setNewOpen] = useState(false);

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const timetables = useQuery({
    queryKey: ["timetables", { sessionId, classId, status }],
    queryFn: () =>
      timetableApi.list({
        sessionId,
        ...(classId ? { classId } : {}),
        ...(status ? { status } : {}),
      }),
    enabled: !!sessionId,
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Class routines"
        description={
          session
            ? `Weekly timetables for ${session.name}`
            : "Select a session from the header switcher"
        }
      >
        <Can permission="timetable.view">
          <Button variant="outline" asChild>
            <Link href="/admin/timetables/master">Master grid</Link>
          </Button>
        </Can>
        <Can permission="timetable.view">
          <Button variant="outline" asChild>
            <Link href="/admin/timetables/periods">Period slots</Link>
          </Button>
        </Can>
        <Can permission="timetable.manage">
          <Button disabled={!sessionId} onClick={() => setNewOpen(true)}>
            New routine
          </Button>
        </Can>
      </PageHeader>

      {!sessionId ? (
        <EmptyState
          title="No session selected"
          description="Pick an academic session from the switcher in the header."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="w-52 space-y-1">
              <Label>Class</Label>
              <Select
                value={classId || "ALL"}
                onValueChange={(v) => setClassId(v === "ALL" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All classes</SelectItem>
                  {(classes.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44 space-y-1">
              <Label>Status</Label>
              <Select
                value={status || "ALL"}
                onValueChange={(v) =>
                  setStatus(v === "ALL" ? "" : (v as TimetableStatus))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {(
                    ["DRAFT", "PUBLISHED", "ARCHIVED"] as TimetableStatus[]
                  ).map((s) => (
                    <SelectItem key={s} value={s}>
                      {TIMETABLE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {timetables.isPending ? (
            <LoadingBlock />
          ) : timetables.isError ? (
            <ErrorState onRetry={() => void timetables.refetch()} />
          ) : (timetables.data ?? []).length === 0 ? (
            <EmptyState
              title="No routines yet"
              description="Start a draft for a section — you will need its shift's period slots first."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Section</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Effective from</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(timetables.data ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {row.section.class.name} — {row.section.name}
                      </TableCell>
                      <TableCell>{row.section.shift?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[row.status]}>
                          {TIMETABLE_STATUS_LABELS[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>v{row.version}</TableCell>
                      <TableCell>{row.effectiveFrom}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`/admin/timetables/${row.id}`}>
                            {row.status === "DRAFT" ? "Build" : "View"}
                          </Link>
                        </Button>
                        <Can permission="timetable.export">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void timetableApi
                                .downloadPdf(row.id)
                                .catch((err) =>
                                  toast.error(apiErrorMessage(err)),
                                )
                            }
                          >
                            PDF
                          </Button>
                        </Can>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {newOpen ? (
        <NewRoutineDialog
          sessionId={sessionId}
          onClose={() => setNewOpen(false)}
          onCreated={(id) => router.push(`/admin/timetables/${id}`)}
        />
      ) : null}
    </main>
  );
}

function NewRoutineDialog({
  sessionId,
  onClose,
  onCreated,
}: {
  sessionId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [copy, setCopy] = useState(true);

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const sections = useQuery({
    queryKey: ["sections", { sessionId, classId }],
    queryFn: () =>
      structureApi.sections.list({ sessionId, classId, limit: 100 }),
    enabled: !!classId,
  });

  const create = useMutation({
    mutationFn: () =>
      timetableApi.createDraft({
        sectionId,
        sessionId,
        copyFromPublished: copy,
      }),
    onSuccess: (created) => {
      toast.success("Draft routine created.");
      void qc.invalidateQueries({ queryKey: ["timetables"] });
      onCreated(created.id);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New draft routine</DialogTitle>
        </DialogHeader>
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
              {(classes.data?.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={copy}
            onCheckedChange={(v) => setCopy(v === true)}
          />
          <span>
            Start from the published routine
            <span className="block text-xs text-muted-foreground">
              The usual way to make a mid-year change — the old version stays
              live until you publish this one.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!sectionId || create.isPending}
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
