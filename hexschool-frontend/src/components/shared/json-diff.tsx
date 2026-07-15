import { cn } from "@/lib/utils";

interface JsonDiffProps {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  className?: string;
}

const format = (value: unknown): string =>
  value === undefined ? "—" : JSON.stringify(value, null, 2) ?? "—";

/**
 * Side-by-side old/new viewer for audit entries (roadmap M03 §5):
 * union of keys, changed rows highlighted. Pure render — no state.
 */
export function JsonDiff({ oldValues, newValues, className }: JsonDiffProps) {
  const keys = [
    ...new Set([
      ...Object.keys(oldValues ?? {}),
      ...Object.keys(newValues ?? {}),
    ]),
  ].sort();

  if (keys.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        No recorded values.
      </p>
    );
  }

  return (
    <div className={cn("overflow-x-auto rounded-lg border", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left">
            <th className="px-3 py-2 font-medium">Field</th>
            <th className="px-3 py-2 font-medium">Old</th>
            <th className="px-3 py-2 font-medium">New</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {keys.map((key) => {
            const oldVal = oldValues?.[key];
            const newVal = newValues?.[key];
            const changed = JSON.stringify(oldVal) !== JSON.stringify(newVal);
            return (
              <tr
                key={key}
                data-changed={changed || undefined}
                className={cn(changed && "bg-amber-500/10")}
              >
                <td className="px-3 py-2 align-top font-mono">{key}</td>
                <td className="px-3 py-2 align-top">
                  <pre
                    className={cn(
                      "whitespace-pre-wrap break-all font-mono text-xs",
                      changed && "text-destructive line-through",
                    )}
                  >
                    {format(oldVal)}
                  </pre>
                </td>
                <td className="px-3 py-2 align-top">
                  <pre
                    className={cn(
                      "whitespace-pre-wrap break-all font-mono text-xs",
                      changed && "font-medium text-green-700 dark:text-green-400",
                    )}
                  >
                    {format(newVal)}
                  </pre>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
