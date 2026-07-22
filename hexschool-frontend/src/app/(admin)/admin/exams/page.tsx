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
import { examApi, examTypeApi, type ExamStatus } from "@/lib/api/exam";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import {
  EXAM_STATUS_LABELS,
  EXAM_STATUS_VARIANT,
  EXAM_STATUSES,
  examSchema,
} from "@/lib/validations/exam";

/**
 * Exams of the selected session. An exam walks a straight-line status
 * machine (Draft → Scheduled → Ongoing → Mark entry → Processing →
 * Published), and its papers can only be reshaped while it is still
 * being built.
 */
export default function ExamsPage() {
  const { selected: session } = useAcademicSession();
  const sessionId = session?.id ?? "";
  const router = useRouter();

  const [status, setStatus] = useState<ExamStatus | "">("");
  const [examTypeId, setExamTypeId] = useState("");
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const types = useQuery({
    queryKey: ["exam-types"],
    queryFn: () => examTypeApi.list(),
    staleTime: 60_000,
  });

  const exams = useQuery({
    queryKey: ["exams", { sessionId, status, examTypeId, search }],
    queryFn: () =>
      examApi.list({
        sessionId,
        limit: 50,
        ...(status ? { status } : {}),
        ...(examTypeId ? { examTypeId } : {}),
        ...(search ? { search } : {}),
      }),
    enabled: !!sessionId,
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Examinations"
        description={
          session
            ? `Exams, routines, seat plans and admit cards for ${session.name}`
            : "Select a session from the header switcher"
        }
      >
        <Can permission="exam.view">
          <Button variant="outline" asChild>
            <Link href="/admin/exams/types">Exam types</Link>
          </Button>
        </Can>
        <Can permission="exam.manage">
          <Button
            disabled={!sessionId || (types.data ?? []).length === 0}
            onClick={() => setNewOpen(true)}
          >
            New exam
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
              <Label>Exam type</Label>
              <Select
                value={examTypeId || "ALL"}
                onValueChange={(v) => setExamTypeId(v === "ALL" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {(types.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
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
                  setStatus(v === "ALL" ? "" : (v as ExamStatus))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {EXAM_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {EXAM_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-60 space-y-1">
              <Label htmlFor="exam-search">Search</Label>
              <Input
                id="exam-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Exam name"
              />
            </div>
          </div>

          {types.data?.length === 0 ? (
            <EmptyState
              title="No exam types configured"
              description="Every exam hangs off a type — add one first."
            />
          ) : exams.isPending ? (
            <LoadingBlock />
          ) : exams.isError ? (
            <ErrorState onRetry={() => void exams.refetch()} />
          ) : (exams.data?.data ?? []).length === 0 ? (
            <EmptyState
              title="No exams yet"
              description="Create one — papers are seeded from each class's curriculum."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Exam</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Window</TableHead>
                    <TableHead>Classes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(exams.data?.data ?? []).map((exam) => (
                    <TableRow key={exam.id}>
                      <TableCell className="font-medium">{exam.name}</TableCell>
                      <TableCell>{exam.examType.name}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {exam.startDate} → {exam.endDate}
                      </TableCell>
                      <TableCell>
                        {exam.examClasses.length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          exam.examClasses.map((c) => c.class.name).join(", ")
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={EXAM_STATUS_VARIANT[exam.status]}>
                          {EXAM_STATUS_LABELS[exam.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`/admin/exams/${exam.id}`}>Open</Link>
                        </Button>
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
        <NewExamDialog
          sessionId={sessionId}
          onClose={() => setNewOpen(false)}
          onCreated={(id) => router.push(`/admin/exams/${id}`)}
        />
      ) : null}
    </main>
  );
}

function NewExamDialog({
  sessionId,
  onClose,
  onCreated,
}: {
  sessionId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [examTypeId, setExamTypeId] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ["exam-types"],
    queryFn: () => examTypeApi.list(),
    staleTime: 60_000,
  });

  const classes = useQuery({
    queryKey: ["classes", "all"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () => {
      const parsed = examSchema.safeParse({
        examTypeId,
        name: name.trim(),
        startDate,
        endDate,
        classIds,
      });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return examApi.create({
        examTypeId: parsed.data.examTypeId,
        name: parsed.data.name,
        sessionId,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        classIds: parsed.data.classIds,
      });
    },
    onSuccess: (created) => {
      toast.success("Exam created — papers seeded from the curriculum.");
      void qc.invalidateQueries({ queryKey: ["exams"] });
      onCreated(created.id);
    },
    onError: (err: Error) => setError(apiErrorMessage(err) || err.message),
  });

  const toggleClass = (id: string) =>
    setClassIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New exam</DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          <Label>Exam type</Label>
          <Select value={examTypeId || undefined} onValueChange={setExamTypeId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a type" />
            </SelectTrigger>
            <SelectContent>
              {(types.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="exam-name">Name</Label>
          <Input
            id="exam-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Half Yearly 2026"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="exam-start">Start date</Label>
            <Input
              id="exam-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="exam-end">End date</Label>
            <Input
              id="exam-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Classes sitting this exam</Label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
            {(classes.data?.data ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={classIds.includes(c.id)}
                  onCheckedChange={() => toggleClass(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            One paper per curriculum subject is seeded for each class you
            attach. You can adjust the marks and dates afterwards.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={
              !examTypeId ||
              !name.trim() ||
              !startDate ||
              !endDate ||
              create.isPending
            }
            onClick={() => {
              setError(null);
              create.mutate();
            }}
          >
            {create.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Create exam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
