"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  assignmentApi,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_TYPES,
  ASSIGNMENT_TYPE_LABELS,
  dueRelative,
  formatDue,
  isoToLocal,
  localToIso,
  type AssignmentStatus,
  type AssignmentType,
} from "@/lib/api/assignment";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import {
  ASSIGNMENT_STATUS_VARIANT,
  assignmentSchema,
  type AssignmentFormValues,
} from "@/lib/validations/assignment";

const ALL = "__all__";

/** `assignment.default_due_days` is 7; the form starts a week out at 18:00. */
function defaultDueLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(18, 0, 0, 0);
  return isoToLocal(d.toISOString());
}

function nowLocal(): string {
  return isoToLocal(new Date().toISOString());
}

export function AssignmentsTab() {
  const qc = useQueryClient();
  const { selected: session } = useAcademicSession();
  const [status, setStatus] = useState<string>(ALL);
  const [type, setType] = useState<string>(ALL);
  const [sectionId, setSectionId] = useState<string>(ALL);
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: [
      "assignments",
      session?.id,
      status,
      type,
      sectionId,
      mine,
      search,
    ],
    queryFn: () =>
      assignmentApi.list({
        sessionId: session?.id,
        status: status === ALL ? undefined : (status as AssignmentStatus),
        type: type === ALL ? undefined : (type as AssignmentType),
        sectionId: sectionId === ALL ? undefined : sectionId,
        mine: mine || undefined,
        search: search.trim() || undefined,
        limit: 50,
      }),
    enabled: Boolean(session),
  });

  const sections = useQuery({
    queryKey: ["sections", session?.id, "assignments"],
    queryFn: () =>
      structureApi.sections.list({ sessionId: session!.id, limit: 100 }),
    enabled: Boolean(session),
  });

  if (!session) {
    return (
      <EmptyState
        title="Pick an academic session"
        description="Assignments are scoped to a session — choose one in the header."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40 space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {ASSIGNMENT_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ASSIGNMENT_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40 space-y-1">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {ASSIGNMENT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {ASSIGNMENT_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-48 space-y-1">
            <Label>Section</Label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All my sections</SelectItem>
                {(sections.data?.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.class?.name ?? ""} {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-56 space-y-1">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title…"
            />
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={mine}
              onCheckedChange={(v) => setMine(v === true)}
            />
            Only work I set
          </label>
        </div>

        <Can permission="assignment.manage">
          <Button onClick={() => setCreating(true)}>New assignment</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : (list.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          title="No assignments yet"
          description="Set the first piece of work for one of your sections."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Marks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data?.rows ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    <Link
                      className="hover:underline"
                      href={`/admin/assignments/${a.id}`}
                    >
                      {a.title}
                    </Link>
                    {a.allowLate && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        late allowed
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.section.class.name} {a.section.name}
                  </TableCell>
                  <TableCell>{a.subject.name}</TableCell>
                  <TableCell>{ASSIGNMENT_TYPE_LABELS[a.type]}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDue(a.dueAt)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {dueRelative(a.dueAt)}
                    </span>
                  </TableCell>
                  <TableCell>{a.fullMarks ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={ASSIGNMENT_STATUS_VARIANT[a.status]}>
                      {ASSIGNMENT_STATUS_LABELS[a.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/assignments/${a.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && (
        <CreateAssignmentDialog
          sessionId={session.id}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ["assignments"] });
          }}
        />
      )}
    </div>
  );
}

function CreateAssignmentDialog({
  sessionId,
  onClose,
  onCreated,
}: {
  sessionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const form = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: {
      sessionId,
      sectionId: "",
      subjectId: "",
      type: "HOMEWORK",
      title: "",
      instructions: "",
      assignedAt: nowLocal(),
      dueAt: defaultDueLocal(),
      fullMarks: "",
      allowLate: false,
    },
  });

  const sections = useQuery({
    queryKey: ["sections", sessionId, "assignment-form"],
    queryFn: () => structureApi.sections.list({ sessionId, limit: 100 }),
  });
  const subjects = useQuery({
    queryKey: ["subjects", "assignment-form"],
    queryFn: () => structureApi.subjects.list({ limit: 200 }),
  });

  const create = useMutation({
    mutationFn: (values: AssignmentFormValues) =>
      assignmentApi.create({
        sessionId: values.sessionId,
        sectionId: values.sectionId,
        subjectId: values.subjectId,
        type: values.type,
        title: values.title,
        instructions: values.instructions || undefined,
        assignedAt: localToIso(values.assignedAt),
        dueAt: localToIso(values.dueAt),
        fullMarks: values.fullMarks === "" ? undefined : Number(values.fullMarks),
        allowLate: values.allowLate,
      }),
    onSuccess: () => {
      toast.success("Saved as a draft — publish it when you are ready.");
      onCreated();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const sectionOptions = useMemo(
    () => sections.data?.data ?? [],
    [sections.data],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New assignment</DialogTitle>
          <DialogDescription>
            It is saved as a draft. Nobody sees it until you publish — and
            publishing is what notifies the section.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Section</Label>
              <Select
                value={form.watch("sectionId")}
                onValueChange={(v) =>
                  form.setValue("sectionId", v, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a section" />
                </SelectTrigger>
                <SelectContent>
                  {sectionOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.class?.name ?? ""} {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={form.formState.errors.sectionId?.message} />
            </div>

            <div className="space-y-1">
              <Label>Subject</Label>
              <Select
                value={form.watch("subjectId")}
                onValueChange={(v) =>
                  form.setValue("subjectId", v, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a subject" />
                </SelectTrigger>
                <SelectContent>
                  {(subjects.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={form.formState.errors.subjectId?.message} />
              <p className="text-xs text-muted-foreground">
                You may only set work for a section-subject you teach.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={form.watch("type")}
                onValueChange={(v) =>
                  form.setValue("type", v as AssignmentType, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNMENT_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ASSIGNMENT_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Full marks (leave empty for feedback only)</Label>
              <Input type="number" step="0.01" {...form.register("fullMarks")} />
              <FieldError message={form.formState.errors.fullMarks?.message} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Title</Label>
            <Input {...form.register("title")} maxLength={200} />
            <FieldError message={form.formState.errors.title?.message} />
          </div>

          <div className="space-y-1">
            <Label>Instructions</Label>
            <Textarea rows={5} {...form.register("instructions")} />
            <p className="text-xs text-muted-foreground">
              Basic HTML is allowed and is sanitized when saved, so anything
              unsafe is stripped before a student&rsquo;s browser ever sees it.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Set on</Label>
              <Input type="datetime-local" {...form.register("assignedAt")} />
              <FieldError
                message={form.formState.errors.assignedAt?.message}
              />
            </div>
            <div className="space-y-1">
              <Label>Due</Label>
              <Input type="datetime-local" {...form.register("dueAt")} />
              <FieldError message={form.formState.errors.dueAt?.message} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.watch("allowLate")}
              onCheckedChange={(v) => form.setValue("allowLate", v === true)}
            />
            Accept submissions after the deadline (they are flagged late)
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save draft"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}
