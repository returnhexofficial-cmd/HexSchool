"use client";

/**
 * Minimal, dependency-free chart primitives (Module 18; shared with the
 * M16 fee reports and the M17 SMS-credit dashboard). A horizontal bar row,
 * a column chart and a gap-aware line, built with plain CSS/SVG — no chart
 * library is vendored, and none of these shapes needs one. Theme-aware via
 * Tailwind tokens.
 *
 * House rules, applied to every primitive here: one axis, one series (the
 * heading names it, so no legend box), thin marks, a recessive baseline
 * instead of a grid, labels only at the extremes rather than on every
 * point, and text in ink tokens rather than the series colour.
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

/**
 * A single-series line for change-over-time (the M18 attendance trend).
 *
 * `null` is a **gap, not a zero** — a day nobody marked attendance is not a
 * day everybody was absent, and drawing it at the baseline would invent a
 * slump. The path therefore breaks across nulls rather than interpolating.
 *
 * One series, so no legend (the heading names it); only the first, last and
 * extreme points are labelled, and every point carries a hover title.
 */
export function Sparkline({
  data,
  format = (n) => String(n),
  height = 120,
}: {
  data: Array<{ label: string; value: number | null }>;
  format?: (n: number) => string;
  height?: number;
}) {
  const present = data.filter(
    (d): d is { label: string; value: number } => d.value !== null,
  );
  if (present.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
    );
  }

  const values = present.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Pad the band so a flat series does not collapse onto one row.
  const lo = min === max ? Math.max(0, min - 5) : min;
  const hi = min === max ? max + 5 : max;

  const W = 100;
  const H = 40;
  const x = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * W);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;

  // Break the path at every gap so nulls are not bridged.
  const segments: string[] = [];
  let current: string[] = [];
  data.forEach((d, i) => {
    if (d.value === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${x(i)},${y(d.value)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const peak = present.reduce((a, b) => (b.value > a.value ? b : a));
  const trough = present.reduce((a, b) => (b.value < a.value ? b : a));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height, width: "100%" }}
        role="img"
        aria-label={`Trend from ${data[0]?.label} to ${data[data.length - 1]?.label}: peak ${format(peak.value)}, low ${format(trough.value)}`}
      >
        {/* Recessive baseline only — no grid. */}
        <line
          x1={0}
          y1={H}
          x2={W}
          y2={H}
          className="stroke-border"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {data.map((d, i) =>
          d.value === null ? null : (
            <circle
              key={i}
              cx={x(i)}
              cy={y(d.value)}
              r={2}
              className="fill-primary"
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </circle>
          ),
        )}
      </svg>
      {/* Text wears ink tokens, never the series colour. */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>
          low {format(trough.value)} · peak {format(peak.value)}
        </span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
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
