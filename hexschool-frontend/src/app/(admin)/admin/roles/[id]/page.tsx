"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import { rbacApi, type Permission, type RoleDetail } from "@/lib/api/rbac";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { PermissionMatrix } from "./permission-matrix";

/**
 * Role editor: details + permission matrix (roadmap M03 §5). Saves carry
 * expectedUpdatedAt so concurrent edits 409 instead of clobbering.
 */
export default function RoleEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const role = useQuery({
    queryKey: ["roles", id],
    queryFn: () => rbacApi.getRole(id),
  });
  const catalog = useQuery({
    queryKey: ["permissions"],
    queryFn: rbacApi.listPermissions,
  });

  if (role.isPending || catalog.isPending) {
    return (
      <main className="flex-1 p-8">
        <LoadingBlock />
      </main>
    );
  }
  if (role.isError || catalog.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState
          error={role.error ?? catalog.error}
          onRetry={() => {
            void role.refetch();
            void catalog.refetch();
          }}
        />
      </main>
    );
  }

  return (
    <RoleEditor
      // Remount with fresh local state whenever the server copy changes
      // (also resets the form after a 409 → refetch cycle).
      key={`${role.data.id}:${role.data.updatedAt}`}
      role={role.data}
      catalog={catalog.data}
    />
  );
}

function RoleEditor({
  role,
  catalog,
}: {
  role: RoleDetail;
  catalog: Permission[];
}) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role.permissionCodes),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["roles"] });
  };

  const saveDetails = useMutation({
    mutationFn: () =>
      rbacApi.updateRole(role.id, {
        name,
        description: description || undefined,
        expectedUpdatedAt: role.updatedAt,
      }),
    onSuccess: () => {
      toast.success("Role details saved");
      refresh();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err));
      refresh(); // a 409 means our copy is stale — pull the fresh one
    },
  });

  const savePermissions = useMutation({
    mutationFn: () =>
      rbacApi.setRolePermissions(role.id, {
        permissionCodes: [...selected],
        expectedUpdatedAt: role.updatedAt,
      }),
    onSuccess: () => {
      toast.success("Permissions saved");
      refresh();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err));
      refresh();
    },
  });

  const locked = new Set(role.lockedCodes);
  const dirtyPermissions =
    [...selected].sort().join(",") !==
    [...role.permissionCodes].sort().join(",");

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {role.name}
            {role.isSystem ? <Badge variant="secondary">System</Badge> : null}
          </span>
        }
        description={`Slug: ${role.slug}`}
      />

      <Can permission="role.update">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={role.isSystem}
                />
                {role.isSystem ? (
                  <p className="text-xs text-muted-foreground">
                    System roles cannot be renamed.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-description">Description</Label>
                <Input
                  id="role-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={() => saveDetails.mutate()}
              disabled={saveDetails.isPending || name.trim().length < 2}
            >
              Save details
            </Button>
          </CardContent>
        </Card>
      </Can>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Permissions{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {selected.size} granted
            </span>
          </h2>
          <Can permission="role.permission.assign">
            <Button
              onClick={() => savePermissions.mutate()}
              disabled={savePermissions.isPending || !dirtyPermissions}
            >
              Save permissions
            </Button>
          </Can>
        </div>
        <PermissionMatrix
          catalog={catalog}
          selected={selected}
          locked={locked}
          disabled={!can("role.permission.assign")}
          onChange={setSelected}
        />
      </section>
    </main>
  );
}
