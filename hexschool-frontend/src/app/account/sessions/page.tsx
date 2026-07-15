"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiErrorMessage, authApi, type SessionInfo } from "@/lib/api/auth";
import { logout } from "@/lib/store/auth-slice";
import { useAppDispatch } from "@/lib/store/hooks";

function describeDevice(s: SessionInfo): string {
  if (s.deviceInfo.deviceName) return s.deviceInfo.deviceName;
  const ua = s.deviceInfo.userAgent ?? "";
  if (/mobile/i.test(ua)) return "Mobile browser";
  if (ua) return "Desktop browser";
  return "Unknown device";
}

/** Session manager (roadmap M02 §5): active devices with revoke buttons. */
export default function SessionsPage() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: authApi.sessions,
  });

  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      toast.success("Device signed out");
      void queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const signOutEverywhere = async () => {
    await dispatch(logout(true));
    router.replace("/login");
  };

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-8">
      <PageHeader
        title="Active sessions"
        description="Devices currently signed in to your account"
      >
        <Button variant="destructive" onClick={() => void signOutEverywhere()}>
          Sign out everywhere
        </Button>
      </PageHeader>

      {sessions.isPending ? (
        <LoadingBlock />
      ) : sessions.isError ? (
        <ErrorState onRetry={() => void sessions.refetch()} />
      ) : sessions.data.length === 0 ? (
        <EmptyState title="No active sessions" />
      ) : (
        <div className="space-y-3">
          {sessions.data.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {describeDevice(s)}
                    {s.isCurrent ? (
                      <Badge variant="secondary">This device</Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {s.deviceInfo.ip ? `${s.deviceInfo.ip} · ` : ""}
                    signed in{" "}
                    {new Date(s.createdAt).toLocaleString("en-GB", {
                      timeZone: "Asia/Dhaka",
                    })}
                  </p>
                </div>
                {!s.isCurrent ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    Sign out
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
