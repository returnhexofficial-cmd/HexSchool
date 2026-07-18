"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  admissionApplicationsApi,
  admissionCyclesApi,
  type AdmissionCycle,
} from "@/lib/api/admissions";
import { apiErrorMessage } from "@/lib/api/auth";

interface SlotDraft {
  classId: string;
  testDate: string;
  venue: string;
  totalMarks: string;
  passMarks: string;
}

const buildSlots = (cycle: AdmissionCycle): SlotDraft[] =>
  cycle.classes.map((cc) => {
    const existing = cycle.tests.find((t) => t.classId === cc.classId);
    return {
      classId: cc.classId,
      testDate: existing?.testDate?.slice(0, 10) ?? "",
      venue: existing?.venue ?? "",
      totalMarks: existing ? String(existing.totalMarks) : "100",
      passMarks: existing ? String(existing.passMarks) : "33",
    };
  });

/** Test slot editor (per class) + bulk mark-entry grid (roadmap M10 §5). */
export function TestsTab({ cycle }: { cycle: AdmissionCycle }) {
  const queryClient = useQueryClient();
  const [slots, setSlots] = useState<SlotDraft[]>(() => buildSlots(cycle));
  const [marksClassId, setMarksClassId] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>({});

  // Adjust-during-render (react.dev "you might not need an effect"):
  // refetched cycle data resets the slot drafts without a cascade.
  const [prevCycle, setPrevCycle] = useState(cycle);
  if (cycle !== prevCycle) {
    setPrevCycle(cycle);
    setSlots(buildSlots(cycle));
  }

  const roster = useQuery({
    queryKey: [
      "admission-applications",
      { cycleId: cycle.id, marksClassId, roster: true },
    ],
    queryFn: () =>
      admissionApplicationsApi.list({
        cycleId: cycle.id,
        classId: marksClassId,
        limit: 100,
      }),
    enabled: !!marksClassId,
  });

  const schedule = useMutation({
    mutationFn: () =>
      admissionCyclesApi.scheduleTests(
        cycle.id,
        slots
          .filter((s) => s.testDate)
          .map((s) => ({
            classId: s.classId,
            testDate: s.testDate,
            venue: s.venue || undefined,
            totalMarks: Number(s.totalMarks),
            passMarks: Number(s.passMarks),
          })),
      ),
    onSuccess: () => {
      toast.success(
        "Tests scheduled. Paid applications moved to TEST_SCHEDULED (SMS queued).",
      );
      void queryClient.invalidateQueries({ queryKey: ["admission-cycles"] });
      void queryClient.invalidateQueries({
        queryKey: ["admission-applications"],
      });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const submitMarks = useMutation({
    mutationFn: () =>
      admissionCyclesApi.enterMarks(
        cycle.id,
        Object.entries(marks)
          .filter(([, v]) => v.trim() !== "")
          .map(([applicationId, v]) => ({
            applicationId,
            marks: Number(v),
          })),
      ),
    onSuccess: (result) => {
      toast.success(
        `Marks saved: ${result.passed} passed, ${result.failed} failed.`,
      );
      setMarks({});
      void queryClient.invalidateQueries({
        queryKey: ["admission-applications"],
      });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (!cycle.testRequired) {
    return (
      <EmptyState
        title="No admission test for this cycle"
        description="Merit lists rank paid applications directly (previous GPA → age)."
      />
    );
  }

  const markable = (roster.data?.data ?? []).filter((a) =>
    ["TEST_SCHEDULED", "PASSED", "FAILED"].includes(a.status),
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Test schedule (per class)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {slots.map((slot, i) => {
            const cc = cycle.classes.find((c) => c.classId === slot.classId);
            return (
              <div
                key={slot.classId}
                className="grid grid-cols-[8rem_1fr_1fr_6rem_6rem] items-center gap-2"
              >
                <span className="text-sm font-medium">
                  {cc?.class.name ?? "—"}
                </span>
                <Input
                  type="date"
                  value={slot.testDate}
                  onChange={(e) =>
                    setSlots((prev) =>
                      prev.map((s, j) =>
                        j === i ? { ...s, testDate: e.target.value } : s,
                      ),
                    )
                  }
                />
                <Input
                  placeholder="Venue"
                  value={slot.venue}
                  onChange={(e) =>
                    setSlots((prev) =>
                      prev.map((s, j) =>
                        j === i ? { ...s, venue: e.target.value } : s,
                      ),
                    )
                  }
                />
                <Input
                  placeholder="Total"
                  value={slot.totalMarks}
                  onChange={(e) =>
                    setSlots((prev) =>
                      prev.map((s, j) =>
                        j === i ? { ...s, totalMarks: e.target.value } : s,
                      ),
                    )
                  }
                />
                <Input
                  placeholder="Pass"
                  value={slot.passMarks}
                  onChange={(e) =>
                    setSlots((prev) =>
                      prev.map((s, j) =>
                        j === i ? { ...s, passMarks: e.target.value } : s,
                      ),
                    )
                  }
                />
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Columns: class · test date · venue · total marks · pass marks.
            Scheduling moves each class&apos;s paid applications to
            TEST_SCHEDULED and unlocks admit cards.
          </p>
          <Can permission="admission.test.manage">
            <Button
              disabled={schedule.isPending || !slots.some((s) => s.testDate)}
              onClick={() => schedule.mutate()}
            >
              Save schedule
            </Button>
          </Can>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Test marks entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Label>Class</Label>
            <Select value={marksClassId} onValueChange={setMarksClassId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Pick a class" />
              </SelectTrigger>
              <SelectContent>
                {cycle.classes.map((c) => (
                  <SelectItem key={c.classId} value={c.classId}>
                    {c.class.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!marksClassId ? null : roster.isPending ? (
            <Spinner />
          ) : markable.length === 0 ? (
            <EmptyState
              title="No test-ready applications"
              description="Applications appear here once the test is scheduled (paid applicants only)."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Roll (Application No)</TableHead>
                    <TableHead>Applicant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-32">Marks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {markable.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell>{app.applicationNo}</TableCell>
                      <TableCell>
                        {app.firstName} {app.lastName}
                      </TableCell>
                      <TableCell>{app.status}</TableCell>
                      <TableCell>
                        <Input
                          value={
                            marks[app.id] ??
                            (app.testMarks === null
                              ? ""
                              : String(Number(app.testMarks)))
                          }
                          onChange={(e) =>
                            setMarks((prev) => ({
                              ...prev,
                              [app.id]: e.target.value,
                            }))
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Can permission="admission.test.manage">
                <Button
                  disabled={
                    submitMarks.isPending ||
                    Object.values(marks).every((v) => v.trim() === "")
                  }
                  onClick={() => submitMarks.mutate()}
                >
                  Save marks
                </Button>
              </Can>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
