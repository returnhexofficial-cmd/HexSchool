"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  publicCommunityApi,
} from "@/lib/api/community";
import {
  publicTicketSchema,
  type PublicTicketForm,
} from "@/lib/validations/community";

/**
 * The public complaint form (roadmap §5's "public complaint form").
 *
 * The backend runs reCAPTCHA, a route throttle and a per-IP hourly cap;
 * the client's job is to catch the obvious mistakes — chiefly "leave a
 * contact, or tick anonymous", which is also a DB CHECK.
 *
 * **When anonymous is ticked, the contact fields disappear rather than
 * being ignored.** A form that still shows a phone box while promising
 * anonymity is asking somebody to trust a claim it is visibly
 * contradicting. Nothing is sent, nothing is stored, and the confirmation
 * says so plainly.
 */
export function ComplaintFormCard() {
  const [submitted, setSubmitted] = useState<{
    ticketNo: string;
    message: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<PublicTicketForm>({
    resolver: zodResolver(publicTicketSchema),
    defaultValues: {
      type: "COMPLAINT",
      category: "OTHER",
      subject: "",
      description: "",
      name: "",
      phone: "",
      email: "",
      anonymous: false,
    },
  });

  const anonymous = form.watch("anonymous");

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await publicCommunityApi.submitTicket({
        type: values.type,
        category: values.category,
        subject: values.subject,
        description: values.description,
        // Nothing identifying is sent at all when anonymous — not blanked
        // server-side, simply never transmitted.
        ...(values.anonymous
          ? { anonymous: true }
          : {
              name: values.name || undefined,
              phone: values.phone || undefined,
              email: values.email || undefined,
            }),
      });
      setSubmitted(result);
      form.reset();
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message ??
          "Could not send your submission",
      );
    } finally {
      setSubmitting(false);
    }
  });

  if (submitted) {
    return (
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">{submitted.message}</p>
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-xs uppercase text-muted-foreground">
              Your reference
            </p>
            <p className="font-mono text-lg font-semibold">
              {submitted.ticketNo}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubmitted(null)}
          >
            Submit another
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tell the school</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-type">This is a…</Label>
              <select
                id="c-type"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                {...form.register("type")}
              >
                {TICKET_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TICKET_TYPE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-category">About</Label>
              <select
                id="c-category"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                {...form.register("category")}
              >
                {TICKET_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {TICKET_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-subject">Subject</Label>
            <Input id="c-subject" maxLength={200} {...form.register("subject")} />
            <FieldError message={form.formState.errors.subject?.message} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="c-description">What happened</Label>
            <Textarea
              id="c-description"
              rows={6}
              {...form.register("description")}
            />
            <FieldError message={form.formState.errors.description?.message} />
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              {...form.register("anonymous")}
            />
            <span>
              <strong>Submit anonymously.</strong> The school will store no
              name, no contact and no record of where this came from — and
              will therefore not be able to reply.
            </span>
          </label>

          {!anonymous && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="c-name">Your name</Label>
                <Input id="c-name" {...form.register("name")} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="c-phone">Mobile number</Label>
                  <Input
                    id="c-phone"
                    placeholder="01XXXXXXXXX"
                    {...form.register("phone")}
                  />
                  <FieldError message={form.formState.errors.phone?.message} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-email">Email</Label>
                  <Input id="c-email" {...form.register("email")} />
                  <FieldError message={form.formState.errors.email?.message} />
                </div>
              </div>
            </div>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Sending…" : "Submit"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}
