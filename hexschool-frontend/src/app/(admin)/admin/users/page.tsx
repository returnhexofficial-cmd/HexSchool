"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  usersApi,
  type AdminUser,
  type UserStatus,
  type UserType,
} from "@/lib/api/staff";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { useAuth } from "@/lib/store/hooks";

const ALL = "__all__";

const USER_TYPES: UserType[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "STAFF",
  "TEACHER",
  "STUDENT",
  "PARENT",
];
const USER_STATUSES: UserStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "SUSPENDED",
  "PENDING",
];

const STATUS_VARIANT: Record<
  UserStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ACTIVE: "default",
  INACTIVE: "secondary",
  SUSPENDED: "destructive",
  PENDING: "outline",
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<string | undefined>("createdAt:desc");
  const [search, setSearch] = useState("");
  const [userType, setUserType] = useState<UserType | "">("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const debouncedSearch = useDebounce(search, 300);

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    user: AdminUser;
    to: UserStatus;
  } | null>(null);

  const query = useQuery({
    queryKey: [
      "users",
      { page, limit, sort, search: debouncedSearch, userType, status },
    ],
    queryFn: () =>
      usersApi.list({
        page,
        limit,
        sort,
        search: debouncedSearch,
        userType: userType || undefined,
        status: status || undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["users"] });

  const resetPassword = useMutation({
    mutationFn: (id: string) => usersApi.resetPassword(id),
    onSuccess: ({ tempPassword: pw }) => {
      setResetTarget(null);
      setTempPassword(pw);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const changeStatus = useMutation({
    mutationFn: ({ user, to }: { user: AdminUser; to: UserStatus }) =>
      usersApi.updateStatus(user.id, { status: to }),
    onSuccess: (_, { to }) => {
      toast.success(`User is now ${to}`);
      setStatusTarget(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<AdminUser>[] = [
    {
      id: "identity",
      header: "User",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div>
            <div className="font-medium">
              {u.staffProfile ? (
                <Link
                  href={`/admin/staff/${u.staffProfile.id}`}
                  className="hover:underline"
                >
                  {u.staffProfile.firstName} {u.staffProfile.lastName}
                </Link>
              ) : (
                (u.email ?? u.phone ?? "—")
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {u.staffProfile
                ? (u.email ?? u.phone ?? u.staffProfile.employeeId)
                : (u.phone ?? "")}
            </div>
          </div>
        );
      },
    },
    {
      id: "userType",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.userType}</Badge>
      ),
    },
    {
      id: "roles",
      header: "Roles",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.roles.map((r) => r.name).join(", ") || "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status]}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "lastLoginAt",
      header: "Last login",
      cell: ({ row }) =>
        row.original.lastLoginAt
          ? new Date(row.original.lastLoginAt).toLocaleString()
          : "Never",
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const u = row.original;
        const isSelf = u.id === me?.id;
        return (
          <div className="flex justify-end gap-1">
            <Can permission="user.password.reset">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setResetTarget(u)}
              >
                Reset password
              </Button>
            </Can>
            <Can permission="user.status">
              {isSelf ? null : u.status === "ACTIVE" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setStatusTarget({ user: u, to: "INACTIVE" })}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStatusTarget({ user: u, to: "ACTIVE" })}
                >
                  Activate
                </Button>
              )}
            </Can>
          </div>
        );
      },
    },
  ];

  const filterSelect = <T extends string>(
    value: T | "",
    onChange: (v: T | "") => void,
    placeholder: string,
    items: string[],
  ) => (
    <Select
      value={value || ALL}
      onValueChange={(v) => {
        onChange((v === ALL ? "" : v) as T | "");
        setPage(1);
      }}
    >
      <SelectTrigger size="sm" className="w-40">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {items.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Users"
        description="Every account in the system — staff, teachers, students, parents"
      />

      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        sort={sort}
        onSortChange={setSort}
        search={search}
        onSearchChange={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Email, phone, name…"
        emptyTitle="No users found"
        toolbar={
          <>
            {filterSelect(userType, setUserType, "All types", USER_TYPES)}
            {filterSelect(status, setStatus, "All statuses", USER_STATUSES)}
          </>
        }
      />

      <ConfirmDialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title="Reset this user's password?"
        description="A temporary password is issued and sent by SMS/email; every session is signed out and they must change it on next login."
        confirmLabel="Reset password"
        isPending={resetPassword.isPending}
        onConfirm={() => {
          if (resetTarget) resetPassword.mutate(resetTarget.id);
        }}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        onOpenChange={(open) => !open && setStatusTarget(null)}
        title={
          statusTarget?.to === "ACTIVE"
            ? "Activate this user?"
            : "Deactivate this user?"
        }
        description={
          statusTarget?.to === "ACTIVE"
            ? "They will be able to sign in again."
            : "They are signed out of every device immediately and cannot sign in."
        }
        confirmLabel={statusTarget?.to === "ACTIVE" ? "Activate" : "Deactivate"}
        destructive={statusTarget?.to !== "ACTIVE"}
        isPending={changeStatus.isPending}
        onConfirm={() => {
          if (statusTarget) changeStatus.mutate(statusTarget);
        }}
      />

      <Dialog
        open={tempPassword !== null}
        onOpenChange={(open) => !open && setTempPassword(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Temporary password issued</DialogTitle>
            <DialogDescription>
              It was also sent to the user&apos;s contact. This is the only
              time it is shown here — copy it now if you need to relay it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-lg tracking-wide">
              {tempPassword}
            </code>
            <Button
              variant="outline"
              onClick={() => {
                if (tempPassword) {
                  void navigator.clipboard.writeText(tempPassword);
                  toast.success("Copied");
                }
              }}
            >
              Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
