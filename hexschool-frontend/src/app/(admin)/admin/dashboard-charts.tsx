"use client";

/**
 * Minimal, dependency-free dashboard chart primitives (Module 18). A
 * horizontal bar row and a sparkline-style column chart built with plain
 * CSS/SVG — no chart library is vendored, and a dashboard does not need
 * one for these shapes. Theme-aware via Tailwind tokens.
 */

export function BarRow({
  label,
  value,
  max,
  format,
}: {
  label: string;
  value: number;
  max: number;
  format?: (n: number) => string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded bg-primary"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

export function ColumnChart({
  data,
  format,
}: {
  data: Array<{ label: string; value: number }>;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-2" style={{ height: 140 }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-primary/80"
            style={{ height: `${Math.max(2, (d.value / max) * 110)}px` }}
            title={format ? format(d.value) : String(d.value)}
            aria-label={`${d.label}: ${format ? format(d.value) : d.value}`}
          />
          <span className="text-[10px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
