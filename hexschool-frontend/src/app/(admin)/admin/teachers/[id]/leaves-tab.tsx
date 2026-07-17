"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { teacherLeavesApi } from "@/lib/api/teachers";
import { LeavesTable } from "../leaves/leaves-table";

/** Teacher-scoped slice of the leave inbox (shared table component). */
export function LeavesTab({ teacherId }: { teacherId: string }) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);

  const leaves = useQuery({
    queryKey: ["teacher-leaves", { teacherId, page, limit }],
    queryFn: () => teacherLeavesApi.list({ teacherId, page, limit }),
    placeholderData: keepPreviousData,
  });

  return (
    <LeavesTable
      query={leaves}
      onPageChange={setPage}
      onLimitChange={(l) => {
        setLimit(l);
        setPage(1);
      }}
      fixedTeacherId={teacherId}
      showTeacherColumn={false}
    />
  );
}
