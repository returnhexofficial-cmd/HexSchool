"use client";

import type { FieldValues, UseFormReturn } from "react-hook-form";
import { FormProvider } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/shared/spinner";

interface FormDialogProps<TValues extends FieldValues> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** RHF instance created with zodResolver — schemas live in src/lib/validations. */
  form: UseFormReturn<TValues>;
  onSubmit: (values: TValues) => void | Promise<void>;
  submitLabel?: string;
  cancelLabel?: string;
  isPending?: boolean;
  /** Form fields; register them via the provided FormProvider context. */
  children: React.ReactNode;
}

/**
 * Generic create/edit dialog: RHF context + submit/cancel footer. Usage:
 *
 *   const form = useForm<Values>({ resolver: zodResolver(schema) });
 *   <FormDialog form={form} onSubmit={save} ...>
 *     <Input {...form.register("name")} />
 *   </FormDialog>
 */
export function FormDialog<TValues extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  isPending = false,
  children,
}: FormDialogProps<TValues>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <FormProvider {...form}>
          <form
            onSubmit={form.handleSubmit((values) => void onSubmit(values))}
            className="space-y-4"
            noValidate
          >
            {children}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => onOpenChange(false)}
              >
                {cancelLabel}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? <Spinner className="mr-1 size-4" /> : null}
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
