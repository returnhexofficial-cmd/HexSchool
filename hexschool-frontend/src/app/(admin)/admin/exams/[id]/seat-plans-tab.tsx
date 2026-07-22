"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock, Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import { examApi, type SeatPlanStrategy } from "@/lib/api/exam";
import {
  generateSeatPlanSchema,
  SEAT_PLAN_STRATEGIES,
  SEAT_PLAN_STRATEGY_LABELS,
} from "@/lib/validations/exam";

/**
 * Seat plans per sitting date: room boxes with seat chips. Regenerating
 * replaces the whole date, which is why appending a late enrollee is a
 * separate action — regeneration would move every other student and
 * invalidate admit cards already printed.
 */
export function SeatPlansTab({ examId }: { examId: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const routine = useQuery({
    queryKey: ["exam-routine", examId],
    queryFn: () => examApi.routine(examId),
  });

  const dates = (routine.data?.days ?? []).map((d) => d.date);
  const activeDate = date || dates[0] || "";

  const plans = useQuery({
    queryKey: ["exam-seat-plans", examId, activeDate],
    queryFn: () => examApi.seatPlans(examId, activeDate),
    enabled: !!activeDate,
  });

  const candidates = useQuery({
    queryKey: ["exam-seat-candidates", examId, activeDate],
    queryFn: () => examApi.seatPlanCandidates(examId, activeDate),
    enabled: !!activeDate,
  });

  const remove = useMutation({
    mutationFn: () => examApi.removeSeatPlan(examId, activeDate),
    onSuccess: () => {
      toast.success("Seat plan deleted.");
      void qc.invalidateQueries({ queryKey: ["exam-seat-plans", examId] });
      void qc.invalidateQueries({ queryKey: ["exam", examId] });
      setDeleteOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (routine.isPending) return <LoadingBlock />;

  if (dates.length === 0) {
    return (
      <EmptyState
        title="No sitting dates yet"
        description="Schedule the papers first — a seat plan is built per exam date."
      />
    );
  }

  const seated = (plans.data ?? []).reduce(
    (sum, plan) => sum + plan.entries.length,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52 space-y-1">
          <Label>Sitting date</Label>
          <Select value={activeDate} onValueChange={setDate}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dates.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Can permission="exam.seat-plan.manage">
          <Button onClick={() => setGenerateOpen(true)}>
            {(plans.data ?? []).length > 0 ? "Regenerate" : "Generate"}
          </Button>
        </Can>
        <Can permission="exam.export">
          <Button
            variant="outline"
            disabled={(plans.data ?? []).length === 0}
            onClick={() =>
              void examApi
                .downloadSeatPlan(examId, activeDate)
                .catch((err) => toast.error(apiErrorMessage(err)))
            }
          >
            Seat plan PDF
          </Button>
        </Can>
        {(plans.data ?? []).length > 0 ? (
          <Can permission="exam.seat-plan.manage">
            <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
              Delete plan
            </Button>
          </Can>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        {candidates.data?.length ?? 0} candidate(s) sit a paper on {activeDate}
        {seated > 0 ? ` · ${seated} seated` : ""}. Optional-subject papers are
        only sat by the students who chose them.
      </p>

      {plans.isPending ? (
        <LoadingBlock />
      ) : (plans.data ?? []).length === 0 ? (
        <EmptyState
          title="No seat plan for this date"
          description="Generate one — you choose the rooms, their capacity and the seating layout."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(plans.data ?? []).map((plan) => (
            <div key={plan.id} className="rounded-md border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                <span className="font-medium">Room {plan.room}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {plan.entries.length}/{plan.capacity}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {plan.strategy === "INTERLEAVE" ? "Mixed" : "Serpentine"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 p-3">
                {plan.entries.map((entry) => (
                  <span
                    key={entry.id}
                    title={`${entry.enrollment.student.firstName} ${entry.enrollment.student.lastName} · ${entry.enrollment.class.name}-${entry.enrollment.section.name} · Roll ${entry.enrollment.rollNo}`}
                    className="rounded border px-1.5 py-0.5 text-xs tabular-nums"
                  >
                    <span className="text-muted-foreground">
                      {entry.seatNo}.
                    </span>{" "}
                    {entry.enrollment.student.studentUid}
                  </span>
                ))}
                {plan.entries.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No candidates seated in this room.
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {generateOpen ? (
        <GenerateDialog
          examId={examId}
          date={activeDate}
          candidateCount={candidates.data?.length ?? 0}
          onClose={() => setGenerateOpen(false)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete the seat plan for ${activeDate}?`}
        description="Any admit cards already printed will no longer match a seat."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function GenerateDialog({
  examId,
  date,
  candidateCount,
  onClose,
}: {
  examId: string;
  date: string;
  candidateCount: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [rooms, setRooms] = useState([{ room: "", capacity: 30 }]);
  const [strategy, setStrategy] = useState<SeatPlanStrategy>("SERPENTINE");
  const [error, setError] = useState<string | null>(null);

  const capacity = rooms.reduce((sum, r) => sum + (r.capacity || 0), 0);

  const generate = useMutation({
    mutationFn: () => {
      const parsed = generateSeatPlanSchema.safeParse({
        date,
        rooms: rooms.map((r) => ({ ...r, room: r.room.trim() })),
        strategy,
      });
      if (!parsed.success) {
        return Promise.reject(
          new Error(parsed.error.issues[0]?.message ?? "Invalid input"),
        );
      }
      return examApi.generateSeatPlan(examId, parsed.data);
    },
    onSuccess: (result) => {
      toast.success(
        `${result.seated} candidate(s) seated across ${result.rooms} room(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["exam-seat-plans", examId] });
      void qc.invalidateQueries({ queryKey: ["exam", examId] });
      onClose();
    },
    onError: (err: Error) => setError(apiErrorMessage(err) || err.message),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate seat plan for {date}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          <Label>Layout</Label>
          <Select
            value={strategy}
            onValueChange={(v) => setStrategy(v as SeatPlanStrategy)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEAT_PLAN_STRATEGIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SEAT_PLAN_STRATEGY_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Serpentine keeps each class together in roll order and snakes
            across rooms. Interleave mixes the classes so no two neighbours sit
            the same paper.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Rooms</Label>
          {rooms.map((room, index) => (
            <div key={index} className="flex gap-2">
              <Input
                placeholder="Room name"
                maxLength={20}
                value={room.room}
                onChange={(e) =>
                  setRooms((prev) =>
                    prev.map((r, i) =>
                      i === index ? { ...r, room: e.target.value } : r,
                    ),
                  )
                }
              />
              <Input
                type="number"
                min={1}
                className="w-28"
                value={room.capacity}
                onChange={(e) =>
                  setRooms((prev) =>
                    prev.map((r, i) =>
                      i === index
                        ? { ...r, capacity: Number(e.target.value) }
                        : r,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={rooms.length === 1}
                onClick={() =>
                  setRooms((prev) => prev.filter((_, i) => i !== index))
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRooms((prev) => [...prev, { room: "", capacity: 30 }])
            }
          >
            Add room
          </Button>
        </div>

        <p
          className={
            capacity < candidateCount
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {capacity} seat(s) for {candidateCount} candidate(s)
          {capacity < candidateCount
            ? " — add rooms or capacity before generating."
            : ""}
        </p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={generate.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={
              rooms.some((r) => !r.room.trim()) ||
              capacity < candidateCount ||
              generate.isPending
            }
            onClick={() => {
              setError(null);
              generate.mutate();
            }}
          >
            {generate.isPending ? <Spinner className="mr-1 size-4" /> : null}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
