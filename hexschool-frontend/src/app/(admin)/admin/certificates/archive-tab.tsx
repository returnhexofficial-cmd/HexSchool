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
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api/auth";
import { formatDate } from "@/lib/utils/date";
import {
  ARCHIVE_LINK_LABELS,
  archiveApi,
  type ArchiveLinkType,
  type FolderNode,
} from "@/lib/api/documents";

/**
 * The archive explorer (roadmap §5): folder tree, upload, tag filter,
 * preview.
 *
 * **Deleting a folder is refused while anything is in it**, and the tree
 * says how much — a cascade would be the convenient implementation and is
 * exactly wrong for a filing cabinet, where a mis-clicked delete that took
 * forty scanned circulars with it is not recoverable by anybody who was
 * not watching.
 */
export function ArchiveTab() {
  const queryClient = useQueryClient();
  const [folderId, setFolderId] = useState<string>("");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderForm, setFolderForm] = useState({ name: "", parentId: "" });
  const [uploading, setUploading] = useState(false);
  const [fileForm, setFileForm] = useState({
    title: "",
    fileUrl: "",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    tags: "",
    linkedType: "" as ArchiveLinkType | "",
    linkedId: "",
    notes: "",
  });

  const tree = useQuery({
    queryKey: ["archive", "folders"],
    queryFn: () => archiveApi.tree(),
  });

  const tags = useQuery({
    queryKey: ["archive", "tags"],
    queryFn: () => archiveApi.tags(),
  });

  const files = useQuery({
    queryKey: ["archive", "files", { folderId, tag, search }],
    queryFn: () =>
      archiveApi.listFiles({
        limit: 100,
        folderId: folderId || undefined,
        tags: tag ? [tag] : undefined,
        search: search || undefined,
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["archive"] });

  const createFolder = useMutation({
    mutationFn: () =>
      archiveApi.createFolder({
        name: folderForm.name,
        parentId: folderForm.parentId || undefined,
      }),
    onSuccess: () => {
      toast.success("Folder created");
      setCreatingFolder(false);
      setFolderForm({ name: "", parentId: "" });
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const removeFolder = useMutation({
    mutationFn: (id: string) => archiveApi.removeFolder(id),
    onSuccess: () => {
      toast.success("Folder removed");
      setFolderId("");
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const createFile = useMutation({
    mutationFn: () =>
      archiveApi.createFile({
        folderId,
        title: fileForm.title,
        fileUrl: fileForm.fileUrl,
        mimeType: fileForm.mimeType,
        sizeBytes: Number(fileForm.sizeBytes),
        tags: fileForm.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        linkedType: fileForm.linkedType || undefined,
        linkedId: fileForm.linkedId || undefined,
        notes: fileForm.notes || undefined,
      }),
    onSuccess: () => {
      toast.success("Filed");
      setUploading(false);
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const removeFile = useMutation({
    mutationFn: (id: string) => archiveApi.removeFile(id),
    onSuccess: () => {
      toast.success("Removed from the archive");
      void invalidate();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const flat = flatten(tree.data ?? []);
  const rows = files.data?.data ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* ── folder tree ── */}
      <div className="space-y-3">
        <Can permission="archive.manage">
          <Button size="sm" onClick={() => setCreatingFolder(true)}>
            New folder
          </Button>
        </Can>

        {tree.isLoading && <LoadingBlock />}
        {tree.isError && <ErrorState onRetry={() => void tree.refetch()} />}

        <div className="rounded-md border">
          <button
            type="button"
            className={cn(
              "block w-full p-2 text-left text-sm hover:bg-muted/50",
              folderId === "" && "bg-muted font-medium",
            )}
            onClick={() => setFolderId("")}
          >
            All documents
          </button>
          {flat.map(({ node, depth }) => (
            <div key={node.id} className="flex items-center">
              <button
                type="button"
                className={cn(
                  "flex-1 p-2 text-left text-sm hover:bg-muted/50",
                  folderId === node.id && "bg-muted font-medium",
                )}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => setFolderId(node.id)}
              >
                {node.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {node.totalFileCount}
                </span>
              </button>
              <Can permission="archive.manage">
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2 text-xs"
                  onClick={() => removeFolder.mutate(node.id)}
                >
                  ×
                </Button>
              </Can>
            </div>
          ))}
        </div>

        {(tags.data ?? []).length > 0 && (
          <div className="space-y-1">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1">
              {(tags.data ?? []).map((entry) => (
                <button
                  key={entry.tag}
                  type="button"
                  onClick={() => setTag(tag === entry.tag ? "" : entry.tag)}
                >
                  <Badge variant={tag === entry.tag ? "default" : "outline"}>
                    {entry.tag} · {entry.count}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── files ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="arch-search">Search</Label>
            <Input
              id="arch-search"
              className="w-64"
              placeholder="Title, note or tag"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Can permission="archive.upload">
            <Button
              disabled={!folderId}
              onClick={() => setUploading(true)}
              title={folderId ? undefined : "Pick a folder first"}
            >
              File a document
            </Button>
          </Can>
        </div>

        {files.isLoading && <LoadingBlock />}
        {files.isError && <ErrorState onRetry={() => void files.refetch()} />}

        {files.isSuccess && rows.length === 0 && (
          <EmptyState
            title="Nothing filed here"
            description="Pick a folder and file a document into it."
          />
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-3 font-medium">Title</th>
                  <th className="p-3 font-medium">Tags</th>
                  <th className="p-3 font-medium">About</th>
                  <th className="p-3 font-medium">Filed</th>
                  <th className="p-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((file) => (
                  <tr key={file.id} className="border-t">
                    <td className="p-3">
                      {file.title}
                      <div className="text-xs text-muted-foreground">
                        {file.mimeType} · {Math.ceil(file.sizeBytes / 1024)} KB
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {file.tags.map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="p-3">
                      {file.linkedType
                        ? ARCHIVE_LINK_LABELS[file.linkedType]
                        : "—"}
                    </td>
                    <td className="p-3">{formatDate(file.createdAt)}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              const { url } = await archiveApi.downloadUrl(
                                file.id,
                              );
                              window.open(url, "_blank", "noopener");
                            } catch (error) {
                              toast.error(apiErrorMessage(error));
                            }
                          }}
                        >
                          Open
                        </Button>
                        <Can permission="archive.delete">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFile.mutate(file.id)}
                          >
                            Remove
                          </Button>
                        </Can>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── new folder ── */}
      <Dialog open={creatingFolder} onOpenChange={setCreatingFolder}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Folders nest. A folder cannot be deleted while anything is in
              it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                value={folderForm.name}
                onChange={(e) =>
                  setFolderForm({ ...folderForm, name: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="folder-parent">Inside</Label>
              <select
                id="folder-parent"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
                value={folderForm.parentId}
                onChange={(e) =>
                  setFolderForm({ ...folderForm, parentId: e.target.value })
                }
              >
                <option value="">Top level</option>
                {flat.map(({ node, depth }) => (
                  <option key={node.id} value={node.id}>
                    {"— ".repeat(depth)}
                    {node.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreatingFolder(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                folderForm.name.trim().length === 0 || createFolder.isPending
              }
              onClick={() => createFolder.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── file a document ── */}
      <Dialog open={uploading} onOpenChange={setUploading}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>File a document</DialogTitle>
            <DialogDescription>
              The file itself is uploaded to storage; this records where it
              is, what it is about, and how to find it again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="file-title">Title</Label>
              <Input
                id="file-title"
                value={fileForm.title}
                onChange={(e) =>
                  setFileForm({ ...fileForm, title: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="file-url">Storage key</Label>
              <Input
                id="file-url"
                value={fileForm.fileUrl}
                onChange={(e) =>
                  setFileForm({ ...fileForm, fileUrl: e.target.value })
                }
                placeholder="archive/board-circular-2026-04.pdf"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="file-mime">Type</Label>
                <Input
                  id="file-mime"
                  value={fileForm.mimeType}
                  onChange={(e) =>
                    setFileForm({ ...fileForm, mimeType: e.target.value })
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="file-size">Size (bytes)</Label>
                <Input
                  id="file-size"
                  type="number"
                  value={fileForm.sizeBytes}
                  onChange={(e) =>
                    setFileForm({
                      ...fileForm,
                      sizeBytes: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="file-tags">Tags (comma separated)</Label>
              <Input
                id="file-tags"
                value={fileForm.tags}
                onChange={(e) =>
                  setFileForm({ ...fileForm, tags: e.target.value })
                }
                placeholder="circular, board, 2026"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUploading(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                createFile.isPending ||
                fileForm.title.trim().length === 0 ||
                fileForm.fileUrl.trim().length === 0
              }
              onClick={() => createFile.mutate()}
            >
              File it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Depth-first flatten so the tree renders as an indented list. */
function flatten(
  nodes: FolderNode[],
  depth = 0,
): Array<{ node: FolderNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flatten(node.children, depth + 1),
  ]);
}
