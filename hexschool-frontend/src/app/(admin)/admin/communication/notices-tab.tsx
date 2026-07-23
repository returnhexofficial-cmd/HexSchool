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
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  communicationApi,
  CreateNoticeInput,
  NoticeAudience,
} from "@/lib/api/communication";
import {
  BULK_AUDIENCE_LABELS,
  NOTICE_AUDIENCES,
} from "@/lib/validations/communication";

export function NoticesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const notices = useQuery({
    queryKey: ["comm", "notices"],
    queryFn: () => communicationApi.listNotices({ limit: 50 }),
  });

  const publish = useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) =>
      communicationApi.publishNotice(id, publish),
    onSuccess: () => {
      toast.success("Notice updated.");
      void qc.invalidateQueries({ queryKey: ["comm", "notices"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });
  const del = useMutation({
    mutationFn: communicationApi.deleteNotice,
    onSuccess: () => {
      toast.success("Notice deleted.");
      void qc.invalidateQueries({ queryKey: ["comm", "notices"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (notices.isLoading) return <LoadingBlock />;
  if (notices.isError)
    return <ErrorState onRetry={() => void notices.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can permission="notice.manage">
          <Button size="sm" onClick={() => setOpen(true)}>
            New notice
          </Button>
        </Can>
      </div>

      {notices.data && notices.data.rows.length === 0 ? (
        <EmptyState title="No notices" description="Post a circular for the board." />
      ) : (
        <div className="space-y-3">
          {notices.data?.rows.map((n) => (
            <div key={n.id} className="rounded-md border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{n.title}</h3>
                    {n.pinned && <Badge variant="secondary">Pinned</Badge>}
                    <Badge variant="outline">
                      {BULK_AUDIENCE_LABELS[n.audience]}
                    </Badge>
                    {n.isPublished ? (
                      <Badge className="bg-green-600">Published</Badge>
                    ) : (
                      <Badge variant="outline">Draft</Badge>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                    {n.body}
                  </p>
                </div>
                <Can permission="notice.publish">
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        publish.mutate({ id: n.id, publish: !n.isPublished })
                      }
                    >
                      {n.isPublished ? "Unpublish" : "Publish"}
                    </Button>
                    <Can permission="notice.manage">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => del.mutate(n.id)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </div>
                </Can>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <NoticeDialog
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["comm", "notices"] });
          }}
        />
      )}
    </div>
  );
}

function NoticeDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CreateNoticeInput>({
    title: "",
    body: "",
    audience: "ALL",
    isWebsiteVisible: false,
    pinned: false,
  });

  const save = useMutation({
    mutationFn: () => communicationApi.createNotice(form),
    onSuccess: () => {
      toast.success("Notice created.");
      onSaved();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New notice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <Textarea
              rows={4}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Audience</Label>
            <Select
              value={form.audience}
              onValueChange={(v) =>
                setForm({ ...form, audience: v as NoticeAudience })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTICE_AUDIENCES.map((a) => (
                  <SelectItem key={a} value={a}>
                    {BULK_AUDIENCE_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.pinned}
                onCheckedChange={(v) => setForm({ ...form, pinned: v === true })}
              />
              Pin to top
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isWebsiteVisible}
                onCheckedChange={(v) =>
                  setForm({ ...form, isWebsiteVisible: v === true })
                }
              />
              Show on website
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!form.title || !form.body || save.isPending}
              onClick={() => save.mutate()}
            >
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
