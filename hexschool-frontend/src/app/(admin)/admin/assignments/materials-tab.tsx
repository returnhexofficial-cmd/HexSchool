"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  humanBytes,
  LINK_MATERIAL_TYPES,
  materialApi,
  MATERIAL_TYPES,
  MATERIAL_TYPE_LABELS,
  type Attachment,
  type MaterialType,
} from "@/lib/api/assignment";
import { structureApi } from "@/lib/api/structure";
import { useAcademicSession } from "@/lib/hooks/use-academic-session";
import {
  fileIssue,
  materialSchema,
  type MaterialFormValues,
} from "@/lib/validations/assignment";
import { FieldError } from "./assignments-tab";

const ALL = "__all__";
const CLASS_WIDE = "__class_wide__";

/** Mirrors `assignment.max_attachment_mb` / `allowed_file_types` defaults. */
const CLIENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  allowedTypes: ["pdf", "doc", "docx", "jpg", "jpeg", "png"] as const,
};

export function MaterialsTab() {
  const qc = useQueryClient();
  const { selected: session } = useAcademicSession();
  const [type, setType] = useState<string>(ALL);
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(
    null,
  );

  const list = useQuery({
    queryKey: ["learning-materials", session?.id, type, mine, search],
    queryFn: () =>
      materialApi.list({
        sessionId: session?.id,
        type: type === ALL ? undefined : (type as MaterialType),
        mine: mine || undefined,
        search: search.trim() || undefined,
        limit: 50,
      }),
    enabled: Boolean(session),
  });

  const remove = useMutation({
    mutationFn: (id: string) => materialApi.remove(id),
    onSuccess: () => {
      toast.success("Removed from the library.");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["learning-materials"] });
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(apiErrorMessage(err));
    },
  });

  if (!session) {
    return (
      <EmptyState
        title="Pick an academic session"
        description="Learning materials are scoped to a session — choose one in the header."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44 space-y-1">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {MATERIAL_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {MATERIAL_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56 space-y-1">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Title…"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={mine}
              onCheckedChange={(v) => setMine(v === true)}
            />
            Only what I uploaded
          </label>
        </div>

        <Can permission="material.manage">
          <Button onClick={() => setCreating(true)}>Add material</Button>
        </Can>
      </div>

      {list.isLoading ? (
        <LoadingBlock />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : (list.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          title="The shelf is empty"
          description="Upload class notes or slides, or point students at a video."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Class / section</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Contents</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data?.rows ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.title}
                    {m.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {m.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {MATERIAL_TYPE_LABELS[m.type]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {m.class.name}{" "}
                    {m.section ? (
                      m.section.name
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        (all sections)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{m.subject.name}</TableCell>
                  <TableCell className="max-w-[16rem]">
                    {m.linkUrl && (
                      <a
                        className="block truncate text-sm hover:underline"
                        href={m.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {m.linkUrl}
                      </a>
                    )}
                    {m.fileUrls.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {m.fileUrls.length} file(s)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Can permission="material.manage">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDeleting({ id: m.id, title: m.title })
                        }
                      >
                        Remove
                      </Button>
                    </Can>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && (
        <MaterialDialog
          sessionId={session.id}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ["learning-materials"] });
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Remove "${deleting?.title ?? ""}"?`}
        description="Students will no longer see it in their library."
        confirmLabel="Remove"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
        onOpenChange={(open) => !open && setDeleting(null)}
      />
    </div>
  );
}

function MaterialDialog({
  sessionId,
  onClose,
  onCreated,
}: {
  sessionId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(materialSchema),
    defaultValues: {
      sessionId,
      classId: "",
      sectionId: "",
      subjectId: "",
      type: "NOTE",
      title: "",
      description: "",
      linkUrl: "",
      files: [],
    },
  });

  const type = form.watch("type");
  const classId = form.watch("classId");
  const isLink = LINK_MATERIAL_TYPES.includes(type as MaterialType);

  const classes = useQuery({
    queryKey: ["classes", "material-form"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
  });
  const sections = useQuery({
    queryKey: ["sections", sessionId, "material-form"],
    queryFn: () => structureApi.sections.list({ sessionId, limit: 100 }),
  });
  const subjects = useQuery({
    queryKey: ["subjects", "material-form"],
    queryFn: () => structureApi.subjects.list({ limit: 200 }),
  });

  const create = useMutation({
    mutationFn: (values: MaterialFormValues) =>
      materialApi.create({
        sessionId: values.sessionId,
        classId: values.classId,
        sectionId: values.sectionId || undefined,
        subjectId: values.subjectId,
        type: values.type,
        title: values.title,
        description: values.description || undefined,
        linkUrl: values.linkUrl || undefined,
        files,
      }),
    onSuccess: () => {
      toast.success("Added to the library.");
      onCreated();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    // Refuse locally first: a 12 MB photo should not travel over a phone
    // connection just to be rejected at the far end.
    const issue = fileIssue(file, CLIENT_LIMITS);
    if (issue) {
      toast.error(issue);
      return;
    }
    setUploading(true);
    try {
      const uploaded = await materialApi.uploadFile(file);
      setFiles((prev) => [
        ...prev,
        {
          key: uploaded.key,
          name: uploaded.name,
          size: uploaded.size,
          contentType: uploaded.contentType,
        },
      ]);
      form.setValue("files", [...files, uploaded], { shouldValidate: true });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const sectionOptions = (sections.data?.data ?? []).filter(
    (s) => !classId || s.classId === classId,
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add learning material</DialogTitle>
          <DialogDescription>
            Leave the section empty to share it with every section of the
            class.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Class</Label>
              <Select
                value={classId}
                onValueChange={(v) => {
                  form.setValue("classId", v, { shouldValidate: true });
                  form.setValue("sectionId", "");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a class" />
                </SelectTrigger>
                <SelectContent>
                  {(classes.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={form.formState.errors.classId?.message} />
            </div>

            <div className="space-y-1">
              <Label>Section</Label>
              <Select
                value={form.watch("sectionId") || CLASS_WIDE}
                onValueChange={(v) =>
                  form.setValue("sectionId", v === CLASS_WIDE ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CLASS_WIDE}>All sections</SelectItem>
                  {sectionOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Subject</Label>
              <Select
                value={form.watch("subjectId")}
                onValueChange={(v) =>
                  form.setValue("subjectId", v, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a subject" />
                </SelectTrigger>
                <SelectContent>
                  {(subjects.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={form.formState.errors.subjectId?.message} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) =>
                  form.setValue("type", v as MaterialType, {
                    shouldValidate: true,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {MATERIAL_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input {...form.register("title")} maxLength={200} />
              <FieldError message={form.formState.errors.title?.message} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea rows={3} {...form.register("description")} />
          </div>

          {isLink ? (
            <div className="space-y-1">
              <Label>Link (https)</Label>
              <Input
                {...form.register("linkUrl")}
                placeholder="https://www.youtube.com/watch?v=…"
              />
              <FieldError message={form.formState.errors.linkUrl?.message} />
              <p className="text-xs text-muted-foreground">
                Only hosts on the school&rsquo;s allow-list are accepted
                (YouTube and Google Drive by default).
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Files</Label>
              <Input
                type="file"
                disabled={uploading}
                onChange={(e) => void onPickFile(e.target.files?.[0])}
              />
              {uploading && (
                <p className="text-xs text-muted-foreground">Uploading…</p>
              )}
              {files.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {files.map((f) => (
                    <li
                      key={f.key}
                      className="flex items-center justify-between rounded border px-2 py-1"
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {humanBytes(f.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <FieldError
                message={
                  form.formState.errors.files?.message as string | undefined
                }
              />
              <p className="text-xs text-muted-foreground">
                Or paste a link instead:
              </p>
              <Input
                {...form.register("linkUrl")}
                placeholder="https://…"
              />
              <FieldError message={form.formState.errors.linkUrl?.message} />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || uploading}>
              {create.isPending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
