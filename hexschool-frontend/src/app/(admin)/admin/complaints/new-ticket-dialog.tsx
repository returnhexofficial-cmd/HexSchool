"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  ticketApi,
  type TicketCategory,
  type TicketPriority,
  type TicketType,
} from "@/lib/api/community";

/**
 * Logging a walk-in complaint at the counter.
 *
 * **There is no "anonymous" option here, deliberately.** A complaint typed
 * at the counter by the clerk the complainant is standing in front of is
 * not anonymous, and offering the checkbox would let the office file
 * something under a promise it cannot keep. The backend refuses it too.
 * Anonymity is a property of the *public form*, where nobody is watching.
 */
export function NewTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<TicketType>("COMPLAINT");
  const [category, setCategory] = useState<TicketCategory>("OTHER");
  const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const create = useMutation({
    mutationFn: () =>
      ticketApi.create({
        type,
        category,
        priority,
        subject,
        description,
        // Filed as a walk-in with a contact block — the office knows who is
        // standing there, and the ticket has to be repliable.
        raisedByType: "PUBLIC",
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
      }),
    onSuccess: (ticket) => {
      toast.success(`Logged as ${ticket.ticketNo}`);
      onCreated();
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const valid =
    subject.trim().length >= 3 &&
    description.trim().length >= 5 &&
    contactPhone.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Log a complaint</DialogTitle>
          <DialogDescription>
            For something raised at the counter or over the phone. The person
            it is about gets a ticket number to quote.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-type">Type</Label>
              <select
                id="new-type"
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
            <div className="space-y-1.5">
              <Label htmlFor="new-category">Category</Label>
              <select
                id="new-category"
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
            <div className="space-y-1.5">
              <Label htmlFor="new-priority">Priority</Label>
              <select
                id="new-priority"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
              >
                {TICKET_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {category === "TEACHER" && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              A complaint filed under <strong>Teacher</strong> is restricted
              automatically — only senior staff will be able to open it.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-contact-name">Who raised it</Label>
              <Input
                id="new-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-contact-phone">Their mobile</Label>
              <Input
                id="new-contact-phone"
                placeholder="01XXXXXXXXX"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-subject">Subject</Label>
            <Input
              id="new-subject"
              maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-description">What happened</Label>
            <Textarea
              id="new-description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Saving…" : "Log it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
