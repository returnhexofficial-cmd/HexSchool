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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import { alumniApi, type Alumni } from "@/lib/api/community";

/**
 * The approval queue (roadmap §5's "admin approval queue" and §8's
 * conflict resolution).
 *
 * **The match hints rank; the approver decides.** "Md. Rahman, batch 2015"
 * describes several real people at any BD school of size, so nothing here
 * links a claim automatically — the panel shows what the school's own
 * records suggest, with the reason for each suggestion, and a human picks.
 *
 * **A conflicting claim is shown as a conflict, not hidden.** When somebody
 * else already holds an approved claim on a student record, the row says
 * so and the approve button explains why it will be refused — which is
 * exactly roadmap §8's "conflict queue for manual resolve", with the
 * partial unique index underneath making it true regardless.
 */
export function ApprovalsTab() {
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<Alumni | null>(null);
  const [rejecting, setRejecting] = useState<Alumni | null>(null);
  const [reason, setReason] = useState("");

  const list = useQuery({
    queryKey: ["alumni", { status: "PENDING" }],
    queryFn: () => alumniApi.list({ status: "PENDING", limit: 100 }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["alumni"] });

  const decide = useMutation({
    mutationFn: (input: {
      id: string;
      status: "APPROVED" | "REJECTED";
      reason?: string;
      studentId?: string;
    }) =>
      alumniApi.decide(input.id, {
        status: input.status,
        reason: input.reason,
        studentId: input.studentId,
      }),
    onSuccess: (alumnus) => {
      toast.success(
        alumnus.status === "APPROVED"
          ? `${alumnus.name} is in the directory`
          : `${alumnus.name}'s registration was refused`,
      );
      setReviewing(null);
      setRejecting(null);
      setReason("");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="Registrations from the website land here for review."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((alumnus) => (
            <div
              key={alumnus.id}
              className={cn(
                "flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4",
                alumnus.claimConflict && "border-destructive/60",
              )}
            >
              <div className="space-y-1">
                <p className="font-medium">
                  {alumnus.name}
                  <span className="ml-2 text-sm text-muted-foreground">
                    batch {alumnus.batchYear}
                    {alumnus.lastClass ? ` · ${alumnus.lastClass}` : ""}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {[alumnus.phone, alumnus.email].filter(Boolean).join(" · ")}
                </p>
                {(alumnus.profession || alumnus.organization) && (
                  <p className="text-sm text-muted-foreground">
                    {[alumnus.profession, alumnus.organization]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                {alumnus.claimConflict && (
                  <Badge variant="destructive">
                    Another approved profile already claims this student record
                  </Badge>
                )}
              </div>

              <Can permission="alumni.approve">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReviewing(alumnus)}
                  >
                    Match to a student
                  </Button>
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({ id: alumnus.id, status: "APPROVED" })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRejecting(alumnus)}
                  >
                    Refuse
                  </Button>
                </div>
              </Can>
            </div>
          ))}
        </div>
      )}

      {reviewing && (
        <MatchDialog
          alumnus={reviewing}
          onClose={() => setReviewing(null)}
          onApprove={(studentId) =>
            decide.mutate({
              id: reviewing.id,
              status: "APPROVED",
              studentId,
            })
          }
          pending={decide.isPending}
        />
      )}

      <Dialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refuse this registration</DialogTitle>
            <DialogDescription>
              The applicant is told this, so write something they can act on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 3 || decide.isPending}
              onClick={() =>
                rejecting &&
                decide.mutate({
                  id: rejecting.id,
                  status: "REJECTED",
                  reason,
                })
              }
            >
              Refuse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MatchDialog({
  alumnus,
  onClose,
  onApprove,
  pending,
}: {
  alumnus: Alumni;
  onClose: () => void;
  onApprove: (studentId: string) => void;
  pending: boolean;
}) {
  const hints = useQuery({
    queryKey: ["alumni", alumnus.id, "match-hints"],
    queryFn: () => alumniApi.matchHints(alumnus.id),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Which student is {alumnus.name}?</DialogTitle>
          <DialogDescription>
            Ranked against the school&apos;s graduated students. Nothing is
            linked automatically — several people share a name and a batch.
          </DialogDescription>
        </DialogHeader>

        {hints.isLoading ? (
          <LoadingBlock />
        ) : (hints.data ?? []).length === 0 ? (
          <EmptyState
            title="No likely match"
            description="Approve without linking — a directory entry does not need a student record behind it."
          />
        ) : (
          <div className="space-y-2">
            {(hints.data ?? []).map((hint) => (
              <div
                key={hint.studentId}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg border p-3",
                  hint.alreadyClaimed && "opacity-60",
                )}
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {hint.name}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {hint.studentUid}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      hint.graduationYear
                        ? `Graduated ${hint.graduationYear}`
                        : null,
                      hint.lastClass,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {hint.reasons.map((reason) => (
                      <Badge key={reason} variant="secondary">
                        {reason}
                      </Badge>
                    ))}
                    {hint.alreadyClaimed && (
                      <Badge variant="destructive">Already claimed</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-sm font-medium">{hint.score}%</span>
                  <Button
                    size="sm"
                    disabled={hint.alreadyClaimed || pending}
                    onClick={() => onApprove(hint.studentId)}
                  >
                    This one
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
