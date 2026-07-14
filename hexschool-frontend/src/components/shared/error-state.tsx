"use client";

import { AlertTriangle } from "lucide-react";
import { isAxiosError } from "axios";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api/axios";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
  className?: string;
}

/** Extracts the backend error envelope message when present. */
function messageFrom(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as ApiError | undefined;
    if (data?.error?.message) return data.error.message;
    if (error.code === "ERR_NETWORK") return "Cannot reach the server.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

export function ErrorState({
  error,
  title = "Failed to load",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-10 text-destructive" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {messageFrom(error)}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
