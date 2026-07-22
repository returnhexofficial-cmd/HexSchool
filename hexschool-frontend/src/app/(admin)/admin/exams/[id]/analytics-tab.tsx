"use client";

import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { StatCard } from "@/components/shared/stat-card";
import { resultApi, type PassRateRow } from "@/lib/api/result";
import { cn } from "@/lib/utils";

/**
 * Result analytics (roadmap M15 §5): pass rates, the GPA histogram,
 * subject difficulty and the year-over-year comparison.
 *
 * The bars are plain divs rather than a charting dependency — these are
 * single-series comparisons where a labelled bar is as readable as a
 * chart and costs nothing to render inside a tab.
 */
export function AnalyticsTab({ examId }: { examId: string }) {
  const analytics = useQuery({
    queryKey: ["result-analytics", examId],
    queryFn: () => resultApi.analytics(examId),
  });

  if (analytics.isLoading) return <LoadingBlock />;
  if (!analytics.data || analytics.data.overall.candidates === 0) {
    return (
      <EmptyState
        title="Nothing to analyse yet"
        description="Process the exam's results first."
      />
    );
  }

  const { overall, byClass, bySection, gpaDistribution, subjects, comparison } =
    analytics.data;
  const topGrade = Math.max(1, ...gpaDistribution.map((g) => g.count));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Candidates" value={String(overall.candidates)} />
        <StatCard title="Pass rate" value={`${overall.passRate}%`} />
        <StatCard title="Average GPA" value={overall.averageGpa.toFixed(2)} />
        <StatCard title="Failed" value={String(overall.failed)} />
      </div>

      <section className="space-y-2">
        <h3 className="font-medium">GPA distribution</h3>
        <div className="space-y-1.5 rounded-md border p-4">
          {gpaDistribution.map((band) => (
            <div key={band.grade} className="flex items-center gap-3 text-sm">
              <span className="w-10 font-medium">{band.grade}</span>
              <div className="bg-muted h-4 flex-1 overflow-hidden rounded">
                <div
                  className="bg-primary h-full"
                  style={{ width: `${(band.count / topGrade) * 100}%` }}
                />
              </div>
              <span className="text-muted-foreground w-10 text-right">
                {band.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      <PassRateTable title="Pass rate by class" rows={byClass} />
      <PassRateTable title="Pass rate by section" rows={bySection} />

      <section className="space-y-2">
        <h3 className="font-medium">Subject difficulty</h3>
        <p className="text-muted-foreground text-xs">
          Hardest first. Absent candidates are excluded from the average — a
          hall of zeros would make every paper look impossible — but counted
          separately.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Paper</th>
                <th className="px-3 py-2 text-right font-medium">Entered</th>
                <th className="px-3 py-2 text-right font-medium">Absent</th>
                <th className="px-3 py-2 text-right font-medium">Average</th>
                <th className="px-3 py-2 text-right font-medium">Pass rate</th>
                <th className="px-3 py-2 text-right font-medium">Range</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.examSubjectId} className="border-t">
                  <td className="px-3 py-1.5">{subject.label}</td>
                  <td className="px-3 py-1.5 text-right">
                    {subject.marksEntered}
                  </td>
                  <td className="px-3 py-1.5 text-right">{subject.absent}</td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-medium",
                      subject.averagePercentage < 50 && "text-destructive",
                    )}
                  >
                    {subject.averagePercentage}%
                  </td>
                  <td className="px-3 py-1.5 text-right">{subject.passRate}%</td>
                  <td className="text-muted-foreground px-3 py-1.5 text-right">
                    {subject.lowest}–{subject.highest}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {comparison.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">Compared with earlier {""}exams</h3>
          <p className="text-muted-foreground text-xs">
            Same exam type in previous sessions — comparing an annual with a
            half-yearly would not mean anything.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Exam</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Candidates
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Pass rate
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Avg GPA</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-muted/30 border-t font-medium">
                  <td className="px-3 py-1.5">This exam</td>
                  <td className="px-3 py-1.5 text-right">
                    {overall.candidates}
                  </td>
                  <td className="px-3 py-1.5 text-right">{overall.passRate}%</td>
                  <td className="px-3 py-1.5 text-right">
                    {overall.averageGpa.toFixed(2)}
                  </td>
                </tr>
                {comparison.map((row) => (
                  <tr key={row.examId} className="border-t">
                    <td className="px-3 py-1.5">{row.examName}</td>
                    <td className="px-3 py-1.5 text-right">{row.candidates}</td>
                    <td className="px-3 py-1.5 text-right">{row.passRate}%</td>
                    <td className="px-3 py-1.5 text-right">
                      {row.averageGpa.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PassRateTable({
  title,
  rows,
}: {
  title: string;
  rows: PassRateRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-medium">{title}</h3>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Group</th>
              <th className="px-3 py-2 text-right font-medium">Candidates</th>
              <th className="px-3 py-2 text-right font-medium">Passed</th>
              <th className="px-3 py-2 text-right font-medium">Failed</th>
              <th className="px-3 py-2 text-right font-medium">Pass rate</th>
              <th className="px-3 py-2 text-right font-medium">Avg GPA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-1.5">{row.label}</td>
                <td className="px-3 py-1.5 text-right">{row.candidates}</td>
                <td className="px-3 py-1.5 text-right">{row.passed}</td>
                <td className="px-3 py-1.5 text-right">{row.failed}</td>
                <td className="px-3 py-1.5 text-right font-medium">
                  {row.passRate}%
                </td>
                <td className="px-3 py-1.5 text-right">
                  {row.averageGpa.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
