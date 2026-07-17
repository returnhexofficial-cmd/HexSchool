"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api/auth";
import { rbacApi, type Role, type RoleWithStats } from "@/lib/api/rbac";
import { usePermissions } from "@/lib/hooks/use-permissions";

/**
 * User role assignment — the UI slot promised by Module 03 (its API is
 * /users/:id/roles). Every user must keep at least one role; the backend
 * additionally protects the last super-admin holder.
 */
export function RolesTab({ userId }: { userId: string }) {
  const userRoles = useQuery({
    queryKey: ["user-roles", userId],
    queryFn: () => rbacApi.getUserRoles(userId),
  });
  const allRoles = useQuery({
    queryKey: ["roles", "all"],
    queryFn: () => rbacApi.listRoles({ limit: 100 }),
    staleTime: 60_000,
  });

  if (userRoles.isPending || allRoles.isPending) return <LoadingBlock />;
  if (userRoles.isError || allRoles.isError) {
    return (
      <ErrorState
        error={userRoles.error ?? allRoles.error}
        onRetry={() => {
          void userRoles.refetch();
          void allRoles.refetch();
        }}
      />
    );
  }

  return (
    <RolesEditor
      // Remount with fresh selection whenever the server copy changes.
      key={userRoles.data
        .map((r) => r.id)
        .sort()
        .join(",")}
      userId={userId}
      current={userRoles.data}
      catalog={allRoles.data.data}
    />
  );
}

function RolesEditor({
  userId,
  current,
  catalog,
}: {
  userId: string;
  current: Role[];
  catalog: RoleWithStats[];
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(current.map((r) => r.id)),
  );

  const save = useMutation({
    mutationFn: () => rbacApi.setUserRoles(userId, [...selected]),
    onSuccess: () => {
      toast.success("Roles saved");
      void queryClient.invalidateQueries({ queryKey: ["user-roles", userId] });
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err));
      void queryClient.invalidateQueries({ queryKey: ["user-roles", userId] });
    },
  });

  const editable = can("user.role.assign");
  const currentIds = new Set(current.map((r) => r.id));
  const dirty =
    selected.size !== currentIds.size ||
    [...selected].some((id) => !currentIds.has(id));

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          A user must hold at least one role — the API rejects an empty set.
        </p>
        {editable ? (
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty || selected.size === 0}
          >
            Save roles
          </Button>
        ) : null}
      </div>

      <div className="divide-y rounded-lg border">
        {catalog.map((role) => {
          const checked = selected.has(role.id);
          return (
            <label
              key={role.id}
              className="flex cursor-pointer items-center gap-3 p-3 hover:bg-accent/40"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                disabled={!editable}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(role.id);
                    else next.delete(role.id);
                    return next;
                  });
                }}
              />
              <span className="flex-1">
                <span className="font-medium">{role.name}</span>
                {role.description ? (
                  <span className="block text-xs text-muted-foreground">
                    {role.description}
                  </span>
                ) : null}
              </span>
              {role.isSystem ? <Badge variant="secondary">System</Badge> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
