"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { apiErrorMessage } from "@/lib/api/auth";
import type { GalleryItem, ListParams, Paged } from "@/lib/api/website";

/**
 * A config-driven CRUD workspace for the Website CMS tabs — the
 * `MasterCrud` idea (M06) applied to content: eight entities that differ
 * only in their fields and columns get one implementation instead of
 * eight near-identical files.
 *
 * It deliberately stops short of a rich-text editor: content is authored
 * as HTML in a textarea, and the server sanitizes it against an
 * allow-list on write. A WYSIWYG is a UI upgrade, not a data one.
 */

export type FieldKind =
  | "text"
  | "textarea"
  | "html"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "gallery-items";

export interface CmsField {
  name: string;
  label: string;
  kind: FieldKind;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  help?: string;
  full?: boolean;
  rows?: number;
}

export interface CmsColumn<T> {
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export interface CmsCrudProps<T extends { id: string }> {
  entity: string;
  queryKey: string;
  managePermission: string;
  fields: CmsField[];
  columns: Array<CmsColumn<T>>;
  list: (params: ListParams) => Promise<Paged<T>>;
  create: (input: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, input: Record<string, unknown>) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  publish?: (id: string, publish: boolean) => Promise<unknown>;
  /** Maps a row back onto form values when editing. */
  toForm: (row: T) => Record<string, unknown>;
  defaults: Record<string, unknown>;
  emptyTitle: string;
  emptyDescription: string;
  searchable?: boolean;
}

export function CmsCrud<T extends { id: string; status?: string }>({
  entity,
  queryKey,
  managePermission,
  fields,
  columns,
  list,
  create,
  update,
  remove,
  publish,
  toForm,
  defaults,
  emptyTitle,
  emptyDescription,
  searchable = true,
}: CmsCrudProps<T>) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>(defaults);

  const rows = useQuery({
    queryKey: ["website", queryKey, search],
    queryFn: () => list({ limit: 50, search: search || undefined }),
  });

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["website", queryKey] });

  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      editing ? update(editing.id, input) : create(input),
    onSuccess: () => {
      toast.success(`${entity} saved.`);
      close();
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const togglePublish = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      publish!(id, next),
    onSuccess: () => {
      toast.success(`${entity} updated.`);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const del = useMutation({
    mutationFn: (id: string) => remove(id),
    onSuccess: () => {
      toast.success(`${entity} deleted.`);
      setDeleting(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const open = (row: T | null) => {
    setEditing(row);
    setCreating(row === null);
    setValues(row ? { ...defaults, ...toForm(row) } : defaults);
  };
  const close = () => {
    setEditing(null);
    setCreating(false);
    setValues(defaults);
  };

  const dialogOpen = creating || editing !== null;

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // Empty strings mean "not set" for every optional field here; sending
    // "" would overwrite a real value with a blank on the server.
    const payload = Object.fromEntries(
      Object.entries(values).filter(
        ([, value]) => value !== "" && value !== undefined,
      ),
    );
    save.mutate(payload);
  };

  const body = useMemo(() => {
    if (rows.isLoading) return <LoadingBlock />;
    if (rows.isError) return <ErrorState onRetry={() => void rows.refetch()} />;
    if (!rows.data || rows.data.items.length === 0) {
      return <EmptyState title={emptyTitle} description={emptyDescription} />;
    }

    return (
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.header} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
              <TableHead className="w-px text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.data.items.map((row) => (
              <TableRow key={row.id}>
                {columns.map((column) => (
                  <TableCell key={column.header} className={column.className}>
                    {column.render(row)}
                  </TableCell>
                ))}
                <TableCell className="text-right whitespace-nowrap">
                  <Can permission={managePermission}>
                    {publish ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mr-2"
                        onClick={() =>
                          togglePublish.mutate({
                            id: row.id,
                            next: row.status !== "PUBLISHED",
                          })
                        }
                      >
                        {row.status === "PUBLISHED" ? "Unpublish" : "Publish"}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => open(row)}
                      className="mr-1"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleting(row)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.data, rows.isLoading, rows.isError, columns]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {searchable ? (
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            className="h-9 max-w-xs"
          />
        ) : null}
        <div className="ml-auto">
          <Can permission={managePermission}>
            <Button size="sm" onClick={() => open(null)}>
              <Plus className="mr-1.5 size-4" />
              New {entity.toLowerCase()}
            </Button>
          </Can>
        </div>
      </div>

      {body}

      <Dialog open={dialogOpen} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${entity.toLowerCase()}` : `New ${entity.toLowerCase()}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => (
                <FieldControl
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  onChange={(value) =>
                    setValues((prev) => ({ ...prev, [field.name]: value }))
                  }
                />
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete this ${entity.toLowerCase()}?`}
        description="It disappears from the public website immediately."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleting) del.mutate(deleting.id);
        }}
      />
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: CmsField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `cms-${field.name}`;
  const wrapper = field.full || field.kind === "html" || field.kind === "gallery-items";

  return (
    <div className={`space-y-1.5 ${wrapper ? "sm:col-span-2" : ""}`}>
      {field.kind !== "checkbox" ? (
        <Label htmlFor={id}>{field.label}</Label>
      ) : null}

      {field.kind === "text" || field.kind === "date" ? (
        <Input
          id={id}
          type={field.kind === "date" ? "date" : "text"}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      {field.kind === "number" ? (
        <Input
          id={id}
          type="number"
          value={(value as number | string) ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : Number(event.target.value))
          }
        />
      ) : null}

      {field.kind === "textarea" || field.kind === "html" ? (
        <Textarea
          id={id}
          rows={field.rows ?? (field.kind === "html" ? 10 : 3)}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          className={field.kind === "html" ? "font-mono text-xs" : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}

      {field.kind === "select" ? (
        <Select
          value={(value as string) ?? ""}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {field.kind === "checkbox" ? (
        <label className="flex items-center gap-2 pt-6 text-sm">
          <Checkbox
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          {field.label}
        </label>
      ) : null}

      {field.kind === "gallery-items" ? (
        <GalleryItemsEditor
          items={(value as GalleryItem[]) ?? []}
          onChange={(items) => onChange(items)}
        />
      ) : null}

      {field.help ? (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      ) : null}
    </div>
  );
}

/**
 * Album media rows. The album is saved as a SET — this list replaces
 * whatever is stored, which is why re-ordering is just moving a row here
 * rather than a per-item PATCH.
 */
function GalleryItemsEditor({
  items,
  onChange,
}: {
  items: GalleryItem[];
  onChange: (items: GalleryItem[]) => void;
}) {
  const update = (index: number, patch: Partial<GalleryItem>) =>
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );

  return (
    <div className="space-y-2 rounded-md border p-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items yet.</p>
      ) : null}
      {items.map((item, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <Select
            value={item.type}
            onValueChange={(next) =>
              update(index, { type: next as GalleryItem["type"] })
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IMAGE">Image</SelectItem>
              <SelectItem value="VIDEO_URL">Video URL</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={item.url}
            placeholder="https://…"
            onChange={(event) => update(index, { url: event.target.value })}
            className="min-w-40 flex-1"
          />
          <Input
            value={item.caption ?? ""}
            placeholder="Caption"
            onChange={(event) => update(index, { caption: event.target.value })}
            className="min-w-32 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...items,
            {
              type: "IMAGE",
              url: "",
              caption: "",
              displayOrder: items.length,
            },
          ])
        }
      >
        <Plus className="mr-1.5 size-4" />
        Add item
      </Button>
    </div>
  );
}

/** Shared status pill for the CMS tables. */
export function StatusBadge({ status }: { status?: string }) {
  return status === "PUBLISHED" ? (
    <Badge className="bg-green-600">Published</Badge>
  ) : (
    <Badge variant="outline">Draft</Badge>
  );
}
