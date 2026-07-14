"use client";

// Catches errors thrown by the root layout itself; must render its own
// <html>/<body> because the layout is gone at that point.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <h1>Something went wrong</h1>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            cursor: "pointer",
            border: "1px solid #ccc",
            borderRadius: "6px",
            background: "transparent",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
