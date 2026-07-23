"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  BulkAudience,
  BulkPreview,
  communicationApi,
  NotificationChannel,
  smsParts,
} from "@/lib/api/communication";
import {
  BULK_AUDIENCE_LABELS,
  NOTICE_AUDIENCES,
} from "@/lib/validations/communication";

export function ComposeTab({ sessionId }: { sessionId: string | null }) {
  const [channel, setChannel] = useState<NotificationChannel>("SMS");
  const [audience, setAudience] = useState<BulkAudience>("PARENTS");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [customNumbers, setCustomNumbers] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [preview, setPreview] = useState<BulkPreview | null>(null);

  const numbersList = customNumbers
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);

  const buildInput = () => ({
    channel,
    audience,
    sessionId: sessionId ?? undefined,
    message,
    subject: channel === "EMAIL" ? subject : undefined,
    customNumbers: audience === "RAW" ? numbersList : undefined,
    emergency,
  });

  const previewMut = useMutation({
    mutationFn: () => communicationApi.bulkPreview(buildInput()),
    onSuccess: setPreview,
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const sendMut = useMutation({
    mutationFn: () =>
      communicationApi.bulkSend({ ...buildInput(), batchKey: crypto.randomUUID() }),
    onSuccess: (res) => {
      toast.success(`Queued ${res.queued} message(s).`);
      setPreview(null);
      setMessage("");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const rosterAudience = audience !== "RAW";
  const missingSession = rosterAudience && !sessionId;
  const parts = smsParts(message);

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
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
          <Label>Audience</Label>
          <Select
            value={audience}
            onValueChange={(v) => {
              setAudience(v as BulkAudience);
              setPreview(null);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...NOTICE_AUDIENCES, "RAW"].map((a) => (
                <SelectItem key={a} value={a}>
                  {BULK_AUDIENCE_LABELS[a as BulkAudience]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {audience === "RAW" && (
        <div className="space-y-1.5">
          <Label>Custom numbers</Label>
          <Textarea
            rows={3}
            placeholder="01710000000, 01820000000 …"
            value={customNumbers}
            onChange={(e) => setCustomNumbers(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {numbersList.length} number(s), comma or newline separated.
          </p>
        </div>
      )}

      {channel === "EMAIL" && (
        <div className="space-y-1.5">
          <Label>Subject</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Message</Label>
        <Textarea
          rows={4}
          placeholder="Use {{name}} for the recipient's name."
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setPreview(null);
          }}
        />
        {channel === "SMS" && (
          <p className="text-xs text-muted-foreground">
            {message.length} chars · {parts.parts} SMS part(s)
            {parts.unicode && " · Bangla/unicode (70/part)"}
          </p>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={emergency}
          onCheckedChange={(v) => setEmergency(v === true)}
        />
        Emergency — bypass quiet hours and rate spreading
      </label>

      {missingSession && (
        <EmptyState
          title="Pick a session"
          description="A roster audience resolves in the header session. Switch it, or use custom numbers."
        />
      )}

      {preview && (
        <div className="rounded-md border bg-muted/40 p-4 text-sm">
          <p>
            <strong>{preview.recipients}</strong> recipient(s)
            {channel === "SMS" && (
              <>
                {" · "}
                {preview.totalParts} part(s) · est. cost {preview.estimatedCost} BDT
              </>
            )}
          </p>
          {preview.requiresLargePermission && (
            <p className="mt-1 text-amber-600">
              Above the large-audience threshold — needs notification.bulk.large.
            </p>
          )}
          {preview.sample && (
            <p className="mt-2 text-muted-foreground">Sample: {preview.sample}</p>
          )}
        </div>
      )}

      <Can permission="notification.bulk">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!message || missingSession || previewMut.isPending}
            onClick={() => previewMut.mutate()}
          >
            {previewMut.isPending ? "Estimating…" : "Preview & estimate"}
          </Button>
          <Button
            disabled={!preview || preview.recipients === 0 || sendMut.isPending}
            onClick={() => sendMut.mutate()}
          >
            {sendMut.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </Can>
    </div>
  );
}
