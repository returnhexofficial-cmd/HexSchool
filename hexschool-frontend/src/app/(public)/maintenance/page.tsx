import { Wrench } from "lucide-react";

export const metadata = { title: "Under maintenance" };

export default function MaintenancePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <Wrench className="size-12 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold">We&apos;ll be right back</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        HexSchool SMIS is undergoing scheduled maintenance. Please check back
        in a few minutes.
      </p>
    </main>
  );
}
