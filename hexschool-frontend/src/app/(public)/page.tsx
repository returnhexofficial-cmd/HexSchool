import Link from "next/link";
import { Button } from "@/components/ui/button";

// Placeholder home — the real public website ships with Module 19 (CMS).
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">HexSchool SMIS</h1>
      <p className="max-w-md text-muted-foreground">
        School Management Information System. The public website arrives with
        the Website CMS module.
      </p>
      <Button asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    </main>
  );
}
