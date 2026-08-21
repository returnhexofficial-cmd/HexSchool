"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  employeeApi,
  formatAmount,
  structureApi,
  type Employee,
  type PaymentMode,
  type PersonType,
} from "@/lib/api/hr";
import { PAYMENT_MODES } from "@/lib/validations/hr";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { formatDate } from "@/lib/utils/date";

const ALL = "__all__";

/**
 * The unified workforce list (roadmap M21 §1) and the salary-assignment
 * drawer that hangs off it.
 *
 * The assignment dialog is where the module's least obvious rule lives,
 * so the dialog says it out loud: saving does not *edit* what somebody is
 * paid, it records what they are paid **from a date**. Last month's
 * payslip keeps reading last month's row.
 */
export function EmployeesTab() {
  const [personType, setPersonType] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [assigning, setAssigning] = useState<Employee | null>(null);

  const employees = useQuery({
    queryKey: ["hr-employees", personType, debounced],
    queryFn: () =>
      employeeApi.list({
        personType: personType === ALL ? undefined : (personType as PersonType),
        search: debounced || undefined,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52 space-y-1">
          <Label>Employee type</Label>
          <Select value={personType} onValueChange={setPersonType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Everyone</SelectItem>
              <SelectItem value="TEACHER">Teachers</SelectItem>
              <SelectItem value="STAFF">Staff</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-64 space-y-1">
          <Label>Search</Label>
          <Input
            value={search}
            placeholder="Name or employee ID"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {employees.isPending ? (
        <LoadingBlock />
      ) : employees.isError ? (
        <ErrorState onRetry={() => void employees.refetch()} />
      ) : employees.data.length === 0 ? (
        <EmptyState
          title="No employees"
          description="Register teachers and staff first — they appear here automatically."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Salary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.data.map((employee) => (
              <TableRow key={`${employee.personType}:${employee.personId}`}>
                <TableCell className="font-mono text-xs">
                  {employee.employeeId}
                </TableCell>
                <TableCell className="font-medium">{employee.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{employee.personType}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {employee.designation.replaceAll("_", " ")}
                </TableCell>
                <TableCell>{formatDate(employee.joiningDate)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      employee.status === "ACTIVE" ? "default" : "secondary"
                    }
                  >
                    {employee.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Can permission="salary.assign">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAssigning(employee)}
                    >
                      Assign
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {assigning ? (
        <AssignSalaryDialog
          employee={assigning}
          onClose={() => setAssigning(null)}
        />
      ) : null}
    </div>
  );
}

function AssignSalaryDialog({
  employee,
  onClose,
}: {
  employee: Employee;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [structureId, setStructureId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 8) + "01",
  );
  const [basicOverride, setBasicOverride] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("BANK");
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [accountNo, setAccountNo] = useState("");

  const structures = useQuery({
    queryKey: ["salary-structures", "active"],
    queryFn: () => structureApi.list({ activeOnly: true }),
  });

  const history = useQuery({
    queryKey: ["salary-history", employee.personType, employee.personId],
    queryFn: () =>
      employeeApi.salaryHistory(employee.personType, employee.personId),
  });

  const selected = useMemo(
    () => structures.data?.find((s) => s.id === structureId),
    [structures.data, structureId],
  );

  const save = useMutation({
    mutationFn: () =>
      employeeApi.assignSalary(employee.personId, {
        personType: employee.personType,
        structureId,
        effectiveFrom,
        basicOverride: basicOverride === "" ? undefined : Number(basicOverride),
        paymentMode,
        bankAccount:
          paymentMode === "BANK"
            ? { bankName, branchName, accountNo, accountName: employee.name }
            : undefined,
      }),
    onSuccess: () => {
      toast.success(`Salary recorded from ${effectiveFrom}.`);
      void qc.invalidateQueries({ queryKey: ["salary-history"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Salary — {employee.name}</DialogTitle>
          <DialogDescription>
            This records what {employee.name.split(" ")[0]} is paid{" "}
            <strong>from a date</strong>. It never edits an earlier row, so a
            payslip already issued keeps the figures it was issued with.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Salary structure</Label>
            <Select value={structureId} onValueChange={setStructureId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a scale" />
              </SelectTrigger>
              <SelectContent>
                {(structures.data ?? []).map((structure) => (
                  <SelectItem key={structure.id} value={structure.id}>
                    {structure.name} — {formatAmount(structure.computed.gross)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Effective from</Label>
            <Input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Basic override (optional)</Label>
            <Input
              inputMode="decimal"
              placeholder={
                selected ? String(selected.computed.basic) : "Scale basic"
              }
              value={basicOverride}
              onChange={(e) => setBasicOverride(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Set 0 for an MPO teacher whose basic the government pays.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Payment mode</Label>
            <Select
              value={paymentMode}
              onValueChange={(v) => setPaymentMode(v as PaymentMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paymentMode === "BANK" ? (
            <>
              <div className="space-y-1">
                <Label>Bank</Label>
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Branch</Label>
                <Input
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Account number</Label>
                <Input
                  value={accountNo}
                  onChange={(e) => setAccountNo(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Required for a bank transfer — the advice sheet is generated
                  weeks later, and a blank account cannot be paid.
                </p>
              </div>
            </>
          ) : null}
        </div>

        {history.data && history.data.history.length > 0 ? (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Salary history
            </p>
            <ul className="space-y-1 text-sm">
              {history.data.history.slice(0, 5).map((row) => (
                <li key={row.id} className="flex justify-between">
                  <span>
                    {row.effectiveFrom.slice(0, 10)} — {row.structure.name}
                  </span>
                  <span className="tabular-nums">
                    {formatAmount(
                      row.basicOverride ?? row.structure.basic,
                    )}{" "}
                    basic
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!structureId || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Record salary"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
