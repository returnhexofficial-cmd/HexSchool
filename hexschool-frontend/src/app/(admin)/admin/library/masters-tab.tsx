"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  authorApi,
  categoryApi,
  publisherApi,
  type MasterInput,
} from "@/lib/api/library";

type MasterKind = "categories" | "authors" | "publishers";

const KINDS: Array<[MasterKind, string, string]> = [
  ["categories", "Categories", "Fiction, Science, Reference — how the shelves are organised."],
  ["authors", "Authors", "Shared across titles; a name typed while cataloguing lands here."],
  ["publishers", "Publishers", "Optional on a book, useful when ordering replacements."],
];

/**
 * The three master APIs share one shape (they come from the same
 * `masterApi<T>` factory), so indexing them by kind is narrowed to that
 * shape rather than left as a union of three — otherwise every call site
 * would have to discriminate on a difference that does not exist.
 */
interface MasterApi {
  list: (query: {
    search?: string;
    limit?: number;
  }) => Promise<{ rows: MasterRow[]; total: number }>;
  create: (input: MasterInput) => Promise<unknown>;
  update: (id: string, input: MasterInput) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
}

const API: Record<MasterKind, MasterApi> = {
  categories: categoryApi as MasterApi,
  authors: authorApi as MasterApi,
  publishers: publisherApi as MasterApi,
};

interface MasterRow {
  id: string;
  name: string;
  nameBn?: string | null;
  description?: string | null;
  note?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * The three shelf masters, one screen. Deliberately plain: they are
 * name-and-a-note tables, and the interesting rule is the delete guard —
 * a master in use is refused with a count rather than cascading, so
 * "delete the Science category" can never be a way to lose four hundred
 * books (the M06 rule).
 */
export function MastersTab() {
  const [kind, setKind] = useState<MasterKind>("categories");
  const label = KINDS.find(([key]) => key === kind)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {KINDS.map(([key, title]) => (
          <Button
            key={key}
            variant={kind === key ? "secondary" : "ghost"}
            size="sm"
            className={cn(kind === key && "font-medium")}
            onClick={() => setKind(key)}
          >
            {title}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{label[2]}</p>
      <MasterList kind={kind} singular={label[1].replace(/e?s$/, "")} />
    </div>
  );
}

function MasterList({
  kind,
  singular,
}: {
  kind: MasterKind;
  singular: string;
}) {
  const qc = useQueryClient();
  const api = API[kind];
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MasterRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<MasterRow | null>(null);

  const list = useQuery({
    queryKey: ["library-masters", kind, search],
    queryFn: () => api.list({ search: search.trim() || undefined, limit: 100 }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      toast.success(`${singular} removed.`);
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["library-masters", kind] });
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const rows = list.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-64 space-y-1">
          <Label htmlFor={`${kind}-search`}>Search</Label>
          <Input
            id={`${kind}-search`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Can permission="library.catalog.manage">
          <Button onClick={() => setCreating(true)}>Add {singular.toLowerCase()}</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`No ${kind} yet`}
          description="Add one, or let the catalogue form create it as you type."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Bangla</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-sm">{row.nameBn ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.description ?? row.note ?? row.phone ?? "—"}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Can permission="library.catalog.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(row)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(row)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(creating || editing) && (
        <MasterDialog
          kind={kind}
          singular={singular}
          row={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove "${deleting?.name ?? ""}"?`}
        description="If any book still points at it the removal is refused, with a count — nothing is cascaded away."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function MasterDialog({
  kind,
  singular,
  row,
  onClose,
}: {
  kind: MasterKind;
  singular: string;
  row: MasterRow | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const api = API[kind];
  const [values, setValues] = useState<MasterInput>({
    name: row?.name ?? "",
    nameBn: row?.nameBn ?? "",
    description: row?.description ?? "",
    note: row?.note ?? "",
    phone: row?.phone ?? "",
    email: row?.email ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: MasterInput = { name: values.name.trim() };
      if (values.nameBn?.trim()) payload.nameBn = values.nameBn.trim();
      if (kind === "categories" && values.description?.trim()) {
        payload.description = values.description.trim();
      }
      if (kind === "authors" && values.note?.trim()) {
        payload.note = values.note.trim();
      }
      if (kind === "publishers") {
        if (values.phone?.trim()) payload.phone = values.phone.trim();
        if (values.email?.trim()) payload.email = values.email.trim();
      }
      return row ? api.update(row.id, payload) : api.create(payload);
    },
    onSuccess: () => {
      toast.success(row ? "Saved." : "Added.");
      void qc.invalidateQueries({ queryKey: ["library-masters", kind] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const nameTooShort = values.name.trim().length < 2;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {row ? `Edit ${singular.toLowerCase()}` : `Add ${singular.toLowerCase()}`}
          </DialogTitle>
          <DialogDescription>
            Names are unique per school among live rows — a deleted one frees
            its name again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="master-name">Name</Label>
            <Input
              id="master-name"
              value={values.name}
              onChange={(event) =>
                setValues((v) => ({ ...v, name: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="master-name-bn">Name (Bangla)</Label>
            <Input
              id="master-name-bn"
              value={values.nameBn ?? ""}
              onChange={(event) =>
                setValues((v) => ({ ...v, nameBn: event.target.value }))
              }
            />
          </div>
          {kind === "categories" && (
            <div className="space-y-1">
              <Label htmlFor="master-description">Description</Label>
              <Input
                id="master-description"
                value={values.description ?? ""}
                onChange={(event) =>
                  setValues((v) => ({ ...v, description: event.target.value }))
                }
              />
            </div>
          )}
          {kind === "authors" && (
            <div className="space-y-1">
              <Label htmlFor="master-note">Note</Label>
              <Input
                id="master-note"
                placeholder="Bangladeshi novelist"
                value={values.note ?? ""}
                onChange={(event) =>
                  setValues((v) => ({ ...v, note: event.target.value }))
                }
              />
            </div>
          )}
          {kind === "publishers" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="master-phone">Phone</Label>
                <Input
                  id="master-phone"
                  value={values.phone ?? ""}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, phone: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="master-email">Email</Label>
                <Input
                  id="master-email"
                  value={values.email ?? ""}
                  onChange={(event) =>
                    setValues((v) => ({ ...v, email: event.target.value }))
                  }
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={nameTooShort || save.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
