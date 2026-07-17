"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { teacherLeavesApi, type LeaveStatus } from "@/lib/api/teachers";
import { LeavesTable } from "./leaves-table";

const ALL = "__all__";

/** Leave approval inbox for principal/admin (roadmap M08 §5). */
export default function TeacherLeavesPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState<LeaveStatus | "">("PENDING");

  const leaves = useQuery({
    queryKey: ["teacher-leaves", { page, limit, status }],
    queryFn: () =>
      teacherLeavesApi.list({ page, limit, status: status || undefined }),
    placeholderData: keepPreviousData,
  });

  return (
    <main className="flex-1 space-y-6 p-8">
      <PageHeader
        title="Teacher leaves"
        description="Requests wait here as PENDING until approved or rejected"
      />
      <LeavesTable
        query={leaves}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        toolbar={
          <Select
            value={status || ALL}
            onValueChange={(v) => {
              setStatus((v === ALL ? "" : v) as LeaveStatus | "");
              setPage(1);
            }}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </main>
  );
}
