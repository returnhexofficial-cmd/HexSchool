import { z } from "zod";

/**
 * Mirrors the backend Module 29 DTOs and `cron.engine.ts`.
 *
 * The cron half is a **deliberate duplicate** of the server's parser, and
 * worth the duplication for one reason: §7's rule is a refusal, and a
 * refusal a user only discovers on submit is a form that wastes their
 * time. The server stays the authority — this copy exists so the dialog
 * can say "that fires every five minutes, which is not allowed" while they
 * are still typing.
 *
 * It is deliberately the *same* rule, not a looser one. A client check
 * that accepted more than the server would be worse than none.
 */

const EMAIL = z.string().email();

export const scheduleSchema = z.object({
  reportCode: z.string().min(1, "Choose a report"),
  name: z
    .string()
    .trim()
    .min(2, "Give the schedule a name")
    .max(160, "That name is too long"),
  cron: z
    .string()
    .trim()
    .refine((value) => parseCron(value).ok, {
      message:
        "That is not a valid schedule — the minute must be a single number, and sub-hourly is not allowed",
    })
    .refine((value) => nextRun(value) !== null, {
      message: "That schedule can never fire — check the day and month",
    }),
  format: z.enum(["XLSX", "CSV", "PDF", "JSON"]),
  emails: z
    .string()
    .transform((raw) =>
      raw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .refine((list) => list.length > 0, {
      message: "Name at least one recipient",
    })
    .refine((list) => list.every((e) => EMAIL.safeParse(e).success), {
      message: "One of those is not a valid email address",
    }),
});

export type ScheduleInput = z.input<typeof scheduleSchema>;

export const runReportSchema = z.object({
  format: z.enum(["XLSX", "CSV", "PDF", "JSON"]),
  params: z.record(z.string(), z.unknown()).optional(),
});

// ── the cron reader (mirrors backend `calc/cron.engine.ts`) ────────────

const MINUTE_RE = /^([0-9]|[1-5][0-9])$/;

interface Fields {
  minute: number;
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  bothDayFieldsRestricted: boolean;
}

function expand(raw: string, min: number, max: number): number[] | null {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (piece === "") return null;
    const [rangePart, stepPart] = piece.split("/");
    let step = 1;
    if (stepPart !== undefined) {
      const parsed = Number(stepPart);
      if (!Number.isInteger(parsed) || parsed < 1) return null;
      step = parsed;
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(rangePart);
      hi = lo;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(expression: string): {
  ok: boolean;
  fields?: Fields;
} {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return { ok: false };
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = parts;
  // The whole of §7's whitelist: a single literal minute.
  if (!MINUTE_RE.test(minuteRaw)) return { ok: false };

  const hours = expand(hourRaw, 0, 23);
  const daysOfMonth = expand(domRaw, 1, 31);
  const months = expand(monthRaw, 1, 12);
  const daysOfWeek = expand(dowRaw, 0, 6);
  if (!hours || !daysOfMonth || !months || !daysOfWeek) return { ok: false };

  return {
    ok: true,
    fields: {
      minute: Number(minuteRaw),
      hours,
      daysOfMonth,
      months,
      daysOfWeek,
      bothDayFieldsRestricted: domRaw !== "*" && dowRaw !== "*",
    },
  };
}

const DHAKA_OFFSET_MS = 6 * 3_600_000;

/** Whether the expression can ever fire — `0 9 30 2 *` cannot. */
export function nextRun(expression: string, after = new Date()): Date | null {
  const parsed = parseCron(expression);
  if (!parsed.ok || !parsed.fields) return null;
  const f = parsed.fields;

  const wall = new Date(after.getTime() + DHAKA_OFFSET_MS);
  const cursor = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
  );

  for (let day = 0; day <= 1465; day += 1) {
    const probe = new Date(cursor + day * 86_400_000);
    if (!f.months.includes(probe.getUTCMonth() + 1)) continue;
    const domHit = f.daysOfMonth.includes(probe.getUTCDate());
    const dowHit = f.daysOfWeek.includes(probe.getUTCDay());
    // Vixie's rule: both restricted means OR, not AND.
    const dayHit = f.bothDayFieldsRestricted
      ? domHit || dowHit
      : domHit && dowHit;
    if (!dayHit) continue;

    for (const hour of f.hours) {
      const at = probe.getTime() + hour * 3_600_000 + f.minute * 60_000;
      if (at > wall.getTime()) return new Date(at - DHAKA_OFFSET_MS);
    }
  }
  return null;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** The plain-English reading shown under the cron field. */
export function describeCron(expression: string): string | null {
  const parsed = parseCron(expression);
  if (!parsed.ok || !parsed.fields) return null;
  const { minute, hours, daysOfMonth, daysOfWeek } = parsed.fields;

  const times = hours
    .map((h) => `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)
    .join(", ");

  const everyDom = daysOfMonth.length === 31;
  const everyDow = daysOfWeek.length === 7;

  const when = everyDom && everyDow
    ? "every day"
    : everyDom
      ? `every ${daysOfWeek.map((d) => DAY_NAMES[d]).join(", ")}`
      : everyDow
        ? `on the ${daysOfMonth.map(ordinal).join(", ")}`
        : `on the ${daysOfMonth.map(ordinal).join(", ")} and every ${daysOfWeek
            .map((d) => DAY_NAMES[d])
            .join(", ")}`;

  return `At ${times} (Asia/Dhaka) ${when}`;
}
