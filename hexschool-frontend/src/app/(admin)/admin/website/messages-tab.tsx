"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  websiteApi,
  type ContactMessage,
  type ContactMessageStatus,
} from "@/lib/api/website";
import { CONTACT_STATUS_LABELS } from "@/lib/validations/website";

/**
 * The contact-form inbox. Status is evidence-bearing on the server (READ
 * stamps `read_at`, REPLIED stamps `replied_at`, enforced by a CHECK), so
 * this UI only ever sends the intended status and lets the API record
 * when it happened.
 */
export function MessagesTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ContactMessageStatus | "ALL">("ALL");
  const [deleting, setDeleting] = useState<ContactMessage | null>(null);

  const messages = useQuery({
    queryKey: ["website", "messages", filter],
    queryFn: () =>
      websiteApi.listMessages({
        limit: 50,
        ...(filter === "ALL" ? {} : { status: filter }),
      }),
  });

  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ["website", "messages"] });

  const setStatus = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: ContactMessageStatus;
    }) => websiteApi.setMessageStatus(id, { status }),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const del = useMutation({
    mutationFn: (id: string) => websiteApi.deleteMessage(id),
    onSuccess: () => {
      toast.success("Message deleted.");
      setDeleting(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select
          value={filter}
          onValueChange={(value) =>
            setFilter(value as ContactMessageStatus | "ALL")
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All messages</SelectItem>
            <SelectItem value="NEW">New</SelectItem>
            <SelectItem value="READ">Read</SelectItem>
            <SelectItem value="REPLIED">Replied</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {messages.isLoading ? (
        <LoadingBlock />
      ) : messages.isError ? (
        <ErrorState onRetry={() => void messages.refetch()} />
      ) : !messages.data || messages.data.items.length === 0 ? (
        <EmptyState
          title="No messages"
          description="Messages from the website contact form land here."
        />
      ) : (
        <div className="space-y-3">
          {messages.data.items.map((message) => (
            <div key={message.id} className="rounded-md border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">
                      {message.subject || "(no subject)"}
                    </h3>
                    <Badge
                      variant={message.status === "NEW" ? "default" : "outline"}
                    >
                      {CONTACT_STATUS_LABELS[message.status]}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {message.name}
                    {message.phone ? ` · ${message.phone}` : ""}
                    {message.email ? ` · ${message.email}` : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm">
                    {message.body}
                  </p>
                </div>

                <Can permission="website.message.manage">
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {message.status !== "READ" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setStatus.mutate({ id: message.id, status: "READ" })
                        }
                      >
                        Mark read
                      </Button>
                    ) : null}
                    {message.status !== "REPLIED" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setStatus.mutate({
                            id: message.id,
                            status: "REPLIED",
                          })
                        }
                      >
                        Mark replied
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(message)}
                    >
                      Delete
                    </Button>
                  </div>
                </Can>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title="Delete this message?"
        description="The visitor's message is removed from the inbox."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleting) del.mutate(deleting.id);
        }}
      />
    </div>
  );
}
