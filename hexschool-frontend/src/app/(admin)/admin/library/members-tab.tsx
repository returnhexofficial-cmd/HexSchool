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
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  formatBdt,
  libraryReportApi,
  memberApi,
  MEMBER_STATUS_LABELS,
  MEMBER_TYPES,
  MEMBER_TYPE_LABELS,
  type LibraryMember,
  type LibraryMemberStatus,
  type LibraryMemberType,
} from "@/lib/api/library";

const ALL = "__all__";

/**
 * Library cards. A card belongs to a **person** — student, teacher or
 * office staff alike — which is why this list is one table rather than
 * three, and why the type filter is a filter rather than a tab.
 */
export function MembersTab() {
  const [search, setSearch] = useState("");
  const [personType, setPersonType] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [enrolling, setEnrolling] = useState(false);
  const [editing, setEditing] = useState<LibraryMember | null>(null);

  const list = useQuery({
    queryKey: ["library-members", search, personType, status],
    queryFn: () =>
      memberApi.list({
        search: search.trim() || undefined,
        personType:
          personType === ALL ? undefined : (personType as LibraryMemberType),
        status: status === ALL ? undefined : (status as LibraryMemberStatus),
        limit: 50,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56 space-y-1">
            <Label htmlFor="member-search">Card number</Label>
            <Input
              id="member-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="w-40 space-y-1">
            <Label>Type</Label>
            <Select value={personType} onValueChange={setPersonType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everyone</SelectItem>
                {MEMBER_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {MEMBER_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40 space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                {(
                  ["ACTIVE", "SUSPENDED", "CLOSED"] as LibraryMemberStatus[]
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {MEMBER_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Can permission="library.member.manage">
          <Button onClick={() => setEnrolling(true)}>Enrol a member</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : (list.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          title="No cards yet"
          description="Enrol somebody here, or just issue them a book — a card is created on the first loan unless the school switched that off."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Card</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Owed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data?.rows ?? []).map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-mono text-xs">
                    {member.cardNo}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {member.person?.name ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[member.person?.reference, member.person?.context]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {MEMBER_TYPE_LABELS[member.personType]}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {member.standing.openLoans} / {member.maxBooks}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {member.standing.overdueLoans > 0 ? (
                      <Badge variant="destructive">
                        {member.standing.overdueLoans}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {member.standing.outstandingFine > 0
                      ? formatBdt(member.standing.outstandingFine)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        member.status === "ACTIVE" ? "default" : "secondary"
                      }
                    >
                      {MEMBER_STATUS_LABELS[member.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can permission="library.export">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void libraryReportApi.downloadMember(member.id)
                        }
                      >
                        History
                      </Button>
                    </Can>
                    <Can permission="library.member.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(member)}
                      >
                        Edit
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {enrolling && <EnrolDialog onClose={() => setEnrolling(false)} />}
      {editing && (
        <EditMemberDialog
          member={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EnrolDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const debounced = useDebounce(term, 300);

  const people = useQuery({
    queryKey: ["library-people", debounced],
    queryFn: () => memberApi.searchPeople(debounced),
    enabled: debounced.trim().length >= 2,
  });

  const enrol = useMutation({
    mutationFn: (input: {
      personType: LibraryMemberType;
      personId: string;
    }) => memberApi.enrol(input),
    onSuccess: (member) => {
      toast.success(`Card ${member.cardNo} issued.`);
      void qc.invalidateQueries({ queryKey: ["library-members"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Enrol a library member</DialogTitle>
          <DialogDescription>
            Search by name, student UID or employee ID. Students, teachers and
            staff all hold the same kind of card.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="people-search">Who?</Label>
          <Input
            id="people-search"
            autoFocus
            placeholder="At least two characters"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {(people.data ?? []).map((person) => (
            <div
              key={`${person.personType}:${person.personId}`}
              className="flex items-center justify-between rounded-md border p-2"
            >
              <div>
                <div className="text-sm font-medium">{person.name}</div>
                <div className="text-xs text-muted-foreground">
                  {MEMBER_TYPE_LABELS[person.personType]} · {person.reference}
                </div>
              </div>
              {person.member ? (
                <Badge variant="secondary">{person.member.cardNo}</Badge>
              ) : (
                <Button
                  size="sm"
                  disabled={enrol.isPending}
                  onClick={() =>
                    enrol.mutate({
                      personType: person.personType,
                      personId: person.personId,
                    })
                  }
                >
                  Issue card
                </Button>
              )}
            </div>
          ))}
          {debounced.trim().length >= 2 &&
            !people.isLoading &&
            (people.data?.length ?? 0) === 0 && (
              <p className="p-2 text-sm text-muted-foreground">
                Nobody matched.
              </p>
            )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  onClose,
}: {
  member: LibraryMember;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [maxBooks, setMaxBooks] = useState(String(member.maxBooks));
  const [status, setStatus] = useState<LibraryMemberStatus>(member.status);
  const [reason, setReason] = useState(member.statusReason ?? "");

  const save = useMutation({
    mutationFn: () =>
      memberApi.update(member.id, {
        maxBooks: Number(maxBooks) || undefined,
        status,
        statusReason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Card updated.");
      void qc.invalidateQueries({ queryKey: ["library-members"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member.cardNo}</DialogTitle>
          <DialogDescription>
            {member.person?.name ?? "This member"} —{" "}
            {member.standing.openLoans} book(s) out,{" "}
            {formatBdt(member.standing.outstandingFine)} owed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="max-books">Borrowing limit</Label>
            <Input
              id="max-books"
              type="number"
              min={1}
              max={100}
              value={maxBooks}
              onChange={(event) => setMaxBooks(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Stored on the card, so raising it for one student does not raise
              it for everybody — and editing the school-wide setting later
              leaves this alone.
            </p>
          </div>

          <div className="space-y-1">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as LibraryMemberStatus)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["ACTIVE", "SUSPENDED", "CLOSED"] as LibraryMemberStatus[]
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {MEMBER_STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {status === "CLOSED" && member.standing.openLoans > 0 && (
              <p className="text-xs text-destructive">
                {member.standing.openLoans} book(s) are still out — closing the
                card will be refused until they come back.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="status-reason">Reason</Label>
            <Textarea
              id="status-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
