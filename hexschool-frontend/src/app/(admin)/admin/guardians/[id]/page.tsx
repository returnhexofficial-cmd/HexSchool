"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ErrorState } from "@/components/shared/error-state";
import { FormDialog } from "@/components/shared/form-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiErrorMessage } from "@/lib/api/auth";
import { GUARDIAN_RELATION_LABELS, guardiansApi } from "@/lib/api/students";
import {
  guardianSchema,
  type GuardianValues as GuardianFormValues,
} from "@/lib/validations/student";
import { GuardianFields } from "../page";

export default function GuardianDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const guardian = useQuery({
    queryKey: ["guardians", id],
    queryFn: () => guardiansApi.get(id),
  });

  const form = useForm<GuardianFormValues>({
    resolver: zodResolver(guardianSchema),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["guardians"] });
  };

  const update = useMutation({
    mutationFn: (values: GuardianFormValues) =>
      guardiansApi.update(id, {
        name: values.name,
        nameBn: values.nameBn || undefined,
        relation: values.relation,
        phone: values.phone,
        email: values.email || undefined,
        nid: values.nid || undefined,
        occupation: values.occupation || undefined,
        monthlyIncome: values.monthlyIncome
          ? Number(values.monthlyIncome)
          : undefined,
        address: values.presentAddress
          ? { present: values.presentAddress }
          : undefined,
      }),
    onSuccess: () => {
      toast.success("Guardian updated");
      setEditOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const createAccount = useMutation({
    mutationFn: () => guardiansApi.createAccount(id),
    onSuccess: (res) => {
      toast.success(`Parent portal account created. Temp password: ${res.tempPassword}`, {
        duration: 15000,
      });
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: () => guardiansApi.remove(id),
    onSuccess: () => {
      toast.success("Guardian deleted");
      invalidate();
      router.push("/admin/guardians");
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (guardian.isPending) {
    return (
      <main className="flex-1 p-8">
        <LoadingBlock />
      </main>
    );
  }
  if (guardian.isError) {
    return (
      <main className="flex-1 p-8">
        <ErrorState
          error={guardian.error}
          onRetry={() => void guardian.refetch()}
        />
      </main>
    );
  }

  const g = guardian.data;

  const detail = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{value || "—"}</span>
    </div>
  );

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title={g.name}
        description={`${GUARDIAN_RELATION_LABELS[g.relation]} · ${g.phone}`}
      >
        {!g.userId ? (
          <Can permission="student.account.create">
            <Button
              variant="outline"
              disabled={createAccount.isPending}
              onClick={() => createAccount.mutate()}
            >
              Create portal account
            </Button>
          </Can>
        ) : (
          <Badge variant="secondary">Portal account active</Badge>
        )}
        <Can permission="guardian.manage">
          <Button
            variant="outline"
            onClick={() => {
              form.reset({
                name: g.name,
                nameBn: g.nameBn ?? "",
                relation: g.relation,
                phone: g.phone,
                email: g.email ?? "",
                nid: g.nid ?? "",
                occupation: g.occupation ?? "",
                monthlyIncome: g.monthlyIncome ? String(g.monthlyIncome) : "",
                presentAddress: g.address?.present ?? "",
              });
              setEditOpen(true);
            }}
          >
            Edit
          </Button>
        </Can>
        <Can permission="guardian.manage">
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </Can>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {detail("Name (Bangla)", g.nameBn)}
            {detail("Email", g.email)}
            {detail("NID", g.nid)}
            {detail("Occupation", g.occupation)}
            {detail(
              "Monthly income",
              g.monthlyIncome ? `৳ ${g.monthlyIncome}` : null,
            )}
            {detail("Address", g.address?.present)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Children ({g.students.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {g.students.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not linked to any student yet.
              </p>
            ) : (
              g.students.map((link) => (
                <div
                  key={link.student.id}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <Link
                    href={`/admin/students/${link.student.id}`}
                    className="font-medium hover:underline"
                  >
                    {link.student.firstName} {link.student.lastName}
                  </Link>
                  <span className="text-muted-foreground">
                    {link.student.studentUid} ·{" "}
                    {GUARDIAN_RELATION_LABELS[link.relation]}
                  </span>
                  {link.isPrimary ? <Badge>Primary</Badge> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit guardian"
        form={form}
        onSubmit={(values) => update.mutate(values)}
        submitLabel="Save"
        isPending={update.isPending}
      >
        <GuardianFields form={form} />
      </FormDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${g.name}?`}
        description="Blocked while any student is still linked — unlink them first. Any portal account is deactivated."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </main>
  );
}
