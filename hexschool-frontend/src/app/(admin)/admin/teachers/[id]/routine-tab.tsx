"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/auth";
import { routineApi } from "@/lib/api/timetable";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import { cn } from "@/lib/utils";
import {
  cellKey,
  indexCells,
  isTeachable,
  WEEKDAY_SHORT,
} from "@/lib/validations/timetable";

/**
 * A teacher's personal week, drawn on the union of the bell schedules
 * they actually appear in (a part-timer can cross shifts). Published
 * routines only — a draft nobody has committed to is not somebody's
 * timetable yet.
 */
export function RoutineTab({ teacherId }: { teacherId: string }) {
  const { selected: session } = useAcademicSession();
  const sessionId = session?.id ?? "";

  const routine = useQuery({
    queryKey: ["teacher-routine", teacherId, sessionId],
    queryFn: () => routineApi.teacher(teacherId, { sessionId }),
    enabled: !!sessionId,
  });

  if (!sessionId) {
    return (
      <EmptyState
        title="No session selected"
        description="Pick an academic session from the switcher in the header."
      />
    );
  }
  if (routine.isPending) return <LoadingBlock />;
  if (routine.isError) {
    return <ErrorState onRetry={() => void routine.refetch()} />;
  }

  const { days, slots, cells, periodsPerWeek, freeByDay } = routine.data;
  const byCell = indexCells(cells);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">{periodsPerWeek} period(s) / week</Badge>
        {days.map((day) => (
          <span key={day} className="text-xs text-muted-foreground">
            {WEEKDAY_SHORT[day]}: {freeByDay[day] ?? 0} free
          </span>
        ))}
        <Can permission="timetable.export">
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() =>
              void routineApi
                .downloadTeacher(teacherId, { sessionId })
                .catch((err) => toast.error(apiErrorMessage(err)))
            }
          >
            Print routine
          </Button>
        </Can>
      </div>

      {slots.length === 0 || cells.length === 0 ? (
        <EmptyState
          title="No scheduled periods"
          description="This teacher does not appear in any published routine for the selected session."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-36 p-3 text-left font-medium">Period</th>
                {days.map((day) => (
                  <th key={day} className="p-3 text-left font-medium">
                    {WEEKDAY_SHORT[day]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.filter((slot) => isTeachable(slot.type)).map((slot) => (
                <tr key={slot.id} className="border-b last:border-b-0">
                  <td className="p-3 align-top">
                    <div className="font-medium">{slot.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {slot.startTime}–{slot.endTime}
                    </div>
                  </td>
                  {days.map((day) => {
                    const cell = byCell.get(cellKey(day, slot.id));
                    return (
                      <td
                        key={day}
                        className={cn(
                          "p-3 align-top",
                          !cell && "text-muted-foreground",
                        )}
                      >
                        {cell ? (
                          <>
                            <div className="font-medium">
                              {cell.sectionLabel}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {cell.subject.name}
                            </div>
                            {cell.combinedWith ? (
                              <div className="text-xs text-muted-foreground">
                                with {cell.combinedWith.label}
                              </div>
                            ) : cell.roomNo ? (
                              <div className="text-xs text-muted-foreground">
                                Room {cell.roomNo}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs">Free</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
