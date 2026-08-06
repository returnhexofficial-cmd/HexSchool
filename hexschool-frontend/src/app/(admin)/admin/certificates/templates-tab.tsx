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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  CERTIFICATE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  templateApi,
  type CertificateTemplate,
  type CertificateType,
} from "@/lib/api/documents";

const STARTER = `<p>This is to certify that <strong>{{student_name}}</strong>,
son/daughter of {{father_name}} and {{mother_name}}, bearing student ID
{{student_uid}}, was a student of this institution in {{class}} during the
{{session}} session.</p>
<p>Their conduct during this period was {{conduct}}.</p>
<p>We wish them every success.</p>`;

/**
 * The template designer (roadmap §5): HTML editor, variable chips, preview
 * pane, background upload.
 *
 * **The preview renders the SANITIZED body**, not the raw keystrokes — an
 * editor has to see what will be *stored*, or they spend an afternoon
 * styling markup the allow-list sanitizer removes on save. And an unknown
 * variable is reported here rather than silently blanked, because a
 * testimonial with a hole where the GPA should be is a document the school
 * hands over without noticing.
 */
export function TemplatesTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CertificateTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    type: "TRANSFER" as CertificateType,
    name: "",
    bodyHtml: STARTER,
    backgroundUrl: "",
    isActive: true,
  });

  const list = useQuery({
    queryKey: ["certificate-templates"],
    queryFn: () => templateApi.list(),
  });

  const palette = useQuery({
    queryKey: ["certificate-templates", "variables"],
    queryFn: () => templateApi.variables(),
  });

  const preview = useMutation({
    mutationFn: () =>
      templateApi.preview(editing?.id ?? null, { bodyHtml: form.bodyHtml }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["certificate-templates"] });

  const save = useMutation({
    mutationFn: () => {
      const input = {
        type: form.type,
        name: form.name,
        bodyHtml: form.bodyHtml,
        backgroundUrl: form.backgroundUrl || undefined,
        isActive: form.isActive,
      };
      return editing
        ? templateApi.update(editing.id, input)
        : templateApi.create(input);
    },
    onSuccess: () => {
      toast.success(editing ? "Template saved" : "Template created");
      close();
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => templateApi.remove(id),
    onSuccess: () => {
      toast.success("Template deleted");
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const open = (template: CertificateTemplate | null) => {
    setEditing(template);
    setCreating(template === null);
    setForm({
      type: template?.type ?? "TRANSFER",
      name: template?.name ?? "",
      bodyHtml: template?.bodyHtml ?? STARTER,
      backgroundUrl: template?.backgroundUrl ?? "",
      isActive: template?.isActive ?? true,
    });
    preview.reset();
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
    preview.reset();
  };

  const rows = list.data ?? [];
  const isOpen = creating || editing !== null;

  return (
    <div className="space-y-4">
      <Can permission="certificate.template.manage">
        <Button onClick={() => open(null)}>New template</Button>
      </Can>

      {list.isLoading && <LoadingBlock />}
      {list.isError && <ErrorState onRetry={() => void list.refetch()} />}

      {list.isSuccess && rows.length === 0 && (
        <EmptyState
          title="No layouts yet"
          description="A certificate can be issued without one — it prints a plain wording — but a layout is what puts the school's own words on the page."
        />
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((template) => (
          <Card key={template.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{template.name}</span>
                {!template.isActive && (
                  <Badge variant="outline">Retired</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant="secondary">
                {CERTIFICATE_TYPE_LABELS[template.type]}
              </Badge>
              <p className="line-clamp-3 text-xs text-muted-foreground">
                {template.bodyHtml.replace(/<[^>]+>/g, " ").slice(0, 180)}
              </p>
              <Can permission="certificate.template.manage">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open(template)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.mutate(template.id)}
                  >
                    Delete
                  </Button>
                </div>
              </Can>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.name}` : "New certificate template"}
            </DialogTitle>
            <DialogDescription>
              Click a variable to copy it. Anything outside the palette is
              refused on save — a variable that is not in it always renders
              blank, which is how a certificate goes out with a hole in it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-name">Name</Label>
                <Input
                  id="tpl-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tpl-type">Type</Label>
                <select
                  id="tpl-type"
                  className="h-9 rounded-md border bg-transparent px-3 text-sm"
                  value={form.type}
                  onChange={(e) =>
                    setForm({ ...form, type: e.target.value as CertificateType })
                  }
                >
                  {CERTIFICATE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {CERTIFICATE_TYPE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tpl-bg">Stationery scan (S3 key or URL)</Label>
                <Input
                  id="tpl-bg"
                  value={form.backgroundUrl}
                  onChange={(e) =>
                    setForm({ ...form, backgroundUrl: e.target.value })
                  }
                  placeholder="branding/letterhead.png"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tpl-body">Body</Label>
                <textarea
                  id="tpl-body"
                  className="min-h-64 rounded-md border bg-transparent p-3 font-mono text-xs"
                  value={form.bodyHtml}
                  onChange={(e) =>
                    setForm({ ...form, bodyHtml: e.target.value })
                  }
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                />
                Available when issuing
              </label>

              <div className="flex flex-wrap gap-1">
                {(palette.data?.variables ?? []).map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    className="rounded border px-2 py-0.5 font-mono text-xs hover:bg-muted"
                    onClick={() => {
                      setForm((prev) => ({
                        ...prev,
                        bodyHtml: `${prev.bodyHtml}{{${variable}}}`,
                      }));
                    }}
                  >
                    {`{{${variable}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => preview.mutate()}
                disabled={preview.isPending}
              >
                Preview
              </Button>

              {preview.data && (
                <>
                  {preview.data.unknownVariables.length > 0 && (
                    <p className="rounded-md border border-destructive p-2 text-xs text-destructive">
                      Unknown variable(s):{" "}
                      {preview.data.unknownVariables
                        .map((v) => `{{${v}}}`)
                        .join(", ")}
                      . Saving will be refused.
                    </p>
                  )}
                  {preview.data.sample && (
                    <p className="text-xs text-muted-foreground">
                      Rendered against a specimen student, not a real record.
                    </p>
                  )}
                  <div
                    className="prose prose-sm max-w-none rounded-md border bg-white p-6 text-black dark:bg-neutral-100"
                    // The server sanitized this body through M19's
                    // allow-list on the way here, which is the whole point
                    // of previewing the sanitized text rather than the raw
                    // keystrokes.
                    dangerouslySetInnerHTML={{ __html: preview.data.html }}
                  />
                </>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || form.name.trim().length < 2}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
