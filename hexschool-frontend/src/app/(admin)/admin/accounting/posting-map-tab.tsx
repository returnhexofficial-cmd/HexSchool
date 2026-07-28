"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  accountApi,
  postingMapApi,
  SYSTEM_SLOTS,
  type Account,
  type PostingMapKind,
} from "@/lib/api/accounting";
import { feeHeadApi } from "@/lib/api/fee";
import type { PaymentMethod } from "@/lib/api/fee";
import { PAYMENT_METHOD_LABELS } from "@/lib/validations/fee";

const UNSET = "__unset__";

const METHODS: PaymentMethod[] = [
  "CASH",
  "BANK",
  "CHEQUE",
  "ADJUSTMENT",
  "SSLCOMMERZ",
  "BKASH",
  "NAGAD",
  "ROCKET",
];

/**
 * The posting-map settings page (roadmap M20 §5: "fee head → income
 * account; gateway → bank/clearing account").
 *
 * This is the page that decides what auto-posting does, so it shows the
 * three kinds side by side and says plainly what a blank row falls back
 * to — a school should be able to see, before a single taka moves, where
 * its tuition money will land.
 */
export function PostingMapTab() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const mappings = useQuery({
    queryKey: ["posting-map"],
    queryFn: postingMapApi.list,
  });
  const accounts = useQuery({
    queryKey: ["accounts", "postable"],
    queryFn: () => accountApi.list({ postableOnly: true }),
  });
  const heads = useQuery({ queryKey: ["fee-heads"], queryFn: feeHeadApi.list });

  const current = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of mappings.data ?? []) {
      map[`${row.kind}:${row.refKey}`] = row.accountId;
    }
    return map;
  }, [mappings.data]);

  const valueFor = (kind: PostingMapKind, refKey: string): string =>
    draft[`${kind}:${refKey}`] ?? current[`${kind}:${refKey}`] ?? UNSET;

  const setValue = (kind: PostingMapKind, refKey: string, value: string) =>
    setDraft((prev) => ({ ...prev, [`${kind}:${refKey}`]: value }));

  const save = useMutation({
    mutationFn: () =>
      postingMapApi.update(
        Object.entries(draft).map(([key, accountId]) => {
          const [kind, ...rest] = key.split(":");
          return {
            kind: kind as PostingMapKind,
            refKey: rest.join(":"),
            accountId: accountId === UNSET ? null : accountId,
          };
        }),
      ),
    onSuccess: () => {
      toast.success("Posting map saved.");
      setDraft({});
      void qc.invalidateQueries({ queryKey: ["posting-map"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (mappings.isPending || accounts.isPending || heads.isPending)
    return <LoadingBlock />;
  if (mappings.isError || accounts.isError || heads.isError)
    return <ErrorState onRetry={() => void mappings.refetch()} />;

  const options = accounts.data ?? [];
  const dirty = Object.keys(draft).length > 0;

  const picker = (kind: PostingMapKind, refKey: string, filter?: (a: Account) => boolean) => (
    <Select
      value={valueFor(kind, refKey)}
      onValueChange={(value) => setValue(kind, refKey, value)}
    >
      <SelectTrigger className="w-full max-w-md">
        <SelectValue placeholder="Not mapped" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Not mapped (use the default)</SelectItem>
        {options.filter(filter ?? (() => true)).map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {account.code} — {account.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          When a fee payment succeeds, the ledger debits the account its
          <em> payment method</em> maps to and credits the income account each
          <em> fee head</em> maps to. Anything left unmapped falls back to the
          system account below, so a freshly-seeded school already posts
          correctly.
        </p>
        <Can permission="accounting.posting-map.manage">
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            Save changes
          </Button>
        </Can>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Fee head → income account</h3>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64">Fee head</TableHead>
                <TableHead>Income account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {heads.data.map((head) => (
                <TableRow key={head.id}>
                  <TableCell className="font-medium">{head.name}</TableCell>
                  <TableCell>
                    {picker("FEE_HEAD", head.id, (a) => a.group === "INCOME")}
                  </TableCell>
                </TableRow>
              ))}
              {heads.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground">
                    No fee heads yet — add them under Fees &amp; Payments.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Payment method → cash / bank / clearing account
        </h3>
        <p className="text-xs text-muted-foreground">
          Point a gateway at its own <strong>clearing</strong> account, not
          straight at the bank: the money is yours when the gateway confirms,
          but it does not reach the bank until settlement — and the commission
          comes off on the way.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64">Method</TableHead>
                <TableHead>Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METHODS.map((method) => (
                <TableRow key={method}>
                  <TableCell className="font-medium">
                    {PAYMENT_METHOD_LABELS[method]}
                  </TableCell>
                  <TableCell>
                    {picker(
                      "PAYMENT_METHOD",
                      method,
                      (a) => a.type === "CASH" || a.type === "BANK",
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">System accounts</h3>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64">Slot</TableHead>
                <TableHead>Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SYSTEM_SLOTS.map((slot) => (
                <TableRow key={slot.key}>
                  <TableCell>
                    <div className="font-medium">{slot.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {slot.hint}
                    </div>
                  </TableCell>
                  <TableCell>{picker("SYSTEM", slot.key)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
