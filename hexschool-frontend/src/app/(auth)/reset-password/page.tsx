"use client";

import { useEffect, useState } from "react";
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
  resetPasswordSchema,
  type ResetPasswordValues,
} from "@/lib/validations/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem("hs_reset_token")) {
      router.replace("/forgot-password");
    }
  }, [router]);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async ({ newPassword }: ResetPasswordValues) => {
    const resetToken = sessionStorage.getItem("hs_reset_token");
    if (!resetToken) {
      router.replace("/forgot-password");
      return;
    }
    setPending(true);
    try {
      await authApi.resetPassword(resetToken, newPassword);
      sessionStorage.removeItem("hs_reset_token");
      toast.success("Password updated — sign in with your new password");
      router.replace("/login");
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="font-semibold">Choose a new password</h2>
          <p className="text-sm text-muted-foreground">
            At least 8 characters with an uppercase letter, a lowercase
            letter, and a digit.
          </p>
        </div>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...form.register("newPassword")}
            />
            {form.formState.errors.newPassword ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.newPassword.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register("confirmPassword")}
            />
            {form.formState.errors.confirmPassword ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.confirmPassword.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Spinner className="mr-1 size-4" /> : null}
            Set new password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
