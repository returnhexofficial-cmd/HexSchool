"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import {
  RAISER_LABELS,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_VARIANT,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANT,
  TICKET_TYPE_LABELS,
  ticketApi,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/api/community";

/**
 * The thread drawer (roadmap §5). Everything that happens to a ticket
 * happens here, because everything that happens to a ticket needs words
 * attached to it.
 *
 * Three things on this screen are the module's rules made visible:
 *
 *   - **The resolution box appears the moment RESOLVED or CLOSED is
 *     picked**, and the button stays disabled until it has something in
 *     it. The DB CHECK refuses the row either way; this explains why.
 *   - **A reply and an internal note are different buttons**, not a
 *     checkbox somebody forgets. The note never leaves the building.
 *   - **The reopen window is shown as a date**, not as "recently". A
 *     parent can be told when the office's decision becomes final.
 */
export function TicketDrawer({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [nextStatus, setNextStatus] = useState<TicketStatus | "">("");
  const [resolution, setResolution] = useState("");

  const ticket = useQuery({
    queryKey: ["tickets", ticketId],
    queryFn: () => ticketApi.get(ticketId),
  });

  const thread = useQuery({
    queryKey: ["tickets", ticketId, "thread"],
    queryFn: () => ticketApi.thread(ticketId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tickets", ticketId] });
    onChanged();
  };

  const comment = useMutation({
    mutationFn: (input: { body: string; isInternal: boolean }) =>
      ticketApi.comment(ticketId, input),
    onSuccess: (_data, input) => {
      toast.success(input.isInternal ? "Note saved" : "Reply sent");
      setReply("");
      refresh();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const move = useMutation({
    mutationFn: () =>
      ticketApi.setStatus(ticketId, {
        status: nextStatus as TicketStatus,
        resolution: resolution || undefined,
      }),
    onSuccess: (updated) => {
      toast.success(`Ticket is now ${TICKET_STATUS_LABELS[updated.status]}`);
      setNextStatus("");
      setResolution("");
      refresh();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const assign = useMutation({
    mutationFn: (input: { priority?: TicketPriority; isSensitive?: boolean }) =>
      ticketApi.assign(ticketId, input),
    onSuccess: () => {
      toast.success("Ticket updated");
      refresh();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const data = ticket.data;
  const needsResolution =
    nextStatus === "RESOLVED" || nextStatus === "CLOSED";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {ticket.isLoading || !data ? (
          <LoadingBlock />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  {data.ticketNo}
                </span>
                {data.subject}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant={TICKET_STATUS_VARIANT[data.status]}>
                  {TICKET_STATUS_LABELS[data.status]}
                </Badge>
                <Badge variant={TICKET_PRIORITY_VARIANT[data.priority]}>
                  {data.priority}
                </Badge>
                <span>{TICKET_TYPE_LABELS[data.type]}</span>
                <span>·</span>
                <span>{TICKET_CATEGORY_LABELS[data.category]}</span>
                {data.isSensitive && <Badge variant="outline">Restricted</Badge>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="whitespace-pre-wrap text-sm">
                  {data.description}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {data.raisedByType === "ANONYMOUS" ? (
                    <>
                      Raised <strong>anonymously</strong> — the school holds no
                      name, contact or IP for this complaint, and no update
                      will be sent.
                    </>
                  ) : (
                    <>
                      {data.requesterName ?? RAISER_LABELS[data.raisedByType]}
                      {data.contact?.phone ? ` · ${data.contact.phone}` : ""} ·{" "}
                      {formatDateTime(data.createdAt)}
                    </>
                  )}
                </p>
              </div>

              {data.status === "CLOSED" && data.reopenClosesAt && (
                <p className="text-xs text-muted-foreground">
                  This ticket can be reopened until{" "}
                  <strong>
                    {formatDate(data.reopenClosesAt)}
                  </strong>
                  . After that the school&apos;s decision stands and a new ticket is
                  the route.
                </p>
              )}

              {data.resolution && (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
                  <p className="text-xs font-medium uppercase text-muted-foreground">
                    Resolution
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {data.resolution}
                  </p>
                </div>
              )}

              {/* ── the thread ───────────────────────────────────────── */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Thread</p>
                {thread.isLoading ? (
                  <LoadingBlock />
                ) : (thread.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing said yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(thread.data ?? []).map((entry) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "rounded-lg border p-3 text-sm",
                          entry.isInternal &&
                            "border-amber-500/40 bg-amber-500/5",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium">
                            {entry.authorName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {entry.isInternal && (
                              <Badge variant="outline" className="mr-2">
                                Internal
                              </Badge>
                            )}
                            {formatDateTime(entry.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{entry.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Can permission="ticket.respond">
                <div className="space-y-2">
                  <Label htmlFor="ticket-reply">Add to the thread</Label>
                  <Textarea
                    id="ticket-reply"
                    rows={3}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="A reply reaches the person who raised it; an internal note never leaves the office."
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!reply.trim() || comment.isPending}
                      onClick={() =>
                        comment.mutate({ body: reply, isInternal: false })
                      }
                    >
                      Reply to requester
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!reply.trim() || comment.isPending}
                      onClick={() =>
                        comment.mutate({ body: reply, isInternal: true })
                      }
                    >
                      Internal note
                    </Button>
                  </div>
                  {data.raisedByType === "ANONYMOUS" && (
                    <p className="text-xs text-muted-foreground">
                      A reply on this ticket is recorded but not delivered —
                      the complaint is anonymous.
                    </p>
                  )}
                </div>
              </Can>

              {/* ── moving it on ─────────────────────────────────────── */}
              <Can permission="ticket.respond">
                <div className="space-y-2 rounded-lg border p-4">
                  <Label htmlFor="ticket-next">Move this ticket</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      id="ticket-next"
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      value={nextStatus}
                      onChange={(e) =>
                        setNextStatus(e.target.value as TicketStatus | "")
                      }
                    >
                      <option value="">Choose a status…</option>
                      {TICKET_STATUSES.filter((s) => s !== data.status).map(
                        (status) => (
                          <option key={status} value={status}>
                            {TICKET_STATUS_LABELS[status]}
                          </option>
                        ),
                      )}
                    </select>
                    <Button
                      size="sm"
                      disabled={
                        !nextStatus ||
                        move.isPending ||
                        (needsResolution && !resolution.trim())
                      }
                      onClick={() => move.mutate()}
                    >
                      Apply
                    </Button>
                  </div>

                  {needsResolution && (
                    <div className="space-y-1.5 pt-2">
                      <Label htmlFor="ticket-resolution">
                        What was done about it?
                      </Label>
                      <Textarea
                        id="ticket-resolution"
                        rows={3}
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value)}
                        placeholder="This is what the family is told, and what the register keeps."
                      />
                    </div>
                  )}
                </div>
              </Can>

              <Can permission="ticket.assign">
                <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="ticket-priority-set">Priority</Label>
                    <select
                      id="ticket-priority-set"
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      value={data.priority}
                      onChange={(e) =>
                        assign.mutate({
                          priority: e.target.value as TicketPriority,
                        })
                      }
                    >
                      {TICKET_PRIORITIES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      assign.mutate({ isSensitive: !data.isSensitive })
                    }
                  >
                    {data.isSensitive
                      ? "Remove restriction"
                      : "Restrict to senior staff"}
                  </Button>
                </div>
              </Can>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
