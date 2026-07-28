"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Branded 500 for the public website (roadmap §5). */
export default function SiteError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="text-6xl font-semibold text-muted-foreground">500</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-muted-foreground">
        The page could not be loaded. Please try again in a moment.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
