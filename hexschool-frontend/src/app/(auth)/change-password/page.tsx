"use client";

import { Suspense, useState } from "react";
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
import { homePathFor } from "@/lib/constants/enums";
import { userUpdated } from "@/lib/store/auth-slice";
import { useAppDispatch, useAuth } from "@/lib/store/hooks";
import {
  changePasswordSchema,
  type ChangePasswordValues,
} from "@/lib/validations/auth";

function ChangePasswordForm() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { user } = useAuth();
  const forced = useSearchParams().get("forced") === "1";
  const [pending, setPending] = useState(false);

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: ChangePasswordValues) => {
    setPending(true);
    try {
      await authApi.changePassword(values.currentPassword, values.newPassword);
      dispatch(userUpdated({ mustChangePassword: false }));
      toast.success("Password changed");
      router.replace(user ? homePathFor(user.userType) : "/login");
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="font-semibold">
            {forced ? "Set a new password to continue" : "Change password"}
          </h2>
          {forced ? (
            <p className="text-sm text-muted-foreground">
              Your account uses a temporary password. Choose your own before
              continuing — other devices will be signed out.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Other devices will be signed out.
            </p>
          )}
        </div>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              {...form.register("currentPassword")}
            />
            {form.formState.errors.currentPassword ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.currentPassword.message}
              </p>
            ) : null}
          </div>
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
            <Label htmlFor="confirmPassword">Confirm new password</Label>
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
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense>
      <ChangePasswordForm />
    </Suspense>
  );
}
