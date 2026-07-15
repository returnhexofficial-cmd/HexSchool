"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/shared/spinner";
import { apiErrorMessage, authApi } from "@/lib/api/auth";
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/lib/validations/auth";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { identifier: "" },
  });

  const onSubmit = async ({ identifier }: ForgotPasswordValues) => {
    setPending(true);
    try {
      await authApi.forgotPassword(identifier);
      toast.success("If the account exists, a code has been sent");
      router.push(`/verify-otp?identifier=${encodeURIComponent(identifier)}`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="font-semibold">Reset your password</h2>
          <p className="text-sm text-muted-foreground">
            We&apos;ll send a 6-digit code to your email or phone.
          </p>
        </div>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="identifier">Email or phone</Label>
            <Input id="identifier" {...form.register("identifier")} />
            {form.formState.errors.identifier ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.identifier.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Spinner className="mr-1 size-4" /> : null}
            Send code
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
