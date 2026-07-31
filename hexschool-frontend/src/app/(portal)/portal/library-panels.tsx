"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiErrorMessage } from "@/lib/api/auth";
import {
  daysUntil,
  formatBdt,
  formatLibraryDate,
  opacApi,
  RESERVATION_STATUS_LABELS,
  type MyLibrary,
} from "@/lib/api/library";

export interface LibraryFetchers {
  /** Query-key discriminator: `self` or `child-<id>`. */
  key: string;
  me: () => Promise<MyLibrary>;
  /** Absent for a parent — the card belongs to the reader. */
  canAct?: boolean;
}

/**
 * The portal's library panel (roadmap §5's OPAC): what I have out, what
 * I am waiting for, and a search over the catalogue with an availability
 * badge.
 *
 * The student/parent difference is one prop, the M22 shape: a parent's
 * view carries `canAct: false`, so no renew button and no hold form is
 * rendered. The API refuses those for a parent regardless — this is the
 * UI agreeing with the server, not the UI being the rule.
 *
 * A reader with **no library card** sees an empty panel with an
 * explanation rather than an error. Most of a school has never borrowed
 * anything, and "you have nothing out" is the true answer.
 */
export function LibraryPanels({ fetchers }: { fetchers: LibraryFetchers }) {
  const [view, setView] = useState<"mine" | "search">("mine");

  const me = useQuery({
    queryKey: ["portal-library", fetchers.key],
    queryFn: fetchers.me,
  });

  if (me.isLoading) return <LoadingBlock />;
  if (me.isError) return <ErrorState onRetry={() => void me.refetch()} />;

  const data = me.data!;
  const canAct = fetchers.canAct !== false;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Library</h2>
        {canAct && data.opacEnabled !== false && (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={view === "mine" ? "secondary" : "ghost"}
              onClick={() => setView("mine")}
            >
              My books
            </Button>
            <Button
              size="sm"
              variant={view === "search" ? "secondary" : "ghost"}
              onClick={() => setView("search")}
            >
              Search the catalogue
            </Button>
          </div>
        )}
      </div>

      {view === "search" ? (
        <CatalogueSearch
          queryKey={fetchers.key}
          canReserve={canAct && data.canReserve !== false}
        />
      ) : (
        <MyBooks data={data} canAct={canAct} queryKey={fetchers.key} />
      )}
    </section>
  );
}

function MyBooks({
  data,
  canAct,
  queryKey,
}: {
  data: MyLibrary;
  canAct: boolean;
  queryKey: string;
}) {
  const qc = useQueryClient();

  const cancel = useMutation({
    mutationFn: (id: string) => opacApi.cancelReservation(id),
    onSuccess: () => {
      toast.success("Hold cancelled.");
      void qc.invalidateQueries({ queryKey: ["portal-library", queryKey] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (!data.member) {
    return (
      <EmptyState
        title="No library card yet"
        description="Ask at the library desk — a card is usually created the first time you borrow something."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="On loan"
          value={`${data.summary.onLoan}${
            data.summary.maxBooks ? ` / ${data.summary.maxBooks}` : ""
          }`}
          hint={`Card ${data.member.cardNo}`}
        />
        <StatCard
          title="Overdue"
          value={String(data.summary.overdue)}
          hint="Past the return date"
        />
        <StatCard
          title="Fines"
          value={formatBdt(data.summary.outstandingFine)}
          hint="Settle at the library desk"
        />
      </div>

      {data.loans.length === 0 ? (
        <EmptyState
          title="Nothing out"
          description="You have no books on loan right now."
        />
      ) : (
        <div className="space-y-2">
          {data.loans.map((loan) => {
            const days = daysUntil(loan.dueAt);
            return (
              <div
                key={loan.issueId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">{loan.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {loan.accessionNo} · due {formatLibraryDate(loan.dueAt)}
                  </p>
                  {loan.outstandingFine > 0 && (
                    <p className="text-xs text-destructive">
                      {formatBdt(loan.outstandingFine)} owed on this one
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={loan.overdue ? "destructive" : "secondary"}>
                    {loan.overdue
                      ? `${Math.abs(days)} day(s) overdue`
                      : `${days} day(s) left`}
                  </Badge>
                  {canAct && (
                    <RenewButton loan={loan} queryKey={queryKey} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.reservations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Holds</h3>
          {data.reservations.map((hold) => (
            <div
              key={hold.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <p className="text-sm font-medium">{hold.title}</p>
                <p className="text-xs text-muted-foreground">
                  {hold.status === "READY" && hold.expiresAt
                    ? `Ready — held until ${formatLibraryDate(hold.expiresAt)}`
                    : `Requested ${formatLibraryDate(hold.reservedAt)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={hold.status === "READY" ? "default" : "outline"}
                >
                  {RESERVATION_STATUS_LABELS[hold.status]}
                </Badge>
                {canAct && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(hold.id)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RenewButton({
  loan,
  queryKey,
}: {
  loan: MyLibrary["loans"][number];
  queryKey: string;
}) {
  const qc = useQueryClient();
  // Renewal from the portal is not offered — a renewal is a desk action
  // and the engine's verdict is what decides it. What the portal DOES do
  // is show the same sentence the desk would, so a student knows why
  // before they walk over.
  if (loan.canRenew) {
    return (
      <span className="text-xs text-muted-foreground">
        Renewable at the desk
      </span>
    );
  }
  void qc;
  void queryKey;
  return (
    <span className="text-xs text-destructive">
      {loan.renewBlockedReason ?? "Cannot be renewed"}
    </span>
  );
}

function CatalogueSearch({
  queryKey,
  canReserve,
}: {
  queryKey: string;
  canReserve: boolean;
}) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");

  const search = useQuery({
    queryKey: ["portal-opac", submitted],
    queryFn: () =>
      opacApi.search({ search: submitted.trim() || undefined, limit: 20 }),
  });

  const reserve = useMutation({
    mutationFn: (bookId: string) => opacApi.reserve(bookId),
    onSuccess: (result) => {
      toast.success(
        `Hold placed — you are ${result.position} of ${result.queueLength} in the queue.`,
      );
      void qc.invalidateQueries({ queryKey: ["portal-library", queryKey] });
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  if (search.data && !search.data.available) {
    return (
      <EmptyState
        title="Catalogue not available"
        description={search.data.reason ?? "The library is not published here."}
      />
    );
  }

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(term);
        }}
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="opac-search" className="sr-only">
            Search
          </Label>
          <Input
            id="opac-search"
            placeholder="Title, author or ISBN"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {search.isLoading ? (
        <LoadingBlock />
      ) : (search.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          title="Nothing found"
          description="Try a shorter search, or ask the librarian."
        />
      ) : (
        <div className="space-y-2">
          {(search.data?.rows ?? []).map((book) => (
            <div
              key={book.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <p className="font-medium">{book.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    book.authors.map((a) => a.name).join(", "),
                    book.category.name,
                    book.rackNo ? `rack ${book.rackNo}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={book.copies.available > 0 ? "default" : "secondary"}
                >
                  {book.copies.available > 0
                    ? `${book.copies.available} on the shelf`
                    : "All out"}
                </Badge>
                {canReserve && book.copies.available === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reserve.isPending}
                    onClick={() => reserve.mutate(book.id)}
                  >
                    Reserve
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
