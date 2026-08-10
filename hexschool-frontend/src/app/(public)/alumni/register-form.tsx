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
import { publicCommunityApi } from "@/lib/api/community";
import {
  publicAlumniSchema,
  type PublicAlumniForm,
} from "@/lib/validations/community";

/**
 * Roadmap §5's "public register page".
 *
 * **The opt-in checkbox is unticked and stays that way unless somebody
 * ticks it.** A registration is a claim on a place in the school's own
 * records; publishing it on the internet is a second, separate decision,
 * and defaulting it on would make it one nobody consciously took. The
 * column defaults `false` at the database for the same reason.
 */
export function AlumniRegisterCard() {
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<PublicAlumniForm>({
    resolver: zodResolver(publicAlumniSchema),
    defaultValues: {
      name: "",
      batchYear: new Date().getFullYear(),
      lastClass: "",
      phone: "",
      email: "",
      profession: "",
      organization: "",
      bio: "",
      isPublicProfile: false,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await publicCommunityApi.registerAlumni({
        name: values.name,
        batchYear: Number(values.batchYear),
        lastClass: values.lastClass || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        profession: values.profession || undefined,
        organization: values.organization || undefined,
        bio: values.bio || undefined,
        isPublicProfile: values.isPublicProfile ?? false,
      });
      setDone(result.message);
      form.reset();
    } catch (error) {
      toast.error(
        (error as { response?: { data?: { error?: { message?: string } } } })
          .response?.data?.error?.message ?? "Could not register you",
      );
    } finally {
      setSubmitting(false);
    }
  });

  if (done) {
    return (
      <Card>
        <CardContent className="space-y-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">{done}</p>
          <Button variant="outline" size="sm" onClick={() => setDone(null)}>
            Register somebody else
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register as an alumnus</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="a-name">Your name</Label>
            <Input id="a-name" {...form.register("name")} />
            <FieldError message={form.formState.errors.name?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-batch">Batch year</Label>
              <Input
                id="a-batch"
                type="number"
                {...form.register("batchYear", { valueAsNumber: true })}
              />
              <FieldError message={form.formState.errors.batchYear?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-class">Last class</Label>
              <Input id="a-class" {...form.register("lastClass")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-phone">Mobile number</Label>
            <Input
              id="a-phone"
              placeholder="01XXXXXXXXX"
              {...form.register("phone")}
            />
            <FieldError message={form.formState.errors.phone?.message} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-email">Email</Label>
            <Input id="a-email" {...form.register("email")} />
            <FieldError message={form.formState.errors.email?.message} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="a-profession">Profession</Label>
              <Input id="a-profession" {...form.register("profession")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-org">Organization</Label>
              <Input id="a-org" {...form.register("organization")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-bio">A line about yourself</Label>
            <Textarea id="a-bio" rows={3} {...form.register("bio")} />
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              {...form.register("isPublicProfile")}
            />
            <span>
              Show me on the public directory. Only my name, batch, class,
              profession, organization and note would be published —{" "}
              <strong>never my phone number, email or address</strong>.
            </span>
          </label>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Sending…" : "Register"}
          </Button>

          <p className="text-xs text-muted-foreground">
            The school reviews every registration before it appears anywhere.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}
