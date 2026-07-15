"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/shared/spinner";
import { apiErrorMessage, authApi } from "@/lib/api/auth";
import { verifyOtpSchema, type VerifyOtpValues } from "@/lib/validations/auth";

const RESEND_COOLDOWN_S = 60;

function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const identifier = searchParams.get("identifier") ?? "";
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

  useEffect(() => {
    if (!identifier) router.replace("/forgot-password");
  }, [identifier, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const form = useForm<VerifyOtpValues>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: { code: "" },
  });

  const onSubmit = async ({ code }: VerifyOtpValues) => {
    setPending(true);
    try {
      const resetToken = await authApi.verifyOtp(identifier, code);
      // Short-lived (10 min) single-purpose token; sessionStorage keeps it
      // out of the URL/history.
      sessionStorage.setItem("hs_reset_token", resetToken);
      router.push("/reset-password");
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setPending(false);
    }
  };

  const resend = async () => {
    try {
      await authApi.forgotPassword(identifier);
      toast.success("A new code has been sent");
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="font-semibold">Enter the 6-digit code</h2>
          <p className="text-sm text-muted-foreground">
            Sent to <span className="font-medium">{identifier}</span> — valid
            for 5 minutes.
          </p>
        </div>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              id="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              className="text-center text-lg tracking-[0.5em]"
              {...form.register("code")}
            />
            {form.formState.errors.code ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.code.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Spinner className="mr-1 size-4" /> : null}
            Verify
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={cooldown > 0}
          onClick={() => void resend()}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense>
      <VerifyOtpForm />
    </Suspense>
  );
}
