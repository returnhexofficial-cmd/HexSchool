"use client";

import { use, useState } from "react";
import { notFound } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  SECRET_MASK,
  schoolApi,
  type SettingView,
  type SettingsGroup,
} from "@/lib/api/school";
import { usePermissions } from "@/lib/hooks/use-permissions";

/** Groups served by this generic page (profile/grading have their own). */
const GENERIC_GROUPS: SettingsGroup[] = [
  "general",
  "academic",
  "sms",
  "email",
  "payment",
  "attendance",
  "exam",
  "fees",
];

export default function SettingsGroupPage({
  params,
}: {
  params: Promise<{ group: string }>;
}) {
  const { group } = use(params);
  if (!GENERIC_GROUPS.includes(group as SettingsGroup)) notFound();
  return <GroupLoader group={group as SettingsGroup} />;
}

function GroupLoader({ group }: { group: SettingsGroup }) {
  const query = useQuery({
    queryKey: ["settings", group],
    queryFn: () => schoolApi.getSettings(group),
  });

  if (query.isPending) return <LoadingBlock />;
  if (query.isError) {
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }
  return (
    <GroupForm
      // Remount with fresh local state after every successful save.
      key={JSON.stringify(query.data)}
      group={group}
      settings={query.data}
    />
  );
}

function GroupForm({
  group,
  settings,
}: {
  group: SettingsGroup;
  settings: SettingView[];
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const editable = can("settings.update");

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(settings.map((s) => [s.key, s.value])),
  );
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const save = useMutation({
    mutationFn: () => schoolApi.updateSettings(group, values),
    onSuccess: () => {
      toast.success("Settings saved");
      void queryClient.invalidateQueries({ queryKey: ["settings", group] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const sendTest = useMutation({
    mutationFn: () =>
      group === "sms" ? schoolApi.testSms() : schoolApi.testEmail(),
    onSuccess: (result) =>
      result.ok ? toast.success(result.detail) : toast.error(result.detail),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const set = (key: string, value: unknown) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const toggleReveal = (key: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {settings.map((setting) => {
          const value = values[setting.key];
          const id = `setting-${setting.key}`;

          if (setting.type === "boolean") {
            return (
              <label key={setting.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={Boolean(value)}
                  disabled={!editable}
                  onChange={(e) => set(setting.key, e.target.checked)}
                />
                {setting.label}
              </label>
            );
          }

          const isSecret = setting.secret;
          const masked = isSecret && value === SECRET_MASK;
          return (
            <div key={setting.key} className="space-y-2">
              <Label htmlFor={id}>
                {setting.label}
                {isSecret && masked ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (saved — leave untouched to keep)
                  </span>
                ) : null}
              </Label>
              <div className="flex gap-2">
                <Input
                  id={id}
                  type={
                    isSecret && !revealed.has(setting.key)
                      ? "password"
                      : setting.type === "number"
                        ? "number"
                        : "text"
                  }
                  value={
                    setting.type === "json"
                      ? JSON.stringify(value)
                      : String(value ?? "")
                  }
                  disabled={!editable}
                  onChange={(e) => {
                    if (setting.type === "number") {
                      set(setting.key, Number(e.target.value));
                    } else if (setting.type === "json") {
                      try {
                        set(setting.key, JSON.parse(e.target.value));
                      } catch {
                        set(setting.key, e.target.value); // API rejects if invalid
                      }
                    } else {
                      set(setting.key, e.target.value);
                    }
                  }}
                />
                {isSecret ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={
                      revealed.has(setting.key) ? "Hide value" : "Reveal value"
                    }
                    onClick={() => toggleReveal(setting.key)}
                  >
                    {revealed.has(setting.key) ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}

        <div className="flex items-center gap-2 pt-2">
          <Can permission="settings.update">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save settings
            </Button>
          </Can>
          {group === "sms" || group === "email" ? (
            <Can permission="settings.test">
              <Button
                variant="outline"
                onClick={() => sendTest.mutate()}
                disabled={sendTest.isPending}
              >
                {sendTest.isPending
                  ? "Sending…"
                  : group === "sms"
                    ? "Send test SMS"
                    : "Send test email"}
              </Button>
            </Can>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
