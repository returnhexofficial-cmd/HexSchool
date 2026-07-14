import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn("size-5 animate-spin text-muted-foreground", className)}
      aria-label="Loading"
    />
  );
}

/** Full-area centered spinner for page/section loading. */
export function LoadingBlock({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center p-16", className)}>
      <Spinner className="size-8" />
    </div>
  );
}

/** Skeleton stack approximating a form or detail card. */
export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 rounded-lg border p-6">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}
