/** Centered single-card canvas shared by all login/reset flows. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 p-4 sm:p-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">HexSchool</h1>
          <p className="text-sm text-muted-foreground">
            School Management Information System
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}
