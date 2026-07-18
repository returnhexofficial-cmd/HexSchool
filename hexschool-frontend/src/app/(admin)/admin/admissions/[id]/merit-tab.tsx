"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  admissionCyclesApi,
  APPLICATION_STATUS_LABELS,
  type AdmissionApplication,
  type AdmissionCycle,
} from "@/lib/api/admissions";
import { apiErrorMessage } from "@/lib/api/auth";

/** Merit + waiting lists per class: generate (regeneration voids the
 *  previous list), inspect, promote from the waitlist. */
export function MeritTab({ cycle }: { cycle: AdmissionCycle }) {
  const queryClient = useQueryClient();
  const [classId, setClassId] = useState(cycle.classes[0]?.classId ?? "");
  const [confirmGenerate, setConfirmGenerate] = useState(false);

  const merit = useQuery({
    queryKey: ["admission-merit", cycle.id, classId],
    queryFn: () => admissionCyclesApi.meritList(cycle.id, classId),
    enabled: !!classId,
  });
  const waiting = useQuery({
    queryKey: ["admission-waiting", cycle.id, classId],
    queryFn: () => admissionCyclesApi.waitingList(cycle.id, classId),
    enabled: !!classId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admission-merit"] });
    void queryClient.invalidateQueries({ queryKey: ["admission-waiting"] });
    void queryClient.invalidateQueries({
      queryKey: ["admission-applications"],
    });
  };

  const generate = useMutation({
    mutationFn: () => admissionCyclesApi.generateMeritList(cycle.id, classId),
    onSuccess: (result) => {
      toast.success(
        `Merit list ${result.regenerated ? "regenerated" : "generated"}: ${result.selected} selected, ${result.waitlisted} waitlisted (SMS queued).`,
      );
      setConfirmGenerate(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const promote = useMutation({
    mutationFn: () => admissionCyclesApi.promoteWaitlist(cycle.id, classId, 1),
    onSuccess: (promoted) => {
      toast.success(
        promoted.length > 0
          ? `${promoted[0].applicationNo} promoted from the waiting list.`
          : "No waitlisted candidates to promote.",
      );
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const cycleClass = cycle.classes.find((c) => c.classId === classId);

  const listTable = (
    rows: AdmissionApplication[] | undefined,
    isPending: boolean,
    empty: string,
  ) =>
    isPending ? (
      <Spinner />
    ) : !rows || rows.length === 0 ? (
      <EmptyState title={empty} />
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Application No</TableHead>
            <TableHead>Applicant</TableHead>
            <TableHead>Marks</TableHead>
            <TableHead>Prev. GPA</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((app) => (
            <TableRow key={app.id}>
              <TableCell>{app.meritPosition ?? "—"}</TableCell>
              <TableCell>{app.applicationNo}</TableCell>
              <TableCell>
                {app.firstName} {app.lastName}
              </TableCell>
              <TableCell>
                {app.testMarks === null
                  ? "—"
                  : Number(app.testMarks).toFixed(1)}
              </TableCell>
              <TableCell>
                {app.previousGpa === null
                  ? "—"
                  : Number(app.previousGpa).toFixed(2)}
              </TableCell>
              <TableCell>
                {app.admissionDeadline
                  ? app.admissionDeadline.slice(0, 10)
                  : "—"}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    app.status === "ADMITTED"
                      ? "default"
                      : app.status === "EXPIRED"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {APPLICATION_STATUS_LABELS[app.status]}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Label>Class</Label>
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Pick a class" />
          </SelectTrigger>
          <SelectContent>
            {cycle.classes.map((c) => (
              <SelectItem key={c.classId} value={c.classId}>
                {c.class.name} ({c.seats} seats)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Can permission="admission.merit.generate">
          <Button
            disabled={!classId || generate.isPending}
            onClick={() => setConfirmGenerate(true)}
          >
            Generate merit list
          </Button>
          <Button
            variant="outline"
            disabled={!classId || promote.isPending}
            onClick={() => promote.mutate()}
          >
            Promote next waitlisted
          </Button>
        </Can>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Merit list{cycleClass ? ` — ${cycleClass.class.name}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {listTable(
            merit.data,
            merit.isPending && !!classId,
            "No merit list yet — close the cycle, lock test marks, then generate.",
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waiting list</CardTitle>
        </CardHeader>
        <CardContent>
          {listTable(
            waiting.data,
            waiting.isPending && !!classId,
            "Waiting list is empty.",
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        title="Generate the merit list?"
        description="Ranking: test marks → previous GPA → age (older first). SELECTED up to the seat count, the rest WAITLISTED. Regenerating voids the current list (ADMITTED rows keep their seats). Applicants are notified by SMS."
        confirmLabel="Generate"
        isPending={generate.isPending}
        onConfirm={() => generate.mutate()}
      />
    </div>
  );
}
