"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { DataTable } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  admissionApplicationsApi,
  APPLICATION_STATUS_LABELS,
  type AdmissionApplication,
  type AdmissionApplicationStatus,
  type AdmissionCycle,
  type AdmissionPaymentStatus,
} from "@/lib/api/admissions";
import { apiErrorMessage } from "@/lib/api/auth";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  PAYMENT_METHODS,
  recordPaymentSchema,
  type RecordPaymentValues,
} from "@/lib/validations/admission";

const ALL = "__all__";

const STATUS_VARIANT: Partial<
  Record<
    AdmissionApplicationStatus,
    "default" | "secondary" | "destructive" | "outline"
  >
> = {
  SELECTED: "default",
  ADMITTED: "default",
  FAILED: "destructive",
  REJECTED: "destructive",
  CANCELLED: "destructive",
  EXPIRED: "destructive",
};

/** Manual review targets per current status (mirrors the backend map). */
const MANUAL_TARGETS: Partial<
  Record<AdmissionApplicationStatus, AdmissionApplicationStatus[]>
> = {
  SUBMITTED: ["UNDER_REVIEW", "REJECTED", "CANCELLED"],
  PAYMENT_PENDING: ["CANCELLED"],
  UNDER_REVIEW: ["REJECTED", "CANCELLED"],
  TEST_SCHEDULED: ["CANCELLED"],
  SELECTED: ["CANCELLED"],
  WAITLISTED: ["CANCELLED"],
};

export function ApplicationsTab({ cycle }: { cycle: AdmissionCycle }) {
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState<AdmissionApplicationStatus | "">("");
  const [paymentStatus, setPaymentStatus] = useState<
    AdmissionPaymentStatus | ""
  >("");
  const debouncedSearch = useDebounce(search, 300);

  const [payFor, setPayFor] = useState<AdmissionApplication | null>(null);
  const [reviewFor, setReviewFor] = useState<{
    app: AdmissionApplication;
    status: AdmissionApplicationStatus;
  } | null>(null);
  const [reviewReason, setReviewReason] = useState("");

  const query = useQuery({
    queryKey: [
      "admission-applications",
      {
        cycleId: cycle.id,
        page,
        limit,
        search: debouncedSearch,
        classId,
        status,
        paymentStatus,
      },
    ],
    queryFn: () =>
      admissionApplicationsApi.list({
        cycleId: cycle.id,
        page,
        limit,
        search: debouncedSearch,
        classId: classId || undefined,
        status: status || undefined,
        paymentStatus: paymentStatus || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admission-applications"] });

  const payForm = useForm<RecordPaymentValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: { method: "CASH", reference: "", amount: "" },
  });

  const recordPayment = useMutation({
    mutationFn: (values: RecordPaymentValues) =>
      admissionApplicationsApi.recordPayment(payFor!.id, {
        method: values.method,
        reference: values.reference || undefined,
        amount: values.amount ? Number(values.amount) : undefined,
      }),
    onSuccess: () => {
      toast.success("Payment recorded.");
      setPayFor(null);
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const waive = useMutation({
    mutationFn: (app: AdmissionApplication) =>
      admissionApplicationsApi.setPaymentStatus(
        app.id,
        "WAIVED",
        "Waived at the admission desk",
      ),
    onSuccess: () => {
      toast.success("Fee waived.");
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const review = useMutation({
    mutationFn: (params: {
      app: AdmissionApplication;
      status: AdmissionApplicationStatus;
      reason: string;
    }) =>
      admissionApplicationsApi.updateStatus(
        params.app.id,
        params.status,
        params.reason || undefined,
      ),
    onSuccess: (_, params) => {
      toast.success(
        `${params.app.applicationNo} → ${APPLICATION_STATUS_LABELS[params.status]}.`,
      );
      setReviewFor(null);
      setReviewReason("");
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const admit = useMutation({
    mutationFn: (app: AdmissionApplication) =>
      admissionApplicationsApi.admit(app.id),
    onSuccess: (result) => {
      toast.success(
        result.alreadyAdmitted
          ? `Already admitted — student ${result.student.studentUid}.`
          : `Admitted! Student ${result.student.studentUid} created.`,
        { duration: 10000 },
      );
      result.warnings?.forEach((w) => toast.warning(w));
      void invalidate();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const admitCard = useMutation({
    mutationFn: (app: AdmissionApplication) =>
      admissionApplicationsApi.downloadAdmitCard(app.id, app.applicationNo),
    onSuccess: () => toast.success("Admit card downloaded."),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const columns: ColumnDef<AdmissionApplication>[] = [
    { accessorKey: "applicationNo", header: "Application No" },
    {
      id: "name",
      header: "Applicant",
      cell: ({ row }) =>
        `${row.original.firstName} ${row.original.lastName}`,
    },
    { id: "class", header: "Class", cell: ({ row }) => row.original.class.name },
    { accessorKey: "phone", header: "Phone" },
    {
      id: "payment",
      header: "Payment",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.paymentStatus === "PAID" ||
            row.original.paymentStatus === "WAIVED"
              ? "outline"
              : "secondary"
          }
        >
          {row.original.paymentStatus}
        </Badge>
      ),
    },
    {
      id: "marks",
      header: "Marks",
      cell: ({ row }) =>
        row.original.testMarks === null
          ? "—"
          : Number(row.original.testMarks).toFixed(1),
    },
    {
      id: "merit",
      header: "Merit",
      cell: ({ row }) => row.original.meritPosition ?? "—",
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status] ?? "secondary"}>
          {APPLICATION_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const app = row.original;
        const targets = MANUAL_TARGETS[app.status] ?? [];
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{app.applicationNo}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {can("admission.payment.record") &&
              app.paymentStatus === "UNPAID" ? (
                <DropdownMenuItem onClick={() => setPayFor(app)}>
                  Record payment
                </DropdownMenuItem>
              ) : null}
              {can("admission.payment.waive") &&
              app.paymentStatus === "UNPAID" ? (
                <DropdownMenuItem onClick={() => waive.mutate(app)}>
                  Waive fee
                </DropdownMenuItem>
              ) : null}
              {can("admission.admit") && app.status === "SELECTED" ? (
                <DropdownMenuItem onClick={() => admit.mutate(app)}>
                  Admit → create student
                </DropdownMenuItem>
              ) : null}
              {app.status === "ADMITTED" && app.student ? (
                <DropdownMenuItem disabled>
                  Student: {app.student.studentUid}
                </DropdownMenuItem>
              ) : null}
              {cycle.testRequired &&
              ["TEST_SCHEDULED", "PASSED", "FAILED", "SELECTED", "WAITLISTED", "ADMITTED"].includes(
                app.status,
              ) ? (
                <DropdownMenuItem onClick={() => admitCard.mutate(app)}>
                  Admit card PDF
                </DropdownMenuItem>
              ) : null}
              {can("admission.application.review") && targets.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  {targets.map((t) => (
                    <DropdownMenuItem
                      key={t}
                      onClick={() => setReviewFor({ app, status: t })}
                    >
                      Mark {APPLICATION_STATUS_LABELS[t]}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const filterSelect = <T extends string>(
    value: T | "",
    onChange: (v: T | "") => void,
    placeholder: string,
    items: Array<{ value: string; label: string }>,
  ) => (
    <Select
      value={value || ALL}
      onValueChange={(v) => {
        onChange((v === ALL ? "" : v) as T | "");
        setPage(1);
      }}
    >
      <SelectTrigger size="sm" className="w-44">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={query.data?.data ?? []}
        meta={query.data?.meta}
        isLoading={query.isPending}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
        search={search}
        onSearchChange={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchPlaceholder="Name, application no, phone…"
        exportFileName={`applications-${cycle.name}`}
        emptyTitle="No applications yet"
        emptyDescription="Applications arrive from the public portal once the cycle is open."
        toolbar={
          <>
            {filterSelect(
              classId,
              setClassId,
              "All classes",
              cycle.classes.map((c) => ({
                value: c.classId,
                label: c.class.name,
              })),
            )}
            {filterSelect(
              status,
              setStatus,
              "All statuses",
              Object.entries(APPLICATION_STATUS_LABELS).map(([v, l]) => ({
                value: v,
                label: l,
              })),
            )}
            {filterSelect(
              paymentStatus,
              setPaymentStatus,
              "All payments",
              ["UNPAID", "PAID", "WAIVED", "REFUNDED"].map((v) => ({
                value: v,
                label: v,
              })),
            )}
          </>
        }
      />

      <FormDialog
        open={payFor !== null}
        onOpenChange={(open) => !open && setPayFor(null)}
        title={`Record payment — ${payFor?.applicationNo ?? ""}`}
        description="Offline payment at the office. Online gateways arrive with Module 16."
        form={payForm}
        onSubmit={(values) => recordPayment.mutate(values)}
        submitLabel="Record payment"
        isPending={recordPayment.isPending}
      >
        <div className="space-y-2">
          <Label>Method</Label>
          <Select
            value={payForm.watch("method")}
            onValueChange={(v) =>
              payForm.setValue("method", v as RecordPaymentValues["method"])
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pay-ref">Reference (receipt / txn id)</Label>
          <Input id="pay-ref" {...payForm.register("reference")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pay-amount">
            Amount (blank = class fee
            {payFor
              ? ` BDT ${Number(
                  cycle.classes.find((c) => c.classId === payFor.classId)
                    ?.applicationFee ?? 0,
                ).toFixed(2)}`
              : ""}
            )
          </Label>
          <Input id="pay-amount" {...payForm.register("amount")} />
          {payForm.formState.errors.amount?.message ? (
            <p className="text-sm text-destructive">
              {payForm.formState.errors.amount.message}
            </p>
          ) : null}
        </div>
      </FormDialog>

      {/* Manual review transition with a reason. */}
      {reviewFor ? (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setReviewFor(null);
              setReviewReason("");
            }
          }}
          title={`${reviewFor.app.applicationNo} → ${APPLICATION_STATUS_LABELS[reviewFor.status]}`}
          form={payForm /* unused fields; simple confirm-with-reason */}
          onSubmit={() =>
            review.mutate({
              app: reviewFor.app,
              status: reviewFor.status,
              reason: reviewReason,
            })
          }
          submitLabel="Apply"
          isPending={review.isPending}
        >
          <div className="space-y-2">
            <Label htmlFor="review-reason">Reason (sent by SMS)</Label>
            <Input
              id="review-reason"
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              placeholder="Optional note for the applicant"
            />
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
