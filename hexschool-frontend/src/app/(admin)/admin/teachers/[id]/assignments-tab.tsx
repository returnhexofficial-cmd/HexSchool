"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  teacherAssignmentsApi,
  teachersApi,
  type Assignment,
} from "@/lib/api/teachers";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";

/**
 * The teacher's slots in the selected session — this doubles as the
 * interim schedule view (periods arrive with M13) — plus the
 * bulk-transfer helper used before resignations.
 */
export function AssignmentsTab({ teacherId }: { teacherId: string }) {
  const { selected: session } = useAcademicSession();
  const queryClient = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<Assignment | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");

  const assignments = useQuery({
    queryKey: ["teacher-assignments", { teacherId, sessionId: session?.id }],
    queryFn: () =>
      teacherAssignmentsApi.list({ sessionId: session!.id, teacherId }),
    enabled: session !== null,
  });

  const colleagues = useQuery({
    queryKey: ["teachers", "active-all"],
    queryFn: () => teachersApi.list({ status: "ACTIVE", limit: 100 }),
    enabled: transferOpen,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["teacher-assignments"] });

  const remove = useMutation({
    mutationFn: (id: string) => teacherAssignmentsApi.remove(id),
    onSuccess: () => {
      toast.success("Assignment removed");
      setRemoveTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const transfer = useMutation({
    mutationFn: () =>
      teacherAssignmentsApi.transfer({
        fromTeacherId: teacherId,
        toTeacherId: transferTo,
        sessionId: session!.id,
      }),
    onSuccess: ({ transferred }) => {
      toast.success(`${transferred} assignment(s) transferred.`);
      setTransferOpen(false);
      setTransferTo("");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (!session) {
    return (
      <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        Assignments are session-scoped — pick an academic session in the header.
      </p>
    );
  }
  if (assignments.isPending) return <LoadingBlock />;
  if (assignments.isError) {
    return (
      <ErrorState
        error={assignments.error}
        onRetry={() => void assignments.refetch()}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Session {session.name} · {assignments.data.length} assignment(s).
          Assign via the{" "}
          <Link href="/admin/teachers/assignments" className="underline">
            assignment matrix
          </Link>
          .
        </p>
        <Can permission="teacher.assign">
          <Button
            variant="outline"
            size="sm"
            disabled={assignments.data.length === 0}
            onClick={() => setTransferOpen(true)}
          >
            Transfer all…
          </Button>
        </Can>
      </div>

      {assignments.data.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No assignments in this session.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-3 py-2 font-medium">Class</th>
                <th className="px-3 py-2 font-medium">Section</th>
                <th className="px-3 py-2 font-medium">Shift</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {assignments.data.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-medium">{a.section.class.name}</td>
                  <td className="px-3 py-2">{a.section.name}</td>
                  <td className="px-3 py-2">{a.section.shift?.name ?? "—"}</td>
                  <td className="px-3 py-2">
                    {a.subject.name}{" "}
                    <Badge variant="outline">{a.subject.code}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Can permission="teacher.assign">
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setRemoveTarget(a)}
                        >
                          Remove
                        </Button>
                      </div>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`Remove ${removeTarget?.subject.name} of ${removeTarget?.section.class.name}-${removeTarget?.section.name}?`}
        confirmLabel="Remove"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (removeTarget) remove.mutate(removeTarget.id);
        }}
      />

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer all assignments</DialogTitle>
            <DialogDescription>
              Moves every assignment of this teacher in session {session.name}{" "}
              to a colleague (used before resignations). The target must cover
              the subjects, or an override is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Target teacher</Label>
            <Select value={transferTo} onValueChange={setTransferTo}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a teacher" />
              </SelectTrigger>
              <SelectContent>
                {(colleagues.data?.data ?? [])
                  .filter((t) => t.id !== teacherId)
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.firstName} {t.lastName} ({t.employeeId})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!transferTo || transfer.isPending}
              onClick={() => transfer.mutate()}
            >
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
