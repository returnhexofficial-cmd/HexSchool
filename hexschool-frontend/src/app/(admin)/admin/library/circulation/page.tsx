"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  circulationApi,
  copyApi,
  CONDITIONS,
  COPY_STATUS_LABELS,
  COPY_STATUS_VARIANT,
  daysUntil,
  formatBdt,
  formatLibraryDate,
  memberApi,
  normalizeScan,
  type BookCondition,
  type IssuePreview,
  type LibraryMember,
  type ReturnResult,
} from "@/lib/api/library";

/**
 * The circulation desk (roadmap §5): **keyboard and scanner first**.
 *
 * A USB barcode scanner is a keyboard — it types the code and presses
 * Enter — so both boxes commit on Enter and nothing here needs a mouse.
 * The accession box holds focus by default because the book is what the
 * librarian picks up first.
 *
 * The Issue button's enabled state and its tooltip are the **server's
 * verdict, verbatim**. Nothing on this page re-derives whether a loan is
 * allowed: `previewIssue` returns exactly the object `issue` will act on,
 * so the greyed button and the 409 can never disagree (the M16
 * `deriveStatus` / M22 submission-window rule).
 */
export default function CirculationDeskPage() {
  const [mode, setMode] = useState<"issue" | "return">("issue");

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Circulation desk"
        description="Scan the book, scan the card. Enter commits — no mouse needed."
      >
        <Button asChild variant="outline">
          <Link href="/admin/library">Back to the library</Link>
        </Button>
      </PageHeader>

      <div className="flex gap-1">
        {(
          [
            ["issue", "Issue"],
            ["return", "Return"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="lg"
            variant={mode === key ? "default" : "outline"}
            onClick={() => setMode(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {mode === "issue" ? <IssueDesk /> : <ReturnDesk />}
    </main>
  );
}

function IssueDesk() {
  const qc = useQueryClient();
  const cardRef = useRef<HTMLInputElement>(null);
  const accessionRef = useRef<HTMLInputElement>(null);

  const [accessionNo, setAccessionNo] = useState("");
  const [cardNo, setCardNo] = useState("");
  const [preview, setPreview] = useState<IssuePreview | null>(null);
  const [member, setMember] = useState<LibraryMember | null>(null);
  const [override, setOverride] = useState(false);

  const lookUpCopy = useMutation({
    mutationFn: (code: string) => copyApi.byAccession(code),
    onSuccess: () => cardRef.current?.focus(),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const lookUpMember = useMutation({
    mutationFn: (code: string) => memberApi.byCard(code),
    onSuccess: (found) => {
      setMember(found);
      void refreshPreview(accessionNo, found.cardNo);
    },
    onError: (err) => {
      setMember(null);
      toast.error(apiErrorMessage(err));
    },
  });

  const previewMutation = useMutation({
    mutationFn: (input: { accessionNo: string; cardNo: string }) =>
      circulationApi.previewIssue(input),
    onSuccess: setPreview,
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const issue = useMutation({
    mutationFn: () =>
      circulationApi.issue({ accessionNo, cardNo, override: override || undefined }),
    onSuccess: (created) => {
      toast.success(
        `Issued — due ${formatLibraryDate(created.dueAt)}.`,
      );
      reset();
      void qc.invalidateQueries({ queryKey: ["library-issues"] });
      void qc.invalidateQueries({ queryKey: ["library-summary"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const refreshPreview = async (accession: string, card: string) => {
    if (!accession || !card) return;
    previewMutation.mutate({ accessionNo: accession, cardNo: card });
  };

  const reset = () => {
    setAccessionNo("");
    setCardNo("");
    setPreview(null);
    setMember(null);
    setOverride(false);
    accessionRef.current?.focus();
  };

  const verdict = preview?.verdict;
  const blocked = verdict !== undefined && !verdict.allowed;
  const canProceed =
    Boolean(accessionNo && cardNo) &&
    (verdict?.allowed === true || (blocked && verdict.overridable && override));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="accession">1. Scan the book</Label>
          <Input
            id="accession"
            ref={accessionRef}
            autoFocus
            className="font-mono text-lg"
            placeholder="Accession number"
            value={accessionNo}
            onChange={(event) => setAccessionNo(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const code = normalizeScan(accessionNo);
              setAccessionNo(code);
              if (code) lookUpCopy.mutate(code);
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="card">2. Scan the card</Label>
          <Input
            id="card"
            ref={cardRef}
            className="font-mono text-lg"
            placeholder="Card number"
            value={cardNo}
            onChange={(event) => setCardNo(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const code = normalizeScan(cardNo);
              setCardNo(code);
              if (code) lookUpMember.mutate(code);
            }}
          />
        </div>

        {blocked && verdict.overridable && (
          <Can permission="library.issue.override">
            <div className="flex items-start gap-2 rounded-md border border-dashed p-3">
              <Checkbox
                id="override"
                checked={override}
                onCheckedChange={(value) => setOverride(value === true)}
              />
              <Label htmlFor="override" className="text-sm font-normal">
                Issue anyway — overrides the limit, the fine block or another
                member&apos;s hold. It is recorded against your name.
              </Label>
            </div>
          </Can>
        )}

        <div className="flex gap-2">
          <Button
            size="lg"
            disabled={!canProceed || issue.isPending}
            onClick={() => issue.mutate()}
          >
            Issue
          </Button>
          <Button size="lg" variant="ghost" onClick={reset}>
            Clear
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {lookUpCopy.data && (
          <div className="space-y-1 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{lookUpCopy.data.copy.book.title}</h2>
              <Badge
                variant={COPY_STATUS_VARIANT[lookUpCopy.data.copy.status]}
              >
                {COPY_STATUS_LABELS[lookUpCopy.data.copy.status]}
              </Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {lookUpCopy.data.copy.accessionNo}
              {lookUpCopy.data.copy.book.rackNo
                ? ` · rack ${lookUpCopy.data.copy.book.rackNo}`
                : ""}
            </p>
            {lookUpCopy.data.openIssue && (
              <p className="text-sm text-destructive">
                Already on loan to {lookUpCopy.data.openIssue.member.cardNo},
                due {formatLibraryDate(lookUpCopy.data.openIssue.dueAt)}.
              </p>
            )}
          </div>
        )}

        {member && (
          <div className="space-y-1 rounded-md border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{member.person?.name ?? "Member"}</h2>
              <Badge
                variant={member.status === "ACTIVE" ? "default" : "destructive"}
              >
                {member.status}
              </Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {member.cardNo}
              {member.person?.context ? ` · ${member.person.context}` : ""}
            </p>
            <div className="flex gap-4 pt-2 text-sm">
              <span>
                {member.standing.openLoans} / {member.maxBooks} out
              </span>
              {member.standing.overdueLoans > 0 && (
                <span className="text-destructive">
                  {member.standing.overdueLoans} overdue
                </span>
              )}
              {member.standing.outstandingFine > 0 && (
                <span className="text-destructive">
                  {formatBdt(member.standing.outstandingFine)} owed
                </span>
              )}
            </div>
          </div>
        )}

        {verdict && (
          <div
            className={
              verdict.allowed
                ? "rounded-md border border-green-600/40 bg-green-500/5 p-4"
                : "rounded-md border border-destructive/40 bg-destructive/5 p-4"
            }
          >
            <p className="text-sm font-medium">
              {verdict.allowed ? "Ready to issue" : "Cannot issue"}
            </p>
            {/* The engine's own sentence, not ours — one message wherever
                the question is asked. */}
            {verdict.reason && (
              <p className="text-sm text-muted-foreground">{verdict.reason}</p>
            )}
            {!verdict.allowed && !verdict.overridable && (
              <p className="pt-1 text-xs text-muted-foreground">
                This one cannot be overridden — it is about the book, not
                about the policy.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ReturnDesk() {
  const qc = useQueryClient();
  const [accessionNo, setAccessionNo] = useState("");
  const [condition, setCondition] = useState<BookCondition | "">("");
  const [conditionNote, setConditionNote] = useState("");
  const [fineOverride, setFineOverride] = useState("");
  const [fineReason, setFineReason] = useState("");
  const [collectFine, setCollectFine] = useState(false);
  const [result, setResult] = useState<ReturnResult | null>(null);

  const lookUp = useMutation({
    mutationFn: (code: string) => copyApi.byAccession(code),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const takeBack = useMutation({
    mutationFn: () =>
      circulationApi.returnBook({
        accessionNo,
        condition: condition || undefined,
        conditionNote: conditionNote.trim() || undefined,
        fineOverride:
          fineOverride.trim() === "" ? undefined : Number(fineOverride),
        fineReason: fineReason.trim() || undefined,
        collectFine: collectFine || undefined,
      }),
    onSuccess: (returned) => {
      setResult(returned);
      toast.success(
        returned.fine.amount > 0
          ? `Returned — ${formatBdt(returned.fine.amount)} fine.`
          : "Returned, nothing owed.",
      );
      setAccessionNo("");
      setCondition("");
      setConditionNote("");
      setFineOverride("");
      setFineReason("");
      setCollectFine(false);
      void qc.invalidateQueries({ queryKey: ["library-issues"] });
      void qc.invalidateQueries({ queryKey: ["library-fines"] });
      void qc.invalidateQueries({ queryKey: ["library-summary"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const open = lookUp.data?.openIssue;
  const daysLate = open ? -daysUntil(open.dueAt) : 0;
  const overrideNeedsReason =
    fineOverride.trim() !== "" && fineReason.trim().length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="return-accession">Scan the book</Label>
          <Input
            id="return-accession"
            autoFocus
            className="font-mono text-lg"
            placeholder="Accession number"
            value={accessionNo}
            onChange={(event) => setAccessionNo(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const code = normalizeScan(accessionNo);
              setAccessionNo(code);
              if (code) lookUp.mutate(code);
            }}
          />
        </div>

        <div className="space-y-1">
          <Label>Condition it came back in</Label>
          <Select
            value={condition || "__none__"}
            onValueChange={(value) =>
              setCondition(value === "__none__" ? "" : (value as BookCondition))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Unchanged" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unchanged</SelectItem>
              {CONDITIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            DAMAGED or POOR adds the damage charge on top of any overdue.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="condition-note">Condition note</Label>
          <Textarea
            id="condition-note"
            rows={2}
            placeholder="Water damage to the last twenty pages"
            value={conditionNote}
            onChange={(event) => setConditionNote(event.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="fine-override">Set the fine by hand (BDT)</Label>
            <Input
              id="fine-override"
              type="number"
              step="0.01"
              min="0"
              placeholder="Computed"
              value={fineOverride}
              onChange={(event) => setFineOverride(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fine-reason">Reason</Label>
            <Input
              id="fine-reason"
              placeholder="Required with a hand-set fine"
              value={fineReason}
              onChange={(event) => setFineReason(event.target.value)}
            />
          </div>
        </div>

        <Can permission="library.fine.collect">
          <div className="flex items-center gap-2">
            <Checkbox
              id="collect"
              checked={collectFine}
              onCheckedChange={(value) => setCollectFine(value === true)}
            />
            <Label htmlFor="collect" className="text-sm font-normal">
              Take the fine now
            </Label>
          </div>
        </Can>

        <Button
          size="lg"
          disabled={!accessionNo || overrideNeedsReason || takeBack.isPending}
          onClick={() => takeBack.mutate()}
        >
          Take it back
        </Button>
        {overrideNeedsReason && (
          <p className="text-xs text-destructive">
            A hand-set fine needs a reason — it is what the member is shown.
          </p>
        )}
      </div>

      <div className="space-y-4">
        {open && (
          <div className="space-y-1 rounded-md border p-4">
            <h2 className="font-medium">{open.copy.book.title}</h2>
            <p className="font-mono text-xs text-muted-foreground">
              {open.copy.accessionNo} · card {open.member.cardNo}
            </p>
            <p className="text-sm">
              Due {formatLibraryDate(open.dueAt)}
              {daysLate > 0 ? (
                <span className="text-destructive">
                  {" "}
                  — {daysLate} day(s) late
                </span>
              ) : (
                " — on time"
              )}
            </p>
          </div>
        )}

        {lookUp.data && !open && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            {lookUp.data.copy.accessionNo} is not on loan — nothing to take
            back.
          </div>
        )}

        {result && (
          <div className="space-y-2 rounded-md border p-4">
            <h2 className="font-medium">Returned</h2>
            <dl className="space-y-1 text-sm">
              <Row label="Days late" value={String(result.fine.daysLate)} />
              <Row
                label="Charged for"
                value={`${result.fine.chargeableDays} day(s)`}
              />
              {result.fine.holidayDays > 0 && (
                <Row
                  label="Forgiven as holidays"
                  value={`${result.fine.holidayDays} day(s)`}
                />
              )}
              <Row label="Fine" value={formatBdt(result.fine.amount)} />
              {result.fine.capped && (
                <Row label="Note" value="Capped at the per-book ceiling" />
              )}
              <Row label="Collected" value={formatBdt(result.fine.collected)} />
              <Row
                label="Still owed"
                value={formatBdt(result.fine.outstanding)}
              />
            </dl>
            {result.heldFor && (
              <p className="text-sm text-muted-foreground">
                This copy is now being held for the next member in the queue —
                it did not go back on the shelf.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
