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
import { publicSiteApi } from "@/lib/api/website";
import { contactSchema, type ContactForm } from "@/lib/validations/website";

/**
 * The public contact form. The backend runs reCAPTCHA, a per-IP hourly
 * cap and a throttle on this endpoint; the client's job is to catch the
 * obvious mistakes first — chiefly "leave a phone or an email", which is
 * also a DB CHECK.
 */
export function ContactFormCard() {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", phone: "", email: "", subject: "", body: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await publicSiteApi.contact({
        name: values.name,
        phone: values.phone || undefined,
        email: values.email || undefined,
        subject: values.subject || undefined,
        body: values.body,
      });
      toast.success(result.message);
      form.reset();
      setSent(true);
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message ?? "Could not send your message",
      );
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a message</CardTitle>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="space-y-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Thank you — the school has received your message and will get
              back to you.
            </p>
            <Button variant="outline" size="sm" onClick={() => setSent(false)}>
              Send another
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="contact-name">Your name</Label>
              <Input id="contact-name" {...form.register("name")} />
              <FieldError message={form.formState.errors.name?.message} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-phone">Mobile number</Label>
                <Input
                  id="contact-phone"
                  placeholder="01XXXXXXXXX"
                  {...form.register("phone")}
                />
                <FieldError message={form.formState.errors.phone?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-email">Email</Label>
                <Input id="contact-email" {...form.register("email")} />
                <FieldError message={form.formState.errors.email?.message} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-subject">Subject (optional)</Label>
              <Input id="contact-subject" {...form.register("subject")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-body">Message</Label>
              <Textarea id="contact-body" rows={6} {...form.register("body")} />
              <FieldError message={form.formState.errors.body?.message} />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Sending…" : "Send message"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}
