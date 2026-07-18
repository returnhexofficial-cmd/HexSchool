"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { Spinner } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admissionPublicApi } from "@/lib/api/admissions";

/** Public admission landing: open cycles + per-class seats and fees. */
export default function AdmissionLandingPage() {
  const cycles = useQuery({
    queryKey: ["public-admission-cycles"],
    queryFn: () => admissionPublicApi.cycles(),
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-8">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Online Admission
        </h1>
        <p className="text-muted-foreground">
          Apply online, pay the application fee, and track your application —
          all from your phone.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Button asChild>
            <Link href="/admission/apply">Apply now</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admission/track">Track application</Link>
          </Button>
        </div>
      </div>

      {cycles.isPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : cycles.isError ? (
        <ErrorState
          error={cycles.error}
          onRetry={() => void cycles.refetch()}
        />
      ) : cycles.data.length === 0 ? (
        <EmptyState
          title="Admissions are currently closed"
          description="No admission cycle is open right now. Please check back later or contact the school office."
        />
      ) : (
        cycles.data.map((cycle) => (
          <Card key={cycle.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {cycle.name}
                <Badge>Open</Badge>
                {cycle.testRequired ? (
                  <Badge variant="outline">Admission test</Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                Session {cycle.session.name} · applications close{" "}
                {cycle.endAt.slice(0, 10)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead>Seats</TableHead>
                    <TableHead>Application Fee</TableHead>
                    {cycle.testRequired ? (
                      <TableHead>Test Date</TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cycle.classes.map((c) => {
                    const test = cycle.tests.find(
                      (t) => t.classId === c.classId,
                    );
                    return (
                      <TableRow key={c.classId}>
                        <TableCell className="font-medium">
                          {c.className}
                        </TableCell>
                        <TableCell>{c.seats}</TableCell>
                        <TableCell>
                          {c.applicationFee > 0
                            ? `BDT ${c.applicationFee.toFixed(2)}`
                            : "Free"}
                        </TableCell>
                        {cycle.testRequired ? (
                          <TableCell>
                            {test
                              ? `${test.testDate.slice(0, 10)}${test.venue ? ` · ${test.venue}` : ""}`
                              : "To be announced"}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {cycle.instructions ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {cycle.instructions}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))
      )}
    </main>
  );
}
