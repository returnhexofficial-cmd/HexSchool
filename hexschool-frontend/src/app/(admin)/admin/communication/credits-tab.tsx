"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiErrorMessage } from "@/lib/api/auth";
import { communicationApi } from "@/lib/api/communication";

export function CreditsTab() {
  const qc = useQueryClient();
  const [qty, setQty] = useState("1000");
  const [ref, setRef] = useState("");

  const balance = useQuery({
    queryKey: ["comm", "balance"],
    queryFn: communicationApi.balance,
  });
  const ledger = useQuery({
    queryKey: ["comm", "ledger"],
    queryFn: communicationApi.ledger,
  });

  const buy = useMutation({
    mutationFn: () =>
      communicationApi.adjustCredit({
        qty: Number(qty),
        purchase: true,
        ref: ref || undefined,
      }),
    onSuccess: () => {
      toast.success("Credit recorded.");
      setRef("");
      void qc.invalidateQueries({ queryKey: ["comm", "balance"] });
      void qc.invalidateQueries({ queryKey: ["comm", "ledger"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (balance.isLoading) return <LoadingBlock />;
  if (balance.isError)
    return <ErrorState onRetry={() => void balance.refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title="SMS balance (parts)"
          value={String(balance.data?.balance ?? 0)}
        />
        <StatCard
          title="Metering"
          value={balance.data?.metered ? "Metered" : "Unmetered"}
        />
      </div>

      <Can permission="sms.credit.manage">
        <div className="flex flex-wrap items-end gap-3 rounded-md border p-4">
          <div className="space-y-1.5">
            <Label>Purchase parts</Label>
            <Input
              type="number"
              className="w-32"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reference</Label>
            <Input
              className="w-56"
              placeholder="Invoice / top-up note"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
          <Button
            disabled={!qty || buy.isPending}
            onClick={() => buy.mutate()}
          >
            Record purchase
          </Button>
        </div>
      </Can>

      {ledger.data && ledger.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Ref</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.data.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>{row.type}</TableCell>
                <TableCell className="text-right">
                  {row.qty > 0 ? `+${row.qty}` : row.qty}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {row.balanceAfter}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.ref ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
