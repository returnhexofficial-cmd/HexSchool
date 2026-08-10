"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingBlock } from "@/components/shared/spinner";
import { cn } from "@/lib/utils";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUS_VARIANT,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  portalTicketApi,
  type TicketCategory,
  type TicketType,
} from "@/lib/api/community";

/**
 * "Contact School", and what happened next (Module 28).
 *
 * **This is what M18's stub became.** The form used to drop a message in
 * the office inbox and go quiet: the family had no reference, no status
 * and no way to know whether anybody had read it. Now every message opens
 * a ticket the family can follow, reply on, and rate when it is settled.
 *
 * Two things this panel deliberately does not show: **internal notes**
 * (the API never sends them here) and **anybody else's tickets** — the
 * list is keyed on the account, so there is no id to tamper with.
 */
export function MyTicketsCard() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<TicketType>("COMPLAINT");
  const [category, setCategory] = useState<TicketCategory>("OTHER");

  const tickets = useQuery({
    queryKey: ["portal", "tickets"],
    queryFn: () => portalTicketApi.mine(),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["portal", "tickets"] });

  const send = useMutation({
    mutationFn: () =>
      portalTicketApi.contact({
        subject: subject || undefined,
        body,
        type,
        category,
      }),
    onSuccess: (result) => {
      toast.success(`${result.message} Reference ${result.ticketNo}.`);
      setSubject("");
      setBody("");
      invalidate();
    },
    onError: () => toast.error("Could not send the message"),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border p-4">
        <div>
          <h3 className="font-medium">Contact the school</h3>
          <p className="text-sm text-muted-foreground">
            Your name and phone come from your account. You will get a
            reference number and can follow what happens below.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pt-type">This is a…</Label>
            <select
              id="pt-type"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as TicketType)}
            >
              {TICKET_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TICKET_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pt-category">About</Label>
            <select
              id="pt-category"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value as TicketCategory)}
            >
              {TICKET_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {TICKET_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pt-subject">Subject</Label>
          <Input
            id="pt-subject"
            value={subject}
            maxLength={200}
            placeholder="Optional"
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pt-body">Message</Label>
          <Textarea
            id="pt-body"
            value={body}
            rows={4}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <Button
          size="sm"
          disabled={body.trim().length < 5 || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? "Sending…" : "Send"}
        </Button>
      </div>

      {tickets.isLoading ? (
        <LoadingBlock />
      ) : (tickets.data ?? []).length === 0 ? null : (
        <div className="space-y-3">
          <h3 className="font-medium">What you have raised</h3>
          {(tickets.data ?? []).map((ticket) => (
            <TicketThread
              key={ticket.id}
              ticket={ticket}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TicketThread({
  ticket,
  onChanged,
}: {
  ticket: Awaited<ReturnType<typeof portalTicketApi.mine>>[number];
  onChanged: () => void;
}) {
  const [reply, setReply] = useState("");
  const [rating, setRating] = useState(0);

  const sendReply = useMutation({
    mutationFn: () => portalTicketApi.reply(ticket.id, { body: reply }),
    onSuccess: () => {
      toast.success("Sent");
      setReply("");
      onChanged();
    },
    onError: () => toast.error("Could not send your reply"),
  });

  const rate = useMutation({
    mutationFn: () => portalTicketApi.rate(ticket.id, { rating }),
    onSuccess: () => {
      toast.success("Thank you");
      onChanged();
    },
    onError: () => toast.error("Could not save your rating"),
  });

  const settled =
    ticket.status === "RESOLVED" || ticket.status === "CLOSED";

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{ticket.subject}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {ticket.ticketNo} ·{" "}
            {new Date(ticket.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={TICKET_STATUS_VARIANT[ticket.status]}>
          {TICKET_STATUS_LABELS[ticket.status]}
        </Badge>
      </div>

      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
        {ticket.description}
      </p>

      {ticket.resolution && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            What the school did
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">
            {ticket.resolution}
          </p>
        </div>
      )}

      {ticket.comments.length > 0 && (
        <div className="space-y-2">
          {ticket.comments.map((comment) => (
            <div
              key={comment.id}
              className="rounded-md bg-muted/40 p-3 text-sm"
            >
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{comment.authorName}</span>
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Textarea
          rows={2}
          value={reply}
          placeholder="Add to this thread…"
          onChange={(e) => setReply(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!reply.trim() || sendReply.isPending}
          onClick={() => sendReply.mutate()}
        >
          Reply
        </Button>
      </div>

      {/* Roadmap §4's satisfaction prompt, asked only once and only of the
          person who raised it. */}
      {settled && ticket.satisfactionRating === null && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">
            How did the school handle this?
          </p>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "text-xl transition",
                  value <= rating ? "opacity-100" : "opacity-30",
                )}
                onClick={() => setRating(value)}
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
              >
                ★
              </button>
            ))}
            <Button
              size="sm"
              disabled={rating === 0 || rate.isPending}
              onClick={() => rate.mutate()}
            >
              Send
            </Button>
          </div>
        </div>
      )}

      {ticket.satisfactionRating !== null && (
        <p className="text-xs text-muted-foreground">
          You rated this {"★".repeat(ticket.satisfactionRating)}.
        </p>
      )}
    </div>
  );
}
