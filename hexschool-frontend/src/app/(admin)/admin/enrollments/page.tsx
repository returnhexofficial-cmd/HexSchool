"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { Spinner } from "@/components/shared/spinner";
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
import { Input } from "@/components/ui/input";
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
import {
  enrollmentApi,
  type Enrollment,
  type RenumberStrategy,
} from "@/lib/api/enrollment";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { useDebounce } from "@/lib/hooks/use-debounce";

export default function EnrollmentPage() {
  const { selected: session } = useAcademicSession();
  const sessionId = session?.id ?? "";
  const qc = useQueryClient();

  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [transferFor, setTransferFor] = useState<Enrollment | null>(null);
  const [rollEditFor, setRollEditFor] = useState<Enrollment | null>(null);
  const [cancelFor, setCancelFor] = useState<Enrollment | null>(null);
  const [renumberOpen, setRenumberOpen] = useState(false);

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const sections = useQuery({
    queryKey: ["sections", { sessionId, classId }],
    queryFn: () =>
      structureApi.sections.list({ sessionId, classId, limit: 100 }),
    enabled: !!sessionId && !!classId,
  });

  const roster = useQuery({
    queryKey: ["section-roster", sectionId],
    queryFn: () => enrollmentApi.sectionRoster(sectionId),
    enabled: !!sectionId,
  });

  const currentSection = useMemo(
    () => sections.data?.data.find((s) => s.id === sectionId) ?? null,
    [sections.data, sectionId],
  );

  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["section-roster", sectionId] });

  const cancelMutation = useMutation({
    mutationFn: (e: Enrollment) => enrollmentApi.cancel(e.id),
    onSuccess: () => {
      toast.success("Enrollment cancelled.");
      setCancelFor(null);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const idCards = useMutation({
    mutationFn: () => sectionIdCards(sectionId),
    onSuccess: (incomplete: number) =>
      toast.success(
        incomplete > 0
          ? `ID cards downloaded — ${incomplete} card(s) lack a photo.`
          : "Section ID cards downloaded.",
      ),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Enrollment"
        description={
          session
            ? `Enroll and manage rolls for ${session.name}`
            : "Select a session from the header switcher"
        }
      >
        {sectionId ? (
          <>
            <Can permission="enrollment.roll.assign">
              <Button
                variant="outline"
                disabled={!roster.data?.length}
                onClick={() => setRenumberOpen(true)}
              >
                Renumber rolls
              </Button>
            </Can>
            <Can permission="student.idcard.generate">
              <Button
                variant="outline"
                disabled={idCards.isPending || !roster.data?.length}
                onClick={() => idCards.mutate()}
              >
                ID cards
              </Button>
            </Can>
            <Can permission="enrollment.create">
              <Button onClick={() => setEnrollOpen(true)}>Enroll students</Button>
            </Can>
          </>
        ) : null}
      </PageHeader>

      {!sessionId ? (
        <EmptyState
          title="No session selected"
          description="Pick an academic session from the switcher in the header."
        />
      ) : (
        <div className="flex flex-wrap gap-3">
          <div className="w-56 space-y-1">
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
          <div className="w-56 space-y-1">
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
                    {s.capacity != null ? ` (cap ${s.capacity})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {sectionId ? (
        roster.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-6" />
          </div>
        ) : roster.isError ? (
          <ErrorState onRetry={() => void roster.refetch()} />
        ) : roster.data && roster.data.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Roll</TableHead>
                  <TableHead>UID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Optional Subject</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.rollNo}</TableCell>
                    <TableCell>{e.student.studentUid}</TableCell>
                    <TableCell>
                      {e.student.firstName} {e.student.lastName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{e.type}</Badge>
                    </TableCell>
                    <TableCell>{e.optionalSubject?.name ?? "—"}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Can permission="enrollment.update">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRollEditFor(e)}
                        >
                          Roll
                        </Button>
                      </Can>
                      <Can permission="enrollment.transfer">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setTransferFor(e)}
                        >
                          Transfer
                        </Button>
                      </Can>
                      <Can permission="enrollment.delete">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setCancelFor(e)}
                        >
                          Cancel
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title="No students enrolled"
            description="Use “Enroll students” to add students to this section."
          />
        )
      ) : null}

      {enrollOpen && currentSection ? (
        <EnrollDialog
          sessionId={sessionId}
          sectionId={sectionId}
          onClose={() => setEnrollOpen(false)}
          onDone={() => {
            setEnrollOpen(false);
            refresh();
          }}
        />
      ) : null}

      {transferFor ? (
        <TransferDialog
          enrollment={transferFor}
          sessionId={sessionId}
          onClose={() => setTransferFor(null)}
          onDone={() => {
            setTransferFor(null);
            refresh();
          }}
        />
      ) : null}

      {rollEditFor ? (
        <RollEditDialog
          enrollment={rollEditFor}
          onClose={() => setRollEditFor(null)}
          onDone={() => {
            setRollEditFor(null);
            refresh();
          }}
        />
      ) : null}

      {renumberOpen ? (
        <RenumberDialog
          sectionId={sectionId}
          sessionId={sessionId}
          onClose={() => setRenumberOpen(false)}
          onDone={() => {
            setRenumberOpen(false);
            refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!cancelFor}
        onOpenChange={(o) => !o && setCancelFor(null)}
        title="Cancel this enrollment?"
        description={
          cancelFor
            ? `${cancelFor.student.firstName} ${cancelFor.student.lastName} (roll ${cancelFor.rollNo}) will be removed from the section. The seat and roll are freed.`
            : undefined
        }
        confirmLabel="Cancel enrollment"
        destructive
        isPending={cancelMutation.isPending}
        onConfirm={() => {
          if (cancelFor) cancelMutation.mutate(cancelFor);
        }}
      />
    </main>
  );
}

/** Downloads a section's roster ID cards; returns the incomplete count. */
async function sectionIdCards(sectionId: string): Promise<number> {
  const { api } = await import("@/lib/api/axios");
  const res = await api.post<Blob>(
    `/sections/${sectionId}/id-cards`,
    undefined,
    { responseType: "blob" },
  );
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = "section-id-cards.pdf";
  a.click();
  URL.revokeObjectURL(url);
  return Number(res.headers["x-cards-incomplete"] ?? 0);
}

function EnrollDialog({
  sessionId,
  sectionId,
  onClose,
  onDone,
}: {
  sessionId: string;
  sectionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const candidates = useQuery({
    queryKey: ["enrollable", { sessionId, search: debounced }],
    queryFn: () => enrollmentApi.enrollable(sessionId, debounced || undefined),
    enabled: !!sessionId,
  });

  const bulk = useMutation({
    mutationFn: () =>
      enrollmentApi.bulkEnroll({
        sessionId,
        sectionId,
        studentIds: [...picked],
      }),
    onSuccess: (res) => {
      const skipped = res.skipped.length;
      toast.success(
        `Enrolled ${res.enrolled.length} student(s)` +
          (skipped ? ` — ${skipped} skipped.` : "."),
      );
      onDone();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll students into this section</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search name or UID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
          {candidates.isPending ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5" />
            </div>
          ) : candidates.data && candidates.data.length > 0 ? (
            candidates.data.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={picked.has(s.id)}
                  onCheckedChange={() => toggle(s.id)}
                />
                <span className="text-sm">
                  {s.firstName} {s.lastName}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {s.studentUid}
                </span>
              </label>
            ))
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No unenrolled students match.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={bulk.isPending}>
            Cancel
          </Button>
          <Button
            disabled={picked.size === 0 || bulk.isPending}
            onClick={() => bulk.mutate()}
          >
            {bulk.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Enroll {picked.size > 0 ? `(${picked.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  enrollment,
  sessionId,
  onClose,
  onDone,
}: {
  enrollment: Enrollment;
  sessionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [toSectionId, setToSectionId] = useState("");
  const [keepRoll, setKeepRoll] = useState(true);
  const [reason, setReason] = useState("");

  const sections = useQuery({
    queryKey: ["sections", { sessionId, classId: enrollment.classId }],
    queryFn: () =>
      structureApi.sections.list({
        sessionId,
        classId: enrollment.classId,
        limit: 100,
      }),
  });

  const targets = (sections.data?.data ?? []).filter(
    (s) => s.id !== enrollment.sectionId,
  );

  const transfer = useMutation({
    mutationFn: () =>
      enrollmentApi.transferSection(enrollment.id, {
        toSectionId,
        keepRoll,
        reason: reason || undefined,
      }),
    onSuccess: (res) => {
      toast.success(`Transferred to section ${res.section.name} (roll ${res.rollNo}).`);
      onDone();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const target = targets.find((s) => s.id === toSectionId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Transfer {enrollment.student.firstName} to another section
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Target section (same class)</Label>
            <Select value={toSectionId || undefined} onValueChange={setToSectionId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a section" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.capacity != null ? ` (cap ${s.capacity})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target?.capacity != null ? (
              <p className="text-xs text-muted-foreground">
                Target capacity: {target.capacity}
              </p>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={keepRoll}
              onCheckedChange={(v) => setKeepRoll(!!v)}
            />
            Keep roll {enrollment.rollNo} if free (else auto-assign)
          </label>
          <div className="space-y-1">
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!toSectionId || transfer.isPending}
            onClick={() => transfer.mutate()}
          >
            {transfer.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RollEditDialog({
  enrollment,
  onClose,
  onDone,
}: {
  enrollment: Enrollment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [roll, setRoll] = useState(String(enrollment.rollNo));

  const save = useMutation({
    mutationFn: () =>
      enrollmentApi.update(enrollment.id, { rollNo: Number(roll) }),
    onSuccess: () => {
      toast.success("Roll updated.");
      onDone();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Edit roll — {enrollment.student.firstName}{" "}
            {enrollment.student.lastName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Roll number</Label>
          <Input
            type="number"
            min={1}
            max={9999}
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !roll}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenumberDialog({
  sectionId,
  sessionId,
  onClose,
  onDone,
}: {
  sectionId: string;
  sessionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [strategy, setStrategy] = useState<RenumberStrategy>("SEQUENTIAL");

  const run = useMutation({
    mutationFn: () =>
      enrollmentApi.rollAssign({ sectionId, sessionId, strategy }),
    onSuccess: () => {
      toast.success("Section renumbered.");
      onDone();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renumber section rolls</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Order by</Label>
          <Select
            value={strategy}
            onValueChange={(v) => setStrategy(v as RenumberStrategy)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEQUENTIAL">Current roll order</SelectItem>
              <SelectItem value="ALPHABETICAL">Student name</SelectItem>
            </SelectContent>
          </Select>
          <p className="pt-1 text-xs text-muted-foreground">
            Rolls are reassigned 1…N in the chosen order.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Renumber
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
