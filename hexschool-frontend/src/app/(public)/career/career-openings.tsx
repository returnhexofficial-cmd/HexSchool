"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CareerCard } from "@/lib/api/public-site";
import { publicSiteApi } from "@/lib/api/website";
import {
  careerApplySchema,
  type CareerApplyForm,
} from "@/lib/validations/website";
import { formatDate, RichText } from "../_components/ui";

/**
 * Job openings with an inline application form. The CV is a PDF and the
 * size limit is a school setting — the server is the authority on both,
 * so a rejection surfaces its message rather than being pre-guessed here
 * beyond the obvious ".pdf" hint.
 */
export function CareerOpenings({ openings }: { openings: CareerCard[] }) {
  const [applyingTo, setApplyingTo] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {openings.map((opening) => (
        <Card key={opening.id}>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{opening.title}</h2>
                <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
                  {opening.location ? <span>{opening.location}</span> : null}
                  {opening.vacancies ? (
                    <Badge variant="outline">
                      {opening.vacancies} vacanc
                      {opening.vacancies === 1 ? "y" : "ies"}
                    </Badge>
                  ) : null}
                  {opening.deadline ? (
                    <Badge variant="outline">
                      Apply by {formatDate(opening.deadline)}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <Button
                size="sm"
                variant={applyingTo === opening.id ? "outline" : "default"}
                onClick={() =>
                  setApplyingTo((current) =>
                    current === opening.id ? null : opening.id,
                  )
                }
              >
                {applyingTo === opening.id ? "Cancel" : "Apply"}
              </Button>
            </div>

            <RichText
              html={opening.description}
              className="mt-4 text-sm text-muted-foreground"
            />

            {applyingTo === opening.id ? (
              <ApplyForm
                careerId={opening.id}
                onDone={() => setApplyingTo(null)}
              />
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ApplyForm({
  careerId,
  onDone,
}: {
  careerId: string;
  onDone: () => void;
}) {
  const [cv, setCv] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<CareerApplyForm>({
    resolver: zodResolver(careerApplySchema),
    defaultValues: { name: "", phone: "", email: "", note: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!cv) {
      toast.error("Attach your CV as a PDF");
      return;
    }
    setSubmitting(true);
    try {
      const result = await publicSiteApi.applyToCareer(
        careerId,
        {
          name: values.name,
          phone: values.phone,
          email: values.email || undefined,
          note: values.note || undefined,
        },
        cv,
      );
      toast.success(result.message);
      form.reset();
      setCv(null);
      onDone();
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message ?? "Could not submit the application",
      );
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4 border-t pt-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`name-${careerId}`}>Full name</Label>
          <Input id={`name-${careerId}`} {...form.register("name")} />
          <FieldError message={form.formState.errors.name?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`phone-${careerId}`}>Mobile number</Label>
          <Input
            id={`phone-${careerId}`}
            placeholder="01XXXXXXXXX"
            {...form.register("phone")}
          />
          <FieldError message={form.formState.errors.phone?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`email-${careerId}`}>Email (optional)</Label>
          <Input id={`email-${careerId}`} {...form.register("email")} />
          <FieldError message={form.formState.errors.email?.message} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`cv-${careerId}`}>CV (PDF)</Label>
          <Input
            id={`cv-${careerId}`}
            type="file"
            accept="application/pdf"
            onChange={(event) => setCv(event.target.files?.[0] ?? null)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`note-${careerId}`}>Anything else (optional)</Label>
        <Textarea id={`note-${careerId}`} rows={3} {...form.register("note")} />
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Submit application"}
      </Button>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}
