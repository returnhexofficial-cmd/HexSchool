"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import { examTypeApi, type ExamType } from "@/lib/api/exam";
import { examTypeSchema } from "@/lib/validations/exam";

/**
 * The exam-type master list ("Half Yearly", "Class Test"). `weight` is a
 * type's share of a combined final result — Module 15 validates that the
 * weights of the set it merges add up, because only that module knows
 * which types a given report card combines.
 */
export default function ExamTypesPage() {
  const [editing, setEditing] = useState<ExamType | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ExamType | null>(null);
  const qc = useQueryClient();

  const types = useQuery({
    queryKey: ["exam-types"],
    queryFn: () => examTypeApi.list(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => examTypeApi.remove(id),
    onSuccess: () => {
      toast.success("Exam type deleted.");
      void qc.invalidateQueries({ queryKey: ["exam-types"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Exam types"
        description="The kinds of exam this school runs, and their weight in a combined result."
      >
        <Button variant="outline" asChild>
          <Link href="/admin/exams">Back to exams</Link>
        </Button>
        <Can permission="exam.type.manage">
          <Button onClick={() => setCreating(true)}>New exam type</Button>
        </Can>
      </PageHeader>

      {types.isPending ? (
        <LoadingBlock />
      ) : types.isError ? (
        <ErrorState onRetry={() => void types.refetch()} />
      ) : (types.data ?? []).length === 0 ? (
        <EmptyState
          title="No exam types yet"
          description="Add one — every exam hangs off a type."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Weight in combined result</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(types.data ?? []).map((type) => (
                <TableRow key={type.id}>
                  <TableCell className="font-medium">{type.name}</TableCell>
                  <TableCell>
                    {type.weight === null ? (
                      <span className="text-muted-foreground">
                        Not combinable
                      </span>
                    ) : (
                      `${Number(type.weight)}%`
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="exam.type.manage">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(type)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(type)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating || editing ? (
        <ExamTypeDialog
          type={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete "${deleting.name}"?`}
          description="Exam types in use by an exam cannot be deleted — archive those exams first."
          confirmLabel="Delete"
          onConfirm={() => remove.mutate(deleting.id)}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      ) : null}
    </main>
  );
}

function ExamTypeDialog({
  type,
  onClose,
}: {
  type: ExamType | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(type?.name ?? "");
  const [weight, setWeight] = useState(
    type?.weight === null || type?.weight === undefined
      ? ""
      : String(Number(type.weight)),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const parsed = examTypeSchema.safeParse({
        name: name.trim(),
        ...(weight === "" ? {} : { weight: Number(weight) }),
      });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return type
        ? examTypeApi.update(type.id, {
            name: parsed.data.name,
            weight: parsed.data.weight ?? null,
          })
        : examTypeApi.create(parsed.data);
    },
    onSuccess: () => {
      toast.success(type ? "Exam type updated." : "Exam type created.");
      void qc.invalidateQueries({ queryKey: ["exam-types"] });
      onClose();
    },
    onError: (err: Error) =>
      setError(err.message.startsWith("Invalid") ? err.message : apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type ? "Edit exam type" : "New exam type"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="exam-type-name">Name</Label>
          <Input
            id="exam-type-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Half Yearly"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="exam-type-weight">Weight (%)</Label>
          <Input
            id="exam-type-weight"
            type="number"
            min={0}
            max={100}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="Leave blank if not combinable"
          />
          <p className="text-xs text-muted-foreground">
            Its share of a combined final result. Whether a set of weights adds
            to 100 is checked when Module 15 combines them.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
