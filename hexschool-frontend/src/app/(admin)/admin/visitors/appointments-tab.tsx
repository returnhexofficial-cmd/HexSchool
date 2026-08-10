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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  APPOINTMENT_STATUS_LABELS,
  VISITOR_PURPOSES,
  VISITOR_PURPOSE_LABELS,
  appointmentApi,
  visitorApi,
  type Appointment,
  type AppointmentStatus,
  type VisitorHost,
  type VisitorPurpose,
} from "@/lib/api/community";

const STATUS_VARIANT: Record<
  AppointmentStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  COMPLETED: "outline",
  NO_SHOW: "destructive",
};

/**
 * Roadmap §5's appointment list.
 *
 * **Refusing needs a reason and the form insists on it**, because "no" is
 * the answer a visitor rings back about — and the DB CHECK refuses the row
 * without one either way.
 *
 * **NO_SHOW is a button, not an absence.** A school that refused a meeting
 * and a visitor who never turned up are different facts; a register that
 * cannot tell them apart is one the office stops trusting.
 */
export function AppointmentsTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AppointmentStatus | "">("");
  const [creating, setCreating] = useState(false);
  const [refusing, setRefusing] = useState<Appointment | null>(null);
  const [note, setNote] = useState("");

  const list = useQuery({
    queryKey: ["appointments", { status }],
    queryFn: () =>
      appointmentApi.list({ limit: 100, status: status || undefined }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["appointments"] });

  const decide = useMutation({
    mutationFn: (input: {
      id: string;
      status: AppointmentStatus;
      note?: string;
    }) => appointmentApi.decide(input.id, { status: input.status, note: input.note }),
    onSuccess: (appointment) => {
      toast.success(
        `Appointment ${APPOINTMENT_STATUS_LABELS[appointment.status].toLowerCase()}`,
      );
      setRefusing(null);
      setNote("");
      invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const appointments = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="appt-status">Status</Label>
          <select
            id="appt-status"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as AppointmentStatus | "")}
          >
            <option value="">All</option>
            {(
              Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]
            ).map((value) => (
              <option key={value} value={value}>
                {APPOINTMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <Can permission="appointment.manage">
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setCreating(true)}
          >
            Record a request
          </Button>
        </Can>
      </div>

      {appointments.length === 0 ? (
        <EmptyState
          title="No appointments"
          description="Requests recorded at the office appear here for approval."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-3">Visitor</th>
                <th className="p-3">Phone</th>
                <th className="p-3">To meet</th>
                <th className="p-3">When</th>
                <th className="p-3">Purpose</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {appointments.map((appointment) => (
                <tr key={appointment.id} className="border-t">
                  <td className="p-3 font-medium">{appointment.visitorName}</td>
                  <td className="p-3 text-muted-foreground">
                    {appointment.phone}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {appointment.hostName ?? "—"}
                  </td>
                  <td className="p-3">
                    {new Date(appointment.scheduledAt).toLocaleString()}
                  </td>
                  <td className="p-3">
                    {VISITOR_PURPOSE_LABELS[appointment.purpose]}
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS_VARIANT[appointment.status]}>
                      {APPOINTMENT_STATUS_LABELS[appointment.status]}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <Can permission="appointment.decide">
                      {appointment.status === "PENDING" && (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              decide.mutate({
                                id: appointment.id,
                                status: "APPROVED",
                              })
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRefusing(appointment)}
                          >
                            Refuse
                          </Button>
                        </div>
                      )}
                      {appointment.status === "APPROVED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            decide.mutate({
                              id: appointment.id,
                              status: "NO_SHOW",
                            })
                          }
                        >
                          Did not come
                        </Button>
                      )}
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Refusing carries a reason — the CHECK demands one, and so does
          the visitor who will ring back. */}
      <Dialog
        open={refusing !== null}
        onOpenChange={(open) => !open && setRefusing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refuse this appointment</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="refuse-note">Why?</Label>
            <Textarea
              id="refuse-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="The visitor is told this."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefusing(null)}>
              Cancel
            </Button>
            <Button
              disabled={note.trim().length < 3 || decide.isPending}
              onClick={() =>
                refusing &&
                decide.mutate({
                  id: refusing.id,
                  status: "REJECTED",
                  note,
                })
              }
            >
              Refuse
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {creating && (
        <NewAppointmentDialog
          onClose={() => setCreating(false)}
          onCreated={invalidate}
        />
      )}
    </div>
  );
}

function NewAppointmentDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [visitorName, setVisitorName] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState<VisitorPurpose>("MEETING");
  const [hostKey, setHostKey] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");

  const hosts = useQuery({
    queryKey: ["visitors", "hosts"],
    queryFn: () => visitorApi.hosts(),
  });

  const create = useMutation({
    mutationFn: () => {
      const host = (hosts.data ?? []).find(
        (h: VisitorHost) => `${h.hostType}:${h.hostId}` === hostKey,
      );
      if (!host) throw new Error("Choose who they are coming to see");
      return appointmentApi.create({
        visitorName,
        phone,
        purpose,
        hostType: host.hostType,
        hostId: host.hostId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Appointment recorded");
      onCreated();
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const valid =
    visitorName.trim().length >= 2 &&
    /^01[3-9]\d{8}$/.test(phone) &&
    hostKey.length > 0 &&
    scheduledAt.length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an appointment request</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="a-name">Visitor</Label>
            <Input
              id="a-name"
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-phone">Mobile</Label>
            <Input
              id="a-phone"
              placeholder="01XXXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-host">To meet</Label>
            <select
              id="a-host"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={hostKey}
              onChange={(e) => setHostKey(e.target.value)}
            >
              <option value="">Choose…</option>
              {(hosts.data ?? []).map((host: VisitorHost) => (
                <option
                  key={`${host.hostType}:${host.hostId}`}
                  value={`${host.hostType}:${host.hostId}`}
                >
                  {host.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-when">When</Label>
            <Input
              id="a-when"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-purpose">Purpose</Label>
            <select
              id="a-purpose"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as VisitorPurpose)}
            >
              {VISITOR_PURPOSES.map((value) => (
                <option key={value} value={value}>
                  {VISITOR_PURPOSE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-notes">Notes</Label>
            <Textarea
              id="a-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
