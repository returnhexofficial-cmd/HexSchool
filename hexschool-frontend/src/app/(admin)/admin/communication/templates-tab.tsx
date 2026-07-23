"use client";

import { useMemo, useState } from "react";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  communicationApi,
  NotificationChannel,
  NotificationLanguage,
} from "@/lib/api/communication";
import { NOTIFICATION_CHANNEL_LABELS } from "@/lib/validations/communication";

export function TemplatesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const templates = useQuery({
    queryKey: ["comm", "templates"],
    queryFn: communicationApi.listTemplates,
  });
  const codes = useQuery({
    queryKey: ["comm", "codes"],
    queryFn: communicationApi.codes,
  });

  const del = useMutation({
    mutationFn: communicationApi.deleteTemplate,
    onSuccess: () => {
      toast.success("Template removed.");
      void qc.invalidateQueries({ queryKey: ["comm", "templates"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (templates.isLoading) return <LoadingBlock />;
  if (templates.isError)
    return <ErrorState onRetry={() => void templates.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Can permission="notification.template.manage">
          <Button size="sm" onClick={() => setOpen(true)}>
            New template
          </Button>
        </Can>
      </div>

      {templates.data && templates.data.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Defaults are seeded per school; add EN/BN variants here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Lang</TableHead>
              <TableHead>Body</TableHead>
              <TableHead>Active</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.data?.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.code}</TableCell>
                <TableCell>{NOTIFICATION_CHANNEL_LABELS[t.channel]}</TableCell>
                <TableCell>{t.language}</TableCell>
                <TableCell className="max-w-md truncate text-muted-foreground">
                  {t.body}
                </TableCell>
                <TableCell>
                  {t.isActive ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Badge variant="outline">Off</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Can permission="notification.template.manage">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => del.mutate(t.id)}
                    >
                      Delete
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {open && (
        <TemplateDialog
          codes={codes.data ?? []}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void qc.invalidateQueries({ queryKey: ["comm", "templates"] });
          }}
        />
      )}
    </div>
  );
}

function TemplateDialog({
  codes,
  onClose,
  onSaved,
}: {
  codes: { code: string; variables: string[] }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(codes[0]?.code ?? "");
  const [channel, setChannel] = useState<NotificationChannel>("SMS");
  const [language, setLanguage] = useState<NotificationLanguage>("EN");
  const [body, setBody] = useState("");

  const allowed = useMemo(
    () => codes.find((c) => c.code === code)?.variables ?? [],
    [codes, code],
  );

  const preview = useQuery({
    queryKey: ["comm", "preview", code, body],
    queryFn: () => communicationApi.previewTemplate({ code, body }),
    enabled: Boolean(code && body),
  });

  const save = useMutation({
    mutationFn: () =>
      communicationApi.createTemplate({ code, channel, language, body }),
    onSuccess: () => {
      toast.success("Template saved.");
      onSaved();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {codes.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as NotificationChannel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SMS">SMS</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="IN_APP">In-app</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select
                value={language}
                onValueChange={(v) => setLanguage(v as NotificationLanguage)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EN">EN</SelectItem>
                  <SelectItem value="BN">BN</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Body</Label>
            <Textarea
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Variables: {allowed.map((v) => `{{${v}}}`).join(" ") || "none"}
            </p>
            {preview.data && (
              <p className="text-xs">
                {preview.data.segments} part(s)
                {preview.data.unicode && " · unicode"}
                {preview.data.unknownVariables.length > 0 && (
                  <span className="text-red-600">
                    {" "}
                    · unknown: {preview.data.unknownVariables.join(", ")}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!code || !body || save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
