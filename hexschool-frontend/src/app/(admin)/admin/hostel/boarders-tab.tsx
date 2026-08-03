"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { apiErrorMessage } from "@/lib/api/auth";
import { enrollmentApi } from "@/lib/api/enrollment";
import {
  ALLOCATION_STATUS_LABELS,
  ALLOCATION_STATUS_VARIANT,
  allocationApi,
  formatBdt,
  hostelApi,
  messApi,
  type Allocation,
  type AllocationStatus,
} from "@/lib/api/hostel";

/**
 * The boarders list, and every lifecycle action on one.
 *
 * **Suspend and vacate are different buttons because they are different
 * facts**: a suspended boarder has gone home for a term and is still
 * holding their bed, while a vacated one has left and the bed is free. A
 * single "status" dropdown would put those behind one permission and one
 * confirmation, and the school would eventually free a bed it meant to
 * keep.
 *
 * The **warnings the server returns are surfaced, not swallowed** — an
 * allocation made under override, a vacate with dues still outstanding
 * and a meal-off left undecided all come back as sentences, and each one
 * is something a person has to see.
 */
export function BoardersTab() {
  const { selected: session } = useAcademicSession();
  const [status, setStatus] = useState<AllocationStatus | "">("");
  const [hostelId, setHostelId] = useState("");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<{
    allocation: Allocation;
    action: "transfer" | "suspend" | "resume" | "vacate" | "refund";
  } | null>(null);

  const hostels = useQuery({
    queryKey: ["hostels"],
    queryFn: () => hostelApi.list(),
  });

  const list = useQuery({
    queryKey: ["hostel-allocations", { status, hostelId, search, sessionId: session?.id }],
    queryFn: () =>
      allocationApi.list({
        limit: 100,
        status: status || undefined,
        hostelId: hostelId || undefined,
        search: search || undefined,
        sessionId: session?.id,
      }),
  });

  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="boarder-hostel">Hostel</Label>
          <select
            id="boarder-hostel"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={hostelId}
            onChange={(e) => setHostelId(e.target.value)}
          >
            <option value="">All hostels</option>
            {(hostels.data ?? []).map((summary) => (
              <option key={summary.hostel.id} value={summary.hostel.id}>
                {summary.hostel.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="boarder-status">Status</Label>
          <select
            id="boarder-status"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as AllocationStatus | "")}
          >
            <option value="">All</option>
            <option value="ACTIVE">Living in</option>
            <option value="SUSPENDED">Away — bed held</option>
            <option value="VACATED">Moved out</option>
          </select>
        </div>

        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="boarder-search">Search</Label>
          <Input
            id="boarder-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or student ID"
          />
        </div>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No boarders match"
          description="Open a hostel and click a free bed to put a student in it."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3 font-medium">Student</th>
                <th className="p-3 font-medium">Class</th>
                <th className="p-3 font-medium">Where</th>
                <th className="p-3 font-medium">Since</th>
                <th className="p-3 font-medium">Rent</th>
                <th className="p-3 font-medium">Mess</th>
                <th className="p-3 font-medium">Deposit</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const mess = row.messEnrollments.find((m) => !m.endDate);
                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-3">
                      <div className="font-medium">
                        {row.enrollment.student.firstName}{" "}
                        {row.enrollment.student.lastName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.enrollment.student.studentUid}
                      </div>
                    </td>
                    <td className="p-3">
                      {row.enrollment.class.name}
                      {row.enrollment.section
                        ? ` ${row.enrollment.section.name}`
                        : ""}
                      {row.enrollment.rollNo
                        ? ` · roll ${row.enrollment.rollNo}`
                        : ""}
                    </td>
                    <td className="p-3">
                      {row.hostel.name}
                      <div className="text-xs text-muted-foreground">
                        Room {row.bed.room.roomNo} · bed {row.bed.bedNo}
                      </div>
                    </td>
                    <td className="p-3">{row.startDate}</td>
                    <td className="p-3">
                      ৳{formatBdt(row.bed.room.monthlyFee)}
                    </td>
                    <td className="p-3">
                      {mess ? (
                        <>
                          {mess.plan.name}
                          <div className="text-xs text-muted-foreground">
                            ৳{formatBdt(mess.plan.monthlyCharge)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      ৳{formatBdt(row.securityDeposit)}
                      {row.depositRefunded && (
                        <div className="text-xs text-muted-foreground">
                          ৳{formatBdt(row.depositRefundAmount)} returned
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge variant={ALLOCATION_STATUS_VARIANT[row.status]}>
                        {ALLOCATION_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {row.status !== "VACATED" && (
                          <Can permission="hostel.allocate">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setActing({
                                  allocation: row,
                                  action: "transfer",
                                })
                              }
                            >
                              Move
                            </Button>
                            {row.status === "ACTIVE" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setActing({
                                    allocation: row,
                                    action: "suspend",
                                  })
                                }
                              >
                                Suspend
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setActing({
                                    allocation: row,
                                    action: "resume",
                                  })
                                }
                              >
                                Resume
                              </Button>
                            )}
                          </Can>
                        )}
                        {row.status !== "VACATED" && (
                          <Can permission="hostel.vacate">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setActing({ allocation: row, action: "vacate" })
                              }
                            >
                              Vacate
                            </Button>
                          </Can>
                        )}
                        {row.status === "VACATED" &&
                          !row.depositRefunded &&
                          Number(row.securityDeposit) > 0 && (
                            <Can permission="hostel.deposit.refund">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setActing({
                                    allocation: row,
                                    action: "refund",
                                  })
                                }
                              >
                                Refund deposit
                              </Button>
                            </Can>
                          )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {acting && (
        <ActionDialog
          allocation={acting.allocation}
          action={acting.action}
          onClose={() => setActing(null)}
        />
      )}
    </div>
  );
}

/**
 * Allocation from a bed the warden clicked on the occupancy grid. The bed
 * is fixed; the student is the question — which is the right way round,
 * because the grid is where a warden decides "who goes in B3".
 */
export function AllocateDialog({
  bedId,
  onClose,
}: {
  bedId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { selected: session } = useAcademicSession();
  const [enrollmentId, setEnrollmentId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [messPlanId, setMessPlanId] = useState("");
  const [override, setOverride] = useState(false);
  const [search, setSearch] = useState("");

  const candidates = useQuery({
    queryKey: ["hostel-enrollable", session?.id, search],
    queryFn: () =>
      enrollmentApi.list({
        sessionId: session?.id,
        status: "ACTIVE",
        search: search || undefined,
        limit: 50,
      }),
    enabled: Boolean(session?.id),
  });

  const plans = useQuery({
    queryKey: ["mess-plans"],
    queryFn: () => messApi.plans({ status: "ACTIVE" }),
  });

  const allocate = useMutation({
    mutationFn: () =>
      allocationApi.create({
        enrollmentId,
        bedId,
        startDate: startDate || undefined,
        securityDeposit: deposit === "" ? undefined : Number(deposit),
        messPlanId: messPlanId || undefined,
        override: override || undefined,
      }),
    onSuccess: (result) => {
      toast.success("Bed allocated");
      // Warnings are surfaced, never swallowed: an allocation made under
      // override is a decision with a name on it and the person who made
      // it should see it echoed back.
      for (const warning of result.warnings) toast.warning(warning);
      void qc.invalidateQueries({ queryKey: ["hostel"] });
      void qc.invalidateQueries({ queryKey: ["hostels"] });
      void qc.invalidateQueries({ queryKey: ["hostel-allocations"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const rows = candidates.data?.data ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Give this bed to a student</DialogTitle>
          <DialogDescription>
            A boy cannot be put in the girls&rsquo; hostel and no permission
            gets past that. A room under repair, an inactive building or a
            gender the record does not match need an override.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="alloc-search">Find a student</Label>
            <Input
              id="alloc-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or student ID"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="alloc-student">Student</Label>
            <select
              id="alloc-student"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={enrollmentId}
              onChange={(e) => setEnrollmentId(e.target.value)}
            >
              <option value="">Pick a student…</option>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.student.firstName} {row.student.lastName} ·{" "}
                  {row.student.studentUid} · {row.class?.name ?? ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="alloc-start">Moving in</Label>
              <Input
                id="alloc-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="alloc-deposit">Security deposit (BDT)</Label>
              <Input
                id="alloc-deposit"
                type="number"
                min={0}
                step="0.01"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
                placeholder="School default"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="alloc-mess">Mess plan (optional)</Label>
            <select
              id="alloc-mess"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={messPlanId}
              onChange={(e) => setMessPlanId(e.target.value)}
            >
              <option value="">No mess plan</option>
              {(plans.data ?? []).map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} · ৳{formatBdt(plan.monthlyCharge)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Only plans of this building can be picked — the database
              enforces it.
            </p>
          </div>

          <Can permission="hostel.allocate.override">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Allocate past a maintenance or gender refusal (recorded against
              your name)
            </label>
          </Can>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => allocate.mutate()}
            disabled={allocate.isPending || !enrollmentId}
          >
            {allocate.isPending ? "Allocating…" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({
  allocation,
  action,
  onClose,
}: {
  allocation: Allocation;
  action: "transfer" | "suspend" | "resume" | "vacate" | "refund";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [bedId, setBedId] = useState("");
  const [override, setOverride] = useState(false);
  const [deductAmount, setDeductAmount] = useState("");
  const [deductReason, setDeductReason] = useState("");

  const rooms = useQuery({
    queryKey: ["hostel", allocation.hostelId, "rooms"],
    queryFn: () => hostelApi.rooms(allocation.hostelId),
    enabled: action === "transfer",
  });

  const freeBeds = (rooms.data ?? []).flatMap((room) =>
    room.status === "ACTIVE"
      ? room.beds
          .filter((bed) => !bed.held && bed.status === "VACANT")
          .map((bed) => ({ id: bed.id, label: `${room.roomNo} · ${bed.bedNo}` }))
      : [],
  );

  const run = useMutation({
    mutationFn: async () => {
      switch (action) {
        case "transfer":
          return allocationApi.transfer(allocation.id, {
            bedId,
            reason,
            override: override || undefined,
          });
        case "suspend":
          return allocationApi.suspend(allocation.id, {
            reason,
            effectiveDate: date || undefined,
          });
        case "resume":
          return allocationApi.resume(allocation.id, {
            effectiveDate: date || undefined,
          });
        case "vacate":
          return allocationApi.vacate(allocation.id, {
            reason,
            endDate: date || undefined,
            override: override || undefined,
          });
        default:
          return allocationApi.refundDeposit(allocation.id, {
            deductions:
              deductAmount && Number(deductAmount) > 0
                ? [{ amount: Number(deductAmount), reason: deductReason }]
                : undefined,
            refundedAt: date || undefined,
          });
      }
    },
    onSuccess: (result) => {
      toast.success("Done");
      const warnings =
        result && typeof result === "object" && "warnings" in result
          ? ((result as { warnings?: string[] }).warnings ?? [])
          : [];
      for (const warning of warnings) toast.warning(warning);
      void qc.invalidateQueries({ queryKey: ["hostel"] });
      void qc.invalidateQueries({ queryKey: ["hostels"] });
      void qc.invalidateQueries({ queryKey: ["hostel-allocations"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const student = `${allocation.enrollment.student.firstName} ${allocation.enrollment.student.lastName}`;
  const titles: Record<typeof action, string> = {
    transfer: `Move ${student} to another bed`,
    suspend: `Suspend ${student}'s residency`,
    resume: `${student} is back`,
    vacate: `${student} is moving out`,
    refund: `Return ${student}'s deposit`,
  };
  const descriptions: Record<typeof action, string> = {
    transfer:
      "The dates do not change — they have been here since they moved in, and restarting the window would re-bill them for the month.",
    suspend:
      "Billing pauses from this date and the bed stays theirs. Only vacating frees it.",
    resume: "Billing resumes from this date.",
    vacate:
      "The bed is released and the mess enrolment closed. Outstanding fees are checked, and stay on the ledger either way.",
    refund:
      "You cannot hand back more than was taken, and every deduction needs a reason on it.",
  };

  const needsReason = action === "transfer" || action === "suspend" || action === "vacate";
  const canSubmit =
    (!needsReason || reason.trim().length >= 3) &&
    (action !== "transfer" || bedId !== "") &&
    (action !== "refund" ||
      !deductAmount ||
      Number(deductAmount) === 0 ||
      deductReason.trim().length >= 3);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titles[action]}</DialogTitle>
          <DialogDescription>{descriptions[action]}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {action === "transfer" && (
            <div className="grid gap-1.5">
              <Label htmlFor="act-bed">New bed</Label>
              <select
                id="act-bed"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={bedId}
                onChange={(e) => setBedId(e.target.value)}
              >
                <option value="">Pick a free bed…</option>
                {freeBeds.map((bed) => (
                  <option key={bed.id} value={bed.id}>
                    {bed.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Only beds in {allocation.hostel.name}. Moving to another
                building means vacating and allocating again, so the deposit
                and the mess plan move with them.
              </p>
            </div>
          )}

          {action !== "transfer" && (
            <div className="grid gap-1.5">
              <Label htmlFor="act-date">
                {action === "vacate"
                  ? "Last day"
                  : action === "refund"
                    ? "Refunded on"
                    : "Effective from"}
              </Label>
              <Input
                id="act-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          )}

          {needsReason && (
            <div className="grid gap-1.5">
              <Label htmlFor="act-reason">Reason</Label>
              <Input
                id="act-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why?"
              />
            </div>
          )}

          {action === "refund" && (
            <>
              <p className="text-sm">
                Deposit held: ৳{formatBdt(allocation.securityDeposit)}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="act-deduct">Deduct (BDT)</Label>
                  <Input
                    id="act-deduct"
                    type="number"
                    min={0}
                    step="0.01"
                    value={deductAmount}
                    onChange={(e) => setDeductAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="act-deduct-reason">Deducted for</Label>
                  <Input
                    id="act-deduct-reason"
                    value={deductReason}
                    onChange={(e) => setDeductReason(e.target.value)}
                    placeholder="Broken window pane"
                  />
                </div>
              </div>
            </>
          )}

          {(action === "transfer" || action === "vacate") && (
            <Can
              permission={
                action === "vacate"
                  ? "hostel.vacate.override"
                  : "hostel.allocate.override"
              }
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                />
                {action === "vacate"
                  ? "Release the bed even with fees outstanding"
                  : "Move past a maintenance refusal"}
              </label>
            </Can>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => run.mutate()}
            disabled={run.isPending || !canSubmit}
          >
            {run.isPending ? "Working…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
