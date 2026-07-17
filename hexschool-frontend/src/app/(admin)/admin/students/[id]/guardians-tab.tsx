"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  GUARDIAN_RELATION_LABELS,
  guardiansApi,
  studentsApi,
  type GuardianRelation,
} from "@/lib/api/students";
import { GUARDIAN_RELATIONS } from "@/lib/validations/student";

export function GuardiansTab({ studentId }: { studentId: string }) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState<GuardianRelation>("MOTHER");
  const [foundId, setFoundId] = useState<string | null>(null);
  const [foundLabel, setFoundLabel] = useState<string | null>(null);

  const student = useQuery({
    queryKey: ["students", studentId],
    queryFn: () => studentsApi.get(studentId),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["students", studentId] });

  const search = useMutation({
    mutationFn: (p: string) => guardiansApi.list({ phone: p }),
    onSuccess: (res) => {
      const g = res.data[0];
      if (g) {
        setFoundId(g.id);
        setFoundLabel(`${g.name} · ${g.phone} (${g.students.length} child(ren))`);
      } else {
        setFoundId(null);
        setFoundLabel("No guardian with that phone. Create one on the Guardians page, then link here.");
      }
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const link = useMutation({
    mutationFn: () =>
      studentsApi.linkGuardian(studentId, {
        guardianId: foundId!,
        relation,
      }),
    onSuccess: () => {
      toast.success("Guardian linked");
      setPhone("");
      setFoundId(null);
      setFoundLabel(null);
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const setPrimary = useMutation({
    mutationFn: (guardianId: string) =>
      studentsApi.updateGuardianLink(studentId, guardianId, { isPrimary: true }),
    onSuccess: () => {
      toast.success("Primary guardian updated");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const unlink = useMutation({
    mutationFn: (guardianId: string) =>
      studentsApi.unlinkGuardian(studentId, guardianId),
    onSuccess: () => {
      toast.success("Guardian unlinked");
      invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (student.isPending) return <LoadingBlock />;
  if (student.isError)
    return <ErrorState error={student.error} onRetry={() => void student.refetch()} />;

  const guardians = student.data.guardians;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        {guardians.map((g) => (
          <div
            key={g.guardianId}
            className="flex flex-wrap items-center gap-3 rounded-md border p-3"
          >
            <Link
              href={`/admin/guardians/${g.guardianId}`}
              className="font-medium hover:underline"
            >
              {g.guardian.name}
            </Link>
            <span className="text-sm text-muted-foreground">
              {GUARDIAN_RELATION_LABELS[g.relation]} · {g.guardian.phone}
            </span>
            {g.isPrimary ? <Badge>Primary</Badge> : null}
            {g.isEmergencyContact ? (
              <Badge variant="outline">Emergency</Badge>
            ) : null}
            <Can permission="student.guardian.manage">
              <div className="ml-auto flex gap-2">
                {!g.isPrimary ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={setPrimary.isPending}
                    onClick={() => setPrimary.mutate(g.guardianId)}
                  >
                    Make primary
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(g.guardianId)}
                >
                  Unlink
                </Button>
              </div>
            </Can>
          </div>
        ))}
      </div>

      <Can permission="student.guardian.manage">
        <div className="space-y-4 rounded-md border p-4">
          <p className="text-sm font-medium">Link an existing guardian</p>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label>Guardian phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
              />
            </div>
            <Button
              variant="outline"
              disabled={!/^01[3-9]\d{8}$/.test(phone) || search.isPending}
              onClick={() => search.mutate(phone)}
            >
              Find
            </Button>
          </div>
          {foundLabel ? (
            <p className={foundId ? "text-sm text-emerald-600" : "text-sm text-muted-foreground"}>
              {foundLabel}
            </p>
          ) : null}
          {foundId ? (
            <div className="flex items-end gap-2">
              <div className="space-y-2">
                <Label>Relation to student</Label>
                <Select
                  value={relation}
                  onValueChange={(v) => setRelation(v as GuardianRelation)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GUARDIAN_RELATIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {GUARDIAN_RELATION_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button disabled={link.isPending} onClick={() => link.mutate()}>
                Link guardian
              </Button>
            </div>
          ) : null}
        </div>
      </Can>
    </div>
  );
}
