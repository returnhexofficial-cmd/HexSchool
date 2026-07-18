"use client";

import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { Spinner } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import {
  Card,
  CardContent,
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
import { admissionReportsApi } from "@/lib/api/admissions";

/** Admission funnel: applied → selected → admitted, per class. */
export function ReportsTab({ cycleId }: { cycleId: string }) {
  const summary = useQuery({
    queryKey: ["admission-summary", cycleId],
    queryFn: () => admissionReportsApi.summary(cycleId),
  });

  if (summary.isPending) return <Spinner />;
  if (summary.isError) {
    return (
      <ErrorState
        error={summary.error}
        onRetry={() => void summary.refetch()}
      />
    );
  }

  const { funnel, classes } = summary.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Applied" value={String(funnel.applied)} />
        <StatCard title="In pipeline" value={String(funnel.processed)} />
        <StatCard title="Selected" value={String(funnel.selected)} />
        <StatCard title="Waitlisted" value={String(funnel.waitlisted)} />
        <StatCard title="Admitted" value={String(funnel.admitted)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-class funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Awaiting Fee</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Passed</TableHead>
                <TableHead>Selected</TableHead>
                <TableHead>Waitlisted</TableHead>
                <TableHead>Admitted</TableHead>
                <TableHead>Fees (BDT)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((c) => (
                <TableRow key={c.classId}>
                  <TableCell className="font-medium">{c.className}</TableCell>
                  <TableCell>{c.seats}</TableCell>
                  <TableCell>{c.applied}</TableCell>
                  <TableCell>{c.paymentPending}</TableCell>
                  <TableCell>{c.testScheduled}</TableCell>
                  <TableCell>{c.passed}</TableCell>
                  <TableCell>{c.selected}</TableCell>
                  <TableCell>{c.waitlisted}</TableCell>
                  <TableCell>{c.admitted}</TableCell>
                  <TableCell>{c.feesCollected.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
