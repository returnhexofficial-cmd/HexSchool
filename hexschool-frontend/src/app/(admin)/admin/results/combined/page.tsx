"use client";

import { useMemo, useState } from "react";
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
import { apiErrorMessage } from "@/lib/api/auth";
import { examApi } from "@/lib/api/exam";
import { combinedResultApi } from "@/lib/api/result";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import {
  RESULT_STATUS_LABELS,
  RESULT_STATUS_VARIANT,
  weightError,
} from "@/lib/validations/result";

/**
 * Weighted final results — "Annual = 30 % Half-Yearly + 70 % Annual"
 * (roadmap M15 §3).
 *
 * The weight set is frozen onto every generated row, so editing an exam
 * type's weight later can never restate a final result already issued —
 * the same argument that freezes the grading snapshot.
 */
export default function CombinedResultsPage() {
  const qc = useQueryClient();
  const { selected } = useAcademicSession();
  const sessionId = selected?.id;

  const [name, setName] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [batchName, setBatchName] = useState("");

  const batches = useQuery({
    queryKey: ["combined-batches", sessionId],
    queryFn: () => combinedResultApi.batches(sessionId),
    enabled: Boolean(sessionId),
  });

  const exams = useQuery({
    queryKey: ["exams-for-combine", sessionId],
    queryFn: () => examApi.list({ sessionId, limit: 100 }),
    enabled: Boolean(sessionId),
  });

  const rows = useQuery({
    queryKey: ["combined-results", sessionId, name],
    queryFn: () => combinedResultApi.list({ name, sessionId }),
    enabled: Boolean(sessionId) && name !== "",
  });

  const weights = useMemo(() => Object.values(picked), [picked]);
  const weightIssue = generateOpen ? weightError(weights) : null;

  const generate = useMutation({
    mutationFn: () =>
      combinedResultApi.generate({
        name: batchName.trim(),
        sessionId,
        components: Object.entries(picked).map(([examId, weight]) => ({
          examId,
          weight,
        })),
      }),
    onSuccess: (result) => {
      setGenerateOpen(false);
      setName(result.name);
      setPicked({});
      setBatchName("");
      toast.success(
        `${result.generated} final result(s) generated` +
          (result.skipped.length > 0
            ? ` · ${result.skipped.length} skipped (missing a component result)`
            : ""),
      );
      void qc.invalidateQueries({ queryKey: ["combined-batches", sessionId] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (!sessionId) {
    return (
      <ErrorState title="Pick an academic session — final results are generated per session." />
    );
  }

  const publishedExams = (exams.data?.data ?? []).filter(
    (exam) => exam.status === "PUBLISHED" || exam.status === "PROCESSING",
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Final Results"
        description="Merge several exams into one weighted final result."
      >
        <Can permission="result.combine">
          <Button onClick={() => setGenerateOpen(true)}>Generate</Button>
        </Can>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-65">
          <Label className="mb-1 block text-xs">Batch</Label>
          <Select value={name} onValueChange={setName}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a generated batch" />
            </SelectTrigger>
            <SelectContent>
              {(batches.data ?? []).map((batch) => (
                <SelectItem key={batch.name} value={batch.name}>
                  {batch.name} ({batch.candidates})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {batches.isLoading ? (
        <LoadingBlock />
      ) : (batches.data ?? []).length === 0 ? (
        <EmptyState
          title="No final results yet"
          description="Generate one from two or more processed exams."
        />
      ) : name === "" ? (
        <EmptyState
          title="Pick a batch"
          description="Choose a generated final result above."
        />
      ) : rows.isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Roll</th>
                <th className="px-3 py-2 text-left font-medium">Student</th>
                <th className="px-3 py-2 text-left font-medium">Class</th>
                <th className="px-3 py-2 text-right font-medium">Weighted %</th>
                <th className="px-3 py-2 text-right font-medium">GPA</th>
                <th className="px-3 py-2 text-left font-medium">Grade</th>
                <th className="px-3 py-2 text-right font-medium">Merit</th>
                <th className="px-3 py-2 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {(rows.data ?? []).map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-1.5">{row.enrollment.rollNo}</td>
                  <td className="px-3 py-1.5">
                    {row.enrollment.student.firstName}{" "}
                    {row.enrollment.student.lastName}
                  </td>
                  <td className="px-3 py-1.5">
                    {row.enrollment.class.name} — {row.enrollment.section.name}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {Number(row.obtainedMarks).toFixed(2)}%
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium">
                    {Number(row.gpa).toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5">{row.grade}</td>
                  <td className="px-3 py-1.5 text-right">
                    {row.meritPositionClass === null
                      ? "—"
                      : `#${row.meritPositionClass}`}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={RESULT_STATUS_VARIANT[row.status]}>
                      {RESULT_STATUS_LABELS[row.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate a final result</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="batch-name">Name</Label>
              <Input
                id="batch-name"
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                placeholder="Final Result 2026"
              />
            </div>

            <div className="space-y-2">
              <Label>Exams and their weights</Label>
              {publishedExams.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No processed exams in this session yet.
                </p>
              )}
              {publishedExams.map((exam) => {
                const checked = exam.id in picked;
                return (
                  <div key={exam.id} className="flex items-center gap-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        setPicked((current) => {
                          const next = { ...current };
                          if (value === true) {
                            next[exam.id] = Number(exam.examType.weight ?? 50);
                          } else {
                            delete next[exam.id];
                          }
                          return next;
                        })
                      }
                    />
                    <span className="flex-1 text-sm">{exam.name}</span>
                    <Input
                      className="h-8 w-20 text-right"
                      inputMode="decimal"
                      disabled={!checked}
                      value={checked ? String(picked[exam.id]) : ""}
                      onChange={(e) =>
                        setPicked((current) => ({
                          ...current,
                          [exam.id]: Number(e.target.value),
                        }))
                      }
                    />
                    <span className="text-muted-foreground text-sm">%</span>
                  </div>
                );
              })}
              {weightIssue && (
                <p className="text-destructive text-sm">{weightIssue}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                generate.isPending ||
                weightIssue !== null ||
                batchName.trim().length < 2
              }
              onClick={() => generate.mutate()}
            >
              {generate.isPending && <Spinner className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
