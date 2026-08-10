"use client";

import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { academicApi } from "@/lib/api/academic";
import { structureApi } from "@/lib/api/structure";
import type { ReportParam } from "@/lib/api/analytics";

/**
 * The auto-generated parameter form — roadmap M29 §5's "param forms
 * auto-generated from params_schema", and the M18 debt it closes ("the
 * Reports hub links to endpoints but has no in-place param-form runner").
 *
 * **One control per declared type, and nothing hand-written per report.**
 * Forty-odd reports share this component, so a new report gets a working
 * form the moment its schema lands in the registry. That is the whole
 * point of the schema being data rather than code.
 *
 * The id-shaped types are the interesting ones. `session`, `class` and
 * `section` get real pickers, because those are the parameters people
 * actually change and typing a UUID is not a form. The rarer ones (exam,
 * route, item, account, vehicle, hostel, supplier) fall back to a text
 * field: a picker each would be seven more list endpoints on a page that
 * loads before you have chosen a report, and the honest half-measure is a
 * field that says what it wants. They are reachable from their own module
 * pages, which is where somebody copying an id already is.
 */

export type ParamValues = Record<string, string>;

export function ReportParamsForm({
  params,
  values,
  onChange,
}: {
  params: ReportParam[];
  values: ParamValues;
  onChange: (next: ParamValues) => void;
}) {
  const sessions = useQuery({
    queryKey: ["sessions", "for-reports"],
    queryFn: () => academicApi.listSessions({ limit: 100 }),
    enabled: params.some((p) => p.type === "session"),
  });
  const classes = useQuery({
    queryKey: ["classes", "for-reports"],
    queryFn: () => structureApi.classes.list({ limit: 100 }),
    enabled: params.some((p) => p.type === "class"),
  });
  const sections = useQuery({
    queryKey: ["sections", "for-reports"],
    queryFn: () => structureApi.sections.list({ limit: 100 }),
    enabled: params.some((p) => p.type === "section"),
  });

  if (params.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This report takes no parameters.
      </p>
    );
  }

  const set = (key: string, value: string) =>
    onChange({ ...values, [key]: value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {params.map((param) => {
        const value = values[param.key] ?? "";
        const id = `param-${param.key}`;

        const control = () => {
          switch (param.type) {
            case "session":
              return (
                <Select value={value} onValueChange={(v) => set(param.key, v)}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="Current session" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sessions.data?.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            case "class":
              return (
                <Select value={value} onValueChange={(v) => set(param.key, v)}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="All classes" />
                  </SelectTrigger>
                  <SelectContent>
                    {(classes.data?.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            case "section":
              return (
                <Select value={value} onValueChange={(v) => set(param.key, v)}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="All sections" />
                  </SelectTrigger>
                  <SelectContent>
                    {(sections.data?.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.class ? `${s.class.name} ${s.name}` : s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            case "enum":
              return (
                <Select value={value} onValueChange={(v) => set(param.key, v)}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(param.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            case "boolean":
              return (
                <Select value={value} onValueChange={(v) => set(param.key, v)}>
                  <SelectTrigger id={id}>
                    <SelectValue placeholder="No" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              );
            case "date":
              return (
                <Input
                  id={id}
                  type="date"
                  value={value}
                  onChange={(e) => set(param.key, e.target.value)}
                />
              );
            case "month":
              return (
                <Input
                  id={id}
                  type="month"
                  value={value}
                  onChange={(e) => set(param.key, e.target.value)}
                />
              );
            case "number":
              return (
                <Input
                  id={id}
                  type="number"
                  min={param.min}
                  max={param.max}
                  value={value}
                  onChange={(e) => set(param.key, e.target.value)}
                />
              );
            default:
              return (
                <Input
                  id={id}
                  value={value}
                  placeholder={
                    param.type === "text" ? undefined : `${param.type} id`
                  }
                  onChange={(e) => set(param.key, e.target.value)}
                />
              );
          }
        };

        return (
          <div key={param.key} className="space-y-1.5">
            <Label htmlFor={id}>
              {param.label}
              {param.required && (
                <span className="ml-1 text-destructive" aria-hidden>
                  *
                </span>
              )}
            </Label>
            {control()}
            {param.help && (
              <p className="text-xs text-muted-foreground">{param.help}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Blank values are **dropped, not sent as empty strings**.
 *
 * An optional filter left alone must mean "no filter". Posting `""` would
 * fail the engine's uuid check on a `sessionId` the user never touched,
 * and the error would name a field they never saw.
 */
export function toParamPayload(values: ParamValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== "" && value !== undefined && value !== null) out[key] = value;
  }
  return out;
}
