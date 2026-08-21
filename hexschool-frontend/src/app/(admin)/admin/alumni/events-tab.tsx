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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import { alumniApi, alumniEventApi, type AlumniEvent } from "@/lib/api/community";
import { formatDate } from "@/lib/utils/date";
import { MAX_PAGE_LIMIT } from "@/lib/constants/pagination";

/**
 * Alumni events and their guest lists (roadmap §5's "events manager").
 *
 * **Over capacity warns rather than refusing** — the M25 bus rule. A
 * reunion that seats a hundred and has a hundred and two people wanting to
 * come is a real thing, and a system that made it unrecordable would just
 * be lied to. The warning comes back from the API and lands as a toast so
 * the committee sees it and decides.
 */
export function EventsTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AlumniEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<AlumniEvent | null>(null);

  const list = useQuery({
    queryKey: ["alumni-events"],
    queryFn: () => alumniEventApi.list({ limit: 100 }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["alumni-events"] });

  const remove = useMutation({
    mutationFn: (id: string) => alumniEventApi.remove(id),
    onSuccess: () => {
      toast.success("Event removed");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const events = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can permission="alumni.event.manage">
          <Button size="sm" onClick={() => setCreating(true)}>
            New event
          </Button>
        </Can>
      </div>

      {events.length === 0 ? (
        <EmptyState
          title="No events"
          description="Reunions, fundraisers and prize-givings are set up here."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {events.map((event) => (
            <div key={event.id} className="space-y-2 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(event.eventDate)}
                    {event.venue ? ` · ${event.venue}` : ""}
                  </p>
                </div>
                <Badge variant={event.isPublished ? "default" : "outline"}>
                  {event.isPublished ? "Published" : "Draft"}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{event.registrations} registered</span>
                <span>·</span>
                <span>{event.seatsTaken} seats taken</span>
                {event.capacity !== null && (
                  <>
                    <span>·</span>
                    <span
                      className={
                        (event.seatsLeft ?? 0) < 0 ? "text-destructive" : ""
                      }
                    >
                      {event.seatsLeft} of {event.capacity} left
                    </span>
                  </>
                )}
                <span>·</span>
                <span>
                  {event.fee === null
                    ? "Free"
                    : `BDT ${Number(event.fee).toFixed(2)}`}
                </span>
              </div>

              <Can permission="alumni.event.manage">
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setManaging(event)}
                  >
                    Guest list
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(event)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`Remove "${event.title}"?`)) {
                        remove.mutate(event.id);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </Can>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <EventDialog
          event={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      )}

      {managing && (
        <GuestListDialog
          event={managing}
          onClose={() => setManaging(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

function EventDialog({
  event,
  onClose,
  onSaved,
}: {
  event: AlumniEvent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [eventDate, setEventDate] = useState(
    event?.eventDate?.slice(0, 10) ?? "",
  );
  const [venue, setVenue] = useState(event?.venue ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [fee, setFee] = useState(event?.fee ?? "");
  const [capacity, setCapacity] = useState(
    event?.capacity ? String(event.capacity) : "",
  );
  const [deadline, setDeadline] = useState(
    event?.registrationDeadline?.slice(0, 10) ?? "",
  );
  const [isPublished, setIsPublished] = useState(event?.isPublished ?? false);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        eventDate,
        venue: venue || undefined,
        description: description || undefined,
        // An empty box is a FREE event (no fee at all); a typed 0 is an
        // event priced at nothing. The two read differently in the
        // accounts, so they stay distinct all the way down.
        fee: fee === "" ? undefined : Number(fee),
        capacity: capacity === "" ? undefined : Number(capacity),
        registrationDeadline: deadline || undefined,
        isPublished,
      };
      return event
        ? alumniEventApi.update(event.id, body)
        : alumniEventApi.create(body);
    },
    onSuccess: () => {
      toast.success(event ? "Event updated" : "Event created");
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const valid =
    title.trim().length >= 2 &&
    /^\d{4}-\d{2}-\d{2}$/.test(eventDate) &&
    (!deadline || deadline <= eventDate);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New alumni event"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="e-title">Title</Label>
            <Input
              id="e-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="e-date">Date</Label>
              <Input
                id="e-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-deadline">Registration closes</Label>
              <Input
                id="e-deadline"
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-venue">Venue</Label>
            <Input
              id="e-venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="e-fee">Fee (blank = free)</Label>
              <Input
                id="e-fee"
                value={String(fee)}
                onChange={(e) => setFee(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-capacity">Capacity</Label>
              <Input
                id="e-capacity"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e-description">Description</Label>
            <Textarea
              id="e-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            Show this event on the website
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GuestListDialog({
  event,
  onClose,
  onChanged,
}: {
  event: AlumniEvent;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [alumniId, setAlumniId] = useState("");
  const [guests, setGuests] = useState("0");

  const registrations = useQuery({
    queryKey: ["alumni-events", event.id, "registrations"],
    queryFn: () => alumniEventApi.registrations(event.id),
  });

  const approved = useQuery({
    queryKey: ["alumni", { status: "APPROVED", forEvent: true }],
    queryFn: () => alumniApi.list({ status: "APPROVED", limit: MAX_PAGE_LIMIT }),
  });

  const register = useMutation({
    mutationFn: () =>
      alumniEventApi.register(event.id, {
        alumniId,
        guests: Number(guests) || 0,
      }),
    onSuccess: (result) => {
      toast.success("Registered");
      // Over capacity is a warning, not a refusal — the committee decides.
      if (result.warning) toast.warning(result.warning);
      setAlumniId("");
      setGuests("0");
      void queryClient.invalidateQueries({
        queryKey: ["alumni-events", event.id],
      });
      onChanged();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{event.title}</DialogTitle>
          <DialogDescription>
            {event.seatsTaken} seats taken
            {event.capacity !== null ? ` of ${event.capacity}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="g-alumni">Alumnus</Label>
            <select
              id="g-alumni"
              className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
              value={alumniId}
              onChange={(e) => setAlumniId(e.target.value)}
            >
              <option value="">Choose…</option>
              {(approved.data?.data ?? []).map((alumnus) => (
                <option key={alumnus.id} value={alumnus.id}>
                  {alumnus.name} ({alumnus.batchYear})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-guests">Guests</Label>
            <Input
              id="g-guests"
              className="w-20"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={!alumniId || register.isPending}
            onClick={() => register.mutate()}
          >
            Register
          </Button>
        </div>

        {registrations.isLoading ? (
          <LoadingBlock />
        ) : (registrations.data ?? []).length === 0 ? (
          <EmptyState title="Nobody registered yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Alumnus</th>
                  <th className="p-2">Guests</th>
                  <th className="p-2">Paid</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(registrations.data ?? []).map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">{row.alumni?.name ?? row.alumniId}</td>
                    <td className="p-2">{row.guests}</td>
                    <td className="p-2">{Number(row.amountPaid).toFixed(2)}</td>
                    <td className="p-2">
                      <Badge
                        variant={
                          row.status === "CANCELLED" ? "outline" : "secondary"
                        }
                      >
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
