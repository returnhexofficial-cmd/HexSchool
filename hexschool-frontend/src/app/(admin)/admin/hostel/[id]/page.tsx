"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
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
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  BED_STATE_CLASS,
  BED_STATE_LABELS,
  HOSTEL_TYPE_LABELS,
  ROOM_TYPES,
  ROOM_TYPE_LABELS,
  formatBdt,
  hostelApi,
  type BedState,
  type Room,
  type RoomInput,
} from "@/lib/api/hostel";
import { HostelDialog } from "../hostels-tab";
import { AllocateDialog } from "../boarders-tab";

/**
 * One hostel: its rooms as cards and its beds as chips — roadmap §5's
 * "occupancy heat grid (rooms as cards, beds as chips, click-to-allocate)".
 *
 * **A chip's colour comes from the server's `held` flag, not from the
 * bed's own status column.** The status column is a shadow of the live
 * allocation, and drawing the grid from it would mean a stale shadow
 * offers a bed the database will then refuse — the greyed chip and the
 * 409 have to be the same fact. Clicking a free chip opens the allocation
 * dialog with that bed already chosen, which is the whole point of
 * drawing beds rather than listing them.
 */
export default function HostelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingRoom, setAddingRoom] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);
  const [allocatingBedId, setAllocatingBedId] = useState<string | null>(null);

  const hostel = useQuery({
    queryKey: ["hostel", id],
    queryFn: () => hostelApi.get(id),
  });

  const rooms = useQuery({
    queryKey: ["hostel", id, "rooms"],
    queryFn: () => hostelApi.rooms(id),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["hostel", id] });
    void qc.invalidateQueries({ queryKey: ["hostels"] });
    void qc.invalidateQueries({ queryKey: ["hostel-allocations"] });
  };

  const removeRoom = useMutation({
    mutationFn: (roomId: string) => hostelApi.removeRoom(roomId),
    onSuccess: () => {
      toast.success("Room deleted");
      setDeletingRoom(null);
      refresh();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const byFloor = useMemo(() => {
    const map = new Map<number, Room[]>();
    for (const room of rooms.data ?? []) {
      const list = map.get(room.floor) ?? [];
      list.push(room);
      map.set(room.floor, list);
    }
    return [...map].sort((a, b) => a[0] - b[0]);
  }, [rooms.data]);

  if (hostel.isLoading) return <LoadingBlock />;
  if (hostel.isError || !hostel.data) {
    return <ErrorState onRetry={() => void hostel.refetch()} />;
  }

  const summary = hostel.data;
  const occupancy = summary.occupancy;

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={summary.hostel.name}
        description={`${HOSTEL_TYPE_LABELS[summary.hostel.type]} hostel${
          summary.hostel.wardenStaff
            ? ` · Warden ${summary.hostel.wardenStaff.firstName} ${summary.hostel.wardenStaff.lastName}`
            : ""
        }${summary.hostel.phone ? ` · ${summary.hostel.phone}` : ""}`}
      >
        <Link href="/admin/hostel">
          <Button variant="outline">Back</Button>
        </Link>
        <Can permission="hostel.manage">
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button onClick={() => setAddingRoom(true)}>New room</Button>
        </Can>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Beds" value={String(occupancy.total)} />
        <StatCard title="Boarders" value={String(occupancy.occupied)} />
        <StatCard title="Free beds" value={String(occupancy.available)} />
        <StatCard
          title="Occupancy"
          value={`${Math.round(occupancy.utilization)}%`}
        />
      </div>

      {summary.capacityNote && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {summary.capacityNote}. The declared capacity is what the school
          wrote down; the beds are what exists.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {(["FREE", "TAKEN", "MAINTENANCE"] as BedState[]).map((state) => (
          <span key={state} className="flex items-center gap-1.5">
            <span
              className={cn("h-3 w-5 rounded border", BED_STATE_CLASS[state])}
            />
            {BED_STATE_LABELS[state]}
          </span>
        ))}
        <span>Click a free bed to put a student in it.</span>
      </div>

      {rooms.isLoading ? (
        <LoadingBlock />
      ) : rooms.isError ? (
        <ErrorState onRetry={() => void rooms.refetch()} />
      ) : byFloor.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description="Add the first room — its beds are generated with it."
        />
      ) : (
        <div className="space-y-6">
          {byFloor.map(([floor, floorRooms]) => (
            <section key={floor} className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                {floor === 0 ? "Ground floor" : `Floor ${floor}`} ·{" "}
                {floorRooms.length} room(s)
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {floorRooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    onEdit={() => setEditingRoom(room)}
                    onDelete={() => setDeletingRoom(room)}
                    onPickBed={setAllocatingBedId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <HostelDialog
          hostel={summary.hostel}
          onClose={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
      {(addingRoom || editingRoom) && (
        <RoomDialog
          hostelId={id}
          room={editingRoom ?? undefined}
          onClose={() => {
            setAddingRoom(false);
            setEditingRoom(null);
            refresh();
          }}
        />
      )}
      {deletingRoom && (
        <ConfirmDialog
          open
          title={`Delete room ${deletingRoom.roomNo}?`}
          description="Its beds go with it. A room with boarders in it is refused."
          confirmLabel="Delete"
          onConfirm={() => removeRoom.mutate(deletingRoom.id)}
          onOpenChange={(open) => !open && setDeletingRoom(null)}
        />
      )}
      {allocatingBedId && (
        <AllocateDialog
          bedId={allocatingBedId}
          onClose={() => {
            setAllocatingBedId(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}

function RoomCard({
  room,
  onEdit,
  onDelete,
  onPickBed,
}: {
  room: Room;
  onEdit: () => void;
  onDelete: () => void;
  onPickBed: (bedId: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">Room {room.roomNo}</p>
          <p className="text-xs text-muted-foreground">
            {ROOM_TYPE_LABELS[room.type]} · ৳{formatBdt(room.monthlyFee)}/month
            · {room.occupancy.occupied}/{room.occupancy.total} taken
          </p>
        </div>
        <Badge variant={room.status === "ACTIVE" ? "default" : "secondary"}>
          {room.status === "ACTIVE" ? "In use" : "Maintenance"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {room.beds.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            No beds generated yet.
          </span>
        ) : (
          room.beds.map((bed) => {
            const state: BedState =
              bed.status === "MAINTENANCE"
                ? "MAINTENANCE"
                : bed.held || bed.status === "OCCUPIED"
                  ? "TAKEN"
                  : "FREE";
            const free = state === "FREE" && room.status === "ACTIVE";
            return (
              <button
                key={bed.id}
                type="button"
                disabled={!free}
                title={`${bed.bedNo} — ${BED_STATE_LABELS[state]}`}
                onClick={() => free && onPickBed(bed.id)}
                className={cn(
                  "rounded border px-2 py-1 text-xs transition-colors",
                  BED_STATE_CLASS[state],
                  free ? "cursor-pointer" : "cursor-default",
                )}
              >
                {bed.bedNo}
              </button>
            );
          })
        )}
      </div>

      {room.bedCountNote && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {room.bedCountNote}
        </p>
      )}

      <Can permission="hostel.manage">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </Can>
    </div>
  );
}

function RoomDialog({
  hostelId,
  room,
  onClose,
}: {
  hostelId: string;
  room?: Room;
  onClose: () => void;
}) {
  const [form, setForm] = useState<RoomInput>({
    roomNo: room?.roomNo ?? "",
    floor: room?.floor ?? 0,
    type: room?.type ?? "STANDARD",
    bedCount: room?.bedCount ?? 2,
    monthlyFee: room ? Number(room.monthlyFee) : 0,
    status: room?.status ?? "ACTIVE",
    notes: room?.notes ?? "",
    generateBeds: true,
  });

  const save = useMutation({
    mutationFn: () =>
      room
        ? hostelApi.updateRoom(room.id, form)
        : hostelApi.createRoom(hostelId, form),
    onSuccess: () => {
      toast.success(room ? "Room updated" : "Room added");
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "New room"}</DialogTitle>
          <DialogDescription>
            The seat rent lives on the room, not the building — an AC double
            and a six-bed shared room are not the same product.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="room-no">Room number</Label>
              <Input
                id="room-no"
                value={form.roomNo}
                onChange={(e) => setForm({ ...form, roomNo: e.target.value })}
                placeholder="A-101"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="room-floor">Floor</Label>
              <Input
                id="room-floor"
                type="number"
                value={form.floor ?? 0}
                onChange={(e) =>
                  setForm({ ...form, floor: Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="room-type">Type</Label>
              <select
                id="room-type"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={form.type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    type: e.target.value as RoomInput["type"],
                  })
                }
              >
                {ROOM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ROOM_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="room-status">Status</Label>
              <select
                id="room-status"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value as RoomInput["status"],
                  })
                }
              >
                <option value="ACTIVE">In use</option>
                <option value="MAINTENANCE">Maintenance</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Taking a room out of service is refused while anybody is in
                it — move them first.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="room-beds">Beds</Label>
              <Input
                id="room-beds"
                type="number"
                min={1}
                max={50}
                value={form.bedCount}
                onChange={(e) =>
                  setForm({ ...form, bedCount: Number(e.target.value) })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="room-fee">Monthly seat rent (BDT)</Label>
              <Input
                id="room-fee"
                type="number"
                min={0}
                step="0.01"
                value={form.monthlyFee}
                onChange={(e) =>
                  setForm({ ...form, monthlyFee: Number(e.target.value) })
                }
              />
            </div>
          </div>

          {!room && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.generateBeds !== false}
                onChange={(e) =>
                  setForm({ ...form, generateBeds: e.target.checked })
                }
              />
              Generate the beds now (a room with no beds shows as full)
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || form.roomNo.trim().length === 0}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
