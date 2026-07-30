"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Can } from "@/components/shared/can";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingBlock } from "@/components/shared/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { apiErrorMessage } from "@/lib/api/auth";
import {
  formatAmount,
  structureApi,
  type SalaryComponent,
  type SalaryStructure,
} from "@/lib/api/hr";
import {
  COMPONENT_CALCS,
  COMPONENT_CALC_LABELS,
  COMPONENT_TYPES,
  COMPONENT_TYPE_LABELS,
} from "@/lib/validations/hr";
import { useDebounce } from "@/lib/hooks/use-debounce";

const BLANK: SalaryComponent = {
  name: "",
  type: "ALLOWANCE",
  calc: "FLAT",
  value: 0,
  isTaxable: true,
  isPfBase: false,
};

/**
 * The structure builder (roadmap M21 §5: "component rows with live sample
 * calculation preview").
 *
 * The preview calls the SAME engine the payslip runs through, rather than
 * re-implementing the arithmetic in the browser: a builder that computed
 * house rent differently from payroll would be worse than no preview at
 * all, because it would be believed.
 */
export function StructuresTab() {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const [editing, setEditing] = useState<SalaryStructure | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SalaryStructure | null>(null);
  const qc = useQueryClient();

  const structures = useQuery({
    queryKey: ["salary-structures", debounced],
    queryFn: () => structureApi.list({ search: debounced || undefined }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => structureApi.remove(id),
    onSuccess: () => {
      toast.success("Structure deleted.");
      void qc.invalidateQueries({ queryKey: ["salary-structures"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-64 space-y-1">
          <Label>Search</Label>
          <Input
            value={search}
            placeholder="Scale name"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Can permission="salary.structure.manage">
          <Button onClick={() => setCreating(true)}>New salary scale</Button>
        </Can>
      </div>

      {structures.isPending ? (
        <LoadingBlock />
      ) : structures.isError ? (
        <ErrorState onRetry={() => void structures.refetch()} />
      ) : structures.data.length === 0 ? (
        <EmptyState
          title="No salary scales yet"
          description="A scale is a basic figure plus the allowances and deductions computed from it."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead className="text-right">Basic</TableHead>
              <TableHead className="text-right">Allowances</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {structures.data.map((structure) => (
              <TableRow key={structure.id}>
                <TableCell className="font-medium">{structure.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {structure.grade ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(structure.computed.basic)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(structure.computed.allowanceTotal)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatAmount(structure.computed.gross)}
                </TableCell>
                <TableCell>{structure.components.length}</TableCell>
                <TableCell>
                  <Badge variant={structure.isActive ? "default" : "secondary"}>
                    {structure.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <Can permission="salary.structure.manage">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(structure)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(structure)}
                    >
                      Delete
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {creating || editing ? (
        <StructureDialog
          structure={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete ${deleting.name}?`}
          description="Refused while anybody is assigned to it — deactivate it instead to retire a scale without losing history."
          confirmLabel="Delete"
          onConfirm={() => remove.mutate(deleting.id)}
          onOpenChange={(open) => (open ? null : setDeleting(null))}
        />
      ) : null}
    </div>
  );
}

function StructureDialog({
  structure,
  onClose,
}: {
  structure: SalaryStructure | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(structure?.name ?? "");
  const [grade, setGrade] = useState(structure?.grade ?? "");
  const [basic, setBasic] = useState(String(structure?.computed.basic ?? 0));
  const [components, setComponents] = useState<SalaryComponent[]>(
    structure?.components.map((c) => ({ ...c, value: Number(c.value) })) ?? [],
  );

  const numericBasic = Number(basic) || 0;

  const preview = useQuery({
    queryKey: ["structure-preview", numericBasic, JSON.stringify(components)],
    queryFn: () =>
      structureApi.preview({
        basic: numericBasic,
        components: components.map((c) => ({ ...c, value: Number(c.value) })),
      }),
    // The preview is the same engine the payslip uses; debounce-by-key is
    // enough because every keystroke changes the query key.
    enabled: true,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        grade: grade || undefined,
        basic: numericBasic,
        components: components.map((c) => ({ ...c, value: Number(c.value) })),
      };
      return structure
        ? structureApi.update(structure.id, payload)
        : structureApi.create(payload);
    },
    onSuccess: () => {
      toast.success(structure ? "Scale updated." : "Scale created.");
      void qc.invalidateQueries({ queryKey: ["salary-structures"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const update = (index: number, patch: Partial<SalaryComponent>) =>
    setComponents((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const problems = preview.data?.problems ?? [];
  const problemFor = (index: number) =>
    problems.find((p) => p.index === index)?.message;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {structure ? `Edit ${structure.name}` : "New salary scale"}
          </DialogTitle>
          <DialogDescription>
            Every figure below is computed by the same engine that will
            compute the payslip — what you see here is what the month pays.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Grade (optional)</Label>
            <Input value={grade} onChange={(e) => setGrade(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Basic</Label>
            <Input
              inputMode="decimal"
              value={basic}
              onChange={(e) => setBasic(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Components</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setComponents((rows) => [...rows, { ...BLANK }])}
            >
              Add line
            </Button>
          </div>

          {components.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No components — the scale pays the basic alone.
            </p>
          ) : (
            <div className="space-y-2">
              {components.map((component, index) => (
                <div
                  key={index}
                  className="grid items-end gap-2 rounded-md border p-2 sm:grid-cols-12"
                >
                  <div className="space-y-1 sm:col-span-4">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={component.name}
                      onChange={(e) => update(index, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={component.type}
                      onValueChange={(v) =>
                        update(index, { type: v as SalaryComponent["type"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPONENT_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {COMPONENT_TYPE_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <Label className="text-xs">Calculation</Label>
                    <Select
                      value={component.calc}
                      onValueChange={(v) =>
                        update(index, { calc: v as SalaryComponent["calc"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPONENT_CALCS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {COMPONENT_CALC_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Value</Label>
                    <Input
                      inputMode="decimal"
                      value={String(component.value)}
                      onChange={(e) =>
                        update(index, { value: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setComponents((rows) =>
                          rows.filter((_, i) => i !== index),
                        )
                      }
                    >
                      ✕
                    </Button>
                  </div>
                  <div className="flex gap-4 sm:col-span-12">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={component.isTaxable}
                        onCheckedChange={(v) =>
                          update(index, { isTaxable: v === true })
                        }
                      />
                      Taxable
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={component.isPfBase}
                        onCheckedChange={(v) =>
                          update(index, { isPfBase: v === true })
                        }
                      />
                      Part of the provident-fund base
                    </label>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {formatAmount(
                        preview.data?.computed.components[index]?.amount ?? 0,
                      )}
                    </span>
                  </div>
                  {problemFor(index) ? (
                    <p className="text-xs text-destructive sm:col-span-12">
                      {problemFor(index)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <PreviewStrip preview={preview.data?.computed} />

        {problems.some((p) => p.index === -1) ? (
          <p className="text-sm text-destructive">
            {problems.find((p) => p.index === -1)?.message}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              name.trim().length < 2 || problems.length > 0 || save.isPending
            }
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save scale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewStrip({
  preview,
}: {
  preview: SalaryStructure["computed"] | undefined;
}) {
  const cells = useMemo(
    () => [
      ["Basic", preview?.basic],
      ["Allowances", preview?.allowanceTotal],
      ["Gross", preview?.gross],
      ["Deductions", preview?.deductionTotal],
      ["Taxable", preview?.taxableGross],
      ["PF base", preview?.pfBase],
    ],
    [preview],
  );

  return (
    <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/40 p-3 sm:grid-cols-6">
      {cells.map(([label, value]) => (
        <div key={String(label)}>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-medium tabular-nums">
            {formatAmount(value as number | undefined)}
          </p>
        </div>
      ))}
    </div>
  );
}
