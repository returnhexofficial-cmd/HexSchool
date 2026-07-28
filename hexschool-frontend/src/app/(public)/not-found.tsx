import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Branded 404 for the public website (roadmap §5). */
export default function SiteNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="text-6xl font-semibold text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        We could not find that page
      </h1>
      <p className="text-muted-foreground">
        It may have been moved or unpublished. Try the notice board or the
        home page.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/notices">Notice board</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/contact">Contact</Link>
        </Button>
      </div>
    </div>
  );
}
