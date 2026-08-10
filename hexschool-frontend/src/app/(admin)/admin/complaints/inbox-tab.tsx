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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  RAISER_LABELS,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_VARIANT,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANT,
  TICKET_TYPE_LABELS,
  ticketApi,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/api/community";
import { TicketDrawer } from "./ticket-drawer";
import { NewTicketDialog } from "./new-ticket-dialog";

/** The board's columns. REOPENED sits first — it is the loudest signal. */
const BOARD: TicketStatus[] = [
  "REOPENED",
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
];

/**
 * Roadmap §5's "ticket inbox (kanban by status + table view, priority
 * chips, assignment dropdown, comment thread drawer)".
 *
 * **The board is read-only and the drawer does the work.** A drag between
 * columns looks like the natural gesture and is the wrong one here:
 * moving a ticket to RESOLVED requires a resolution (the DB CHECK refuses
 * the row without one), and a gesture that cannot carry a sentence would
 * either pop a dialog anyway or write an empty resolution. So a card opens
 * the thread, and the status changes where the words are.
 *
 * **An anonymous complaint shows no requester**, because there is nothing
 * on the row to show — not a blanked field, an absent one.
 */
export function InboxTab() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ["tickets", { search, category, priority }],
    queryFn: () =>
      ticketApi.list({
        limit: 200,
        search: search || undefined,
        category: category || undefined,
        priority: priority || undefined,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["tickets"] });

  const remove = useMutation({
    mutationFn: (id: string) => ticketApi.remove(id),
    onSuccess: () => {
      toast.success("Ticket removed");
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) {
    return <ErrorState onRetry={() => void list.refetch()} />;
  }

  const tickets = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ticket-search">Search</Label>
          <Input
            id="ticket-search"
            placeholder="Number, subject or text"
            className="w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ticket-category">Category</Label>
          <select
            id="ticket-category"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketCategory | "")}
          >
            <option value="">All</option>
            {TICKET_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {TICKET_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ticket-priority">Priority</Label>
          <select
            id="ticket-priority"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority | "")}
          >
            <option value="">All</option>
            {TICKET_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView(view === "board" ? "table" : "board")}
          >
            {view === "board" ? "Table view" : "Board view"}
          </Button>
          <Can permission="ticket.create">
            <Button size="sm" onClick={() => setCreating(true)}>
              Log a complaint
            </Button>
          </Can>
        </div>
      </div>

      {tickets.length === 0 ? (
        <EmptyState
          title="Nothing in the inbox"
          description="Complaints raised at the counter, through the portal or on the website land here."
        />
      ) : view === "board" ? (
        <div className="grid gap-3 lg:grid-cols-5">
          {BOARD.map((status) => {
            const column = tickets.filter((t) => t.status === status);
            return (
              <div key={status} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm font-medium">
                    {TICKET_STATUS_LABELS[status]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {column.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {column.map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      onOpen={() => setOpenId(ticket.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Ticket</th>
                <th className="p-3">Subject</th>
                <th className="p-3">From</th>
                <th className="p-3">Category</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Assignee</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{ticket.ticketNo}</td>
                  <td className="p-3">
                    <button
                      className="text-left hover:underline"
                      onClick={() => setOpenId(ticket.id)}
                    >
                      {ticket.subject}
                    </button>
                    {ticket.isSensitive && (
                      <Badge variant="outline" className="ml-2">
                        Restricted
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {requesterLabel(ticket)}
                  </td>
                  <td className="p-3">
                    {TICKET_CATEGORY_LABELS[ticket.category]}
                  </td>
                  <td className="p-3">
                    <Badge variant={TICKET_PRIORITY_VARIANT[ticket.priority]}>
                      {ticket.priority}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {ticket.assigneeName ?? "Unassigned"}
                  </td>
                  <td className="p-3">
                    <Badge variant={TICKET_STATUS_VARIANT[ticket.status]}>
                      {TICKET_STATUS_LABELS[ticket.status]}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Can permission="ticket.delete">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (
                            confirm(
                              `Remove ${ticket.ticketNo}? This is for spam — a real complaint should be closed with a reason instead.`,
                            )
                          ) {
                            remove.mutate(ticket.id);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && (
        <TicketDrawer
          ticketId={openId}
          onClose={() => setOpenId(null)}
          onChanged={invalidate}
        />
      )}
      {creating && (
        <NewTicketDialog
          onClose={() => setCreating(false)}
          onCreated={invalidate}
        />
      )}
    </div>
  );
}

/**
 * An anonymous complaint genuinely has no requester on the row, so it is
 * labelled as anonymous rather than shown as an empty cell — the reader
 * should know it is a deliberate absence and not missing data.
 */
function requesterLabel(ticket: Ticket): string {
  if (ticket.raisedByType === "ANONYMOUS") return "Anonymous";
  return ticket.requesterName ?? RAISER_LABELS[ticket.raisedByType];
}

function TicketCard({
  ticket,
  onOpen,
}: {
  ticket: Ticket;
  onOpen: () => void;
}) {
  const late = ticket.escalatedAt !== null;

  return (
    <button
      onClick={onOpen}
      className={cn(
        "w-full space-y-2 rounded-lg border bg-card p-3 text-left transition hover:border-primary",
        late && "border-destructive/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {ticket.ticketNo}
        </span>
        <Badge variant={TICKET_PRIORITY_VARIANT[ticket.priority]}>
          {ticket.priority}
        </Badge>
      </div>
      <p className="line-clamp-2 text-sm font-medium">{ticket.subject}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{TICKET_TYPE_LABELS[ticket.type]}</span>
        <span>·</span>
        <span>{TICKET_CATEGORY_LABELS[ticket.category]}</span>
        {ticket.commentCount > 0 && (
          <>
            <span>·</span>
            <span>{ticket.commentCount} replies</span>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {ticket.isSensitive && <Badge variant="outline">Restricted</Badge>}
        {late && <Badge variant="destructive">Past response time</Badge>}
        {ticket.satisfactionRating !== null && (
          <Badge variant="secondary">
            {"★".repeat(ticket.satisfactionRating)}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {requesterLabel(ticket)} ·{" "}
        {ticket.assigneeName ?? "unassigned"}
      </p>
    </button>
  );
}
