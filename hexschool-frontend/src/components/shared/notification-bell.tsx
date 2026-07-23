"use client";

import { Bell } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { communicationApi } from "@/lib/api/communication";
import { useAuth } from "@/lib/store/hooks";
import { cn } from "@/lib/utils";

/**
 * The in-app notification bell (Module 17). Polls the inbox every 30s
 * (SSE/WebSocket is a Phase 3 upgrade) and shows an unread badge; opening
 * it marks everything read. Keyed on the logged-in user server-side.
 */
export function NotificationBell() {
  const qc = useQueryClient();
  const { status } = useAuth();

  const inbox = useQuery({
    queryKey: ["comm", "inbox"],
    queryFn: () => communicationApi.inbox(),
    enabled: status === "authenticated",
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const markRead = useMutation({
    mutationFn: () => communicationApi.markRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["comm", "inbox"] }),
  });

  const unread = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && unread > 0) markRead.mutate();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-medium text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">Notifications</div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing new.
            </p>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "border-b px-3 py-2 text-sm last:border-0",
                  !n.readAt && "bg-accent/40",
                )}
              >
                <p className="whitespace-pre-line">{n.bodyRendered}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
