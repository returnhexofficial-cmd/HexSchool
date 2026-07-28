"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  accountApi,
  formatAmount,
  GROUP_LABELS,
  type Account,
  type AccountGroup,
  type AccountType,
} from "@/lib/api/accounting";
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  GROUP_ORDER,
} from "@/lib/validations/accounting";

/**
 * The chart-of-accounts manager (roadmap M20 §5). A collapsible tree per
 * group, with the create dialog auto-suggesting the next free code under
 * whichever node you add to.
 *
 * Headings are shown in a muted weight and carry no balance column,
 * because a heading holds no money of its own — that distinction is the
 * one thing a person reading this page has to understand.
 */
export function ChartOfAccountsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Account | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<
    { parent: Account | null; group: AccountGroup } | undefined
  >();
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => accountApi.list(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => accountApi.remove(id),
    onSuccess: () => {
      toast.success("Account deleted.");
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const byGroup = useMemo(() => {
    const rows = accounts.data ?? [];
    const childrenOf = new Map<string | null, Account[]>();
    for (const account of rows) {
      const key = account.parentId ?? null;
      childrenOf.set(key, [...(childrenOf.get(key) ?? []), account]);
    }
    for (const list of childrenOf.values()) {
      list.sort(
        (a, b) =>
          a.displayOrder - b.displayOrder ||
          a.code.localeCompare(b.code, "en", { numeric: true }),
      );
    }
    return childrenOf;
  }, [accounts.data]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRows = (
    parentId: string | null,
    group: AccountGroup,
    depth: number,
  ): React.ReactNode[] => {
    const children = (byGroup.get(parentId) ?? []).filter(
      (account) => account.group === group,
    );
    return children.flatMap((account) => {
      const kids = (byGroup.get(account.id) ?? []).filter(
        (child) => child.group === group,
      );
      const isCollapsed = collapsed.has(account.id);
      return [
        <div
          key={account.id}
          className="flex items-center gap-2 border-b py-2 text-sm last:border-b-0 hover:bg-muted/40"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(account.id)}
              className="text-muted-foreground"
              aria-label={isCollapsed ? "Expand" : "Collapse"}
            >
              {isCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
          ) : (
            <span className="inline-block size-4" />
          )}

          <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
            {account.code}
          </span>
          <span
            className={
              account.isGroup ? "font-semibold" : "font-medium text-foreground"
            }
          >
            {account.name}
          </span>
          {account.isSystem ? (
            <Badge variant="secondary" title="Used by auto-posting">
              system
            </Badge>
          ) : null}
          {!account.isActive ? <Badge variant="outline">inactive</Badge> : null}
          {!account.isGroup && Number(account.openingBalance) !== 0 ? (
            <span className="text-xs text-muted-foreground">
              opening {formatAmount(account.openingBalance)}
            </span>
          ) : null}

          <span className="ml-auto flex gap-1 pr-2">
            <Can permission="account.manage">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setCreatingUnder({ parent: account, group: account.group })
                }
              >
                Add child
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(account)}
              >
                Edit
              </Button>
              {!account.isSystem ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleting(account)}
                >
                  Delete
                </Button>
              ) : null}
            </Can>
          </span>
        </div>,
        ...(isCollapsed ? [] : renderRows(account.id, group, depth + 1)),
      ];
    });
  };

  if (accounts.isPending) return <LoadingBlock />;
  if (accounts.isError)
    return <ErrorState onRetry={() => void accounts.refetch()} />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The five groups are fixed — every statement is defined over them. A{" "}
        <strong>heading</strong> is a subtotal and holds no money of its own;
        only leaf accounts take postings. A <em>system</em> account is one
        auto-posting resolves to and cannot be deleted.
      </p>

      {(accounts.data ?? []).length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="Run the seed, or add the first account — every voucher line needs one."
        />
      ) : null}

      {GROUP_ORDER.map((group) => (
        <section key={group} className="rounded-md border">
          <header className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
            <h3 className="text-sm font-semibold">{GROUP_LABELS[group]}</h3>
            <Can permission="account.manage">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreatingUnder({ parent: null, group })}
              >
                New top-level account
              </Button>
            </Can>
          </header>
          <div>
            {renderRows(null, group, 0).length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Nothing under {GROUP_LABELS[group].toLowerCase()} yet.
              </p>
            ) : (
              renderRows(null, group, 0)
            )}
          </div>
        </section>
      ))}

      {creatingUnder ? (
        <AccountDialog
          parent={creatingUnder.parent}
          group={creatingUnder.group}
          onClose={() => setCreatingUnder(undefined)}
        />
      ) : null}
      {editing ? (
        <AccountDialog account={editing} onClose={() => setEditing(null)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.code} ${deleting?.name}?`}
        description="An account that anything has been posted to cannot be deleted — deactivate it instead."
        confirmLabel="Delete"
        destructive
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}

// ── create / edit ───────────────────────────────────────────────────────

function AccountDialog({
  account,
  parent,
  group,
  onClose,
}: {
  account?: Account;
  parent?: Account | null;
  group?: AccountGroup;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = account !== undefined;
  const effectiveGroup = account?.group ?? group ?? "ASSET";

  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [nameBn, setNameBn] = useState(account?.nameBn ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "OTHER");
  const [isGroup, setIsGroup] = useState(account?.isGroup ?? false);
  const [isActive, setIsActive] = useState(account?.isActive ?? true);
  const [openingBalance, setOpeningBalance] = useState(
    account ? String(account.openingBalance) : "0",
  );
  const [bankAccountNo, setBankAccountNo] = useState(
    account?.bankAccountNo ?? "",
  );
  const [bankName, setBankName] = useState(account?.bankName ?? "");

  // Suggest the next free code when creating — the roadmap §5 "code
  // auto-suggest". Only for a new account: an existing code is a filing
  // position somebody chose.
  useQuery({
    queryKey: ["account-code", effectiveGroup, parent?.id ?? null],
    queryFn: async () => {
      const result = await accountApi.suggestCode({
        group: effectiveGroup,
        parentId: parent?.id,
      });
      setCode((current) => current || result.code);
      return result;
    },
    enabled: !editing,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        group: effectiveGroup,
        type,
        code: code.trim(),
        name: name.trim(),
        nameBn: nameBn.trim() || undefined,
        isGroup,
        openingBalance: isGroup ? 0 : Number(openingBalance) || 0,
        bankAccountNo: bankAccountNo.trim() || undefined,
        bankName: bankName.trim() || undefined,
        ...(editing ? { isActive } : { parentId: parent?.id ?? null }),
      };
      return editing
        ? accountApi.update(account.id, payload)
        : accountApi.create(payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Account updated." : "Account created.");
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${account.code} ${account.name}`
              : parent
                ? `New account under ${parent.code} ${parent.name}`
                : `New ${GROUP_LABELS[effectiveGroup].toLowerCase()} account`}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="acc-code">Code</Label>
              <Input
                id="acc-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-type">Type</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as AccountType)}
              >
                <SelectTrigger id="acc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {ACCOUNT_TYPE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Name</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-name-bn">Name (Bangla)</Label>
            <Input
              id="acc-name-bn"
              value={nameBn}
              onChange={(e) => setNameBn(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={isGroup}
              onCheckedChange={(value) => setIsGroup(value === true)}
            />
            <span>
              This is a <strong>heading</strong>
              <span className="block text-xs text-muted-foreground">
                A heading is a subtotal of its children. Nothing can be posted
                to it and it carries no opening balance.
              </span>
            </span>
          </label>

          {!isGroup ? (
            <div className="space-y-1.5">
              <Label htmlFor="acc-opening">Opening balance</Label>
              <Input
                id="acc-opening"
                type="number"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                In the account&apos;s own direction — a debit for an asset or
                expense, a credit for anything else.
              </p>
            </div>
          ) : null}

          {type === "BANK" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="acc-bank">Bank</Label>
                <Input
                  id="acc-bank"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-bank-no">Account no.</Label>
                <Input
                  id="acc-bank-no"
                  value={bankAccountNo}
                  onChange={(e) => setBankAccountNo(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {editing && !account.isSystem ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isActive}
                onCheckedChange={(value) => setIsActive(value === true)}
              />
              Active
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || code.trim() === "" || name.trim() === ""}
          >
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
