"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Spinner } from "@/components/shared/spinner";
import { EmptyState } from "@/components/shared/empty-state";
import {
  publicResultApi,
  type PublicResultCard,
} from "@/lib/api/result";

/**
 * Exam + class + roll → result card. The API answers the same 404 for a
 * wrong roll, a withheld result and an unpublished exam (the M15 rule),
 * so this page shows one message for all three rather than guessing which
 * it was.
 */
export function ResultSearch() {
  const [examId, setExamId] = useState("");
  const [classId, setClassId] = useState("");
  const [roll, setRoll] = useState("");
  const [uid, setUid] = useState("");
  const [result, setResult] = useState<PublicResultCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const exams = useQuery({
    queryKey: ["public-searchable-exams"],
    queryFn: () => publicResultApi.searchableExams(),
  });

  const selectedExam = exams.data?.find((exam) => exam.examId === examId);

  const onSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    if (!examId || !classId) {
      setError("Choose the exam and the class first.");
      return;
    }
    if (!roll && !uid) {
      setError("Enter a roll number or a student ID.");
      return;
    }
    setSearching(true);
    try {
      const card = await publicResultApi.search({
        examId,
        classId,
        ...(uid ? { studentUid: uid } : { rollNo: Number(roll) }),
      });
      setResult(card);
    } catch {
      setError(
        "No published result matches that search. Check the class and roll number, or contact the office.",
      );
    } finally {
      setSearching(false);
    }
  };

  if (exams.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!exams.data || exams.data.length === 0) {
    return (
      <EmptyState
        title="No results are published right now"
        description="When the school publishes an exam result to the website, it will be searchable here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Find a result</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSearch} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="exam">Exam</Label>
                <Select
                  value={examId}
                  onValueChange={(value) => {
                    setExamId(value);
                    setClassId("");
                  }}
                >
                  <SelectTrigger id="exam">
                    <SelectValue placeholder="Choose an exam" />
                  </SelectTrigger>
                  <SelectContent>
                    {exams.data.map((exam) => (
                      <SelectItem key={exam.examId} value={exam.examId}>
                        {exam.examName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="class">Class</Label>
                <Select
                  value={classId}
                  onValueChange={setClassId}
                  disabled={!selectedExam}
                >
                  <SelectTrigger id="class">
                    <SelectValue placeholder="Choose a class" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedExam?.classes ?? []).map((klass) => (
                      <SelectItem key={klass.id} value={klass.id}>
                        {klass.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="roll">Roll number</Label>
                <Input
                  id="roll"
                  inputMode="numeric"
                  value={roll}
                  onChange={(event) => {
                    setRoll(event.target.value);
                    if (event.target.value) setUid("");
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="uid">…or student ID</Label>
                <Input
                  id="uid"
                  value={uid}
                  onChange={(event) => {
                    setUid(event.target.value);
                    if (event.target.value) setRoll("");
                  }}
                />
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button type="submit" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {result ? <ResultCard card={result} /> : null}
    </div>
  );
}

function ResultCard({ card }: { card: PublicResultCard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          {card.student.name}
          <Badge variant={card.status === "PASSED" ? "default" : "outline"}>
            {card.status}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {card.exam.name} · Class {card.student.className}
          {card.student.sectionName ? ` (${card.student.sectionName})` : ""} ·
          Roll {card.student.rollNo}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure label="GPA" value={card.gpa.toFixed(2)} />
          <Figure label="Grade" value={card.grade} />
          <Figure
            label="Merit (class)"
            value={card.meritPositionClass ? `#${card.meritPositionClass}` : "—"}
          />
        </div>

        {card.subjects.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Grade point</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.subjects.map((subject) => (
                  <TableRow key={subject.subjectName}>
                    <TableCell>{subject.subjectName}</TableCell>
                    <TableCell>{subject.grade}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {subject.gradePoint.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          This is an online copy. The school office issues the official
          marksheet.
        </p>
      </CardContent>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
