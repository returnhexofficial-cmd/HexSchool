"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
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
import { sessionEstablished } from "@/lib/store/auth-slice";
import { useAppDispatch } from "@/lib/store/hooks";
import { loginSchema, type LoginValues } from "@/lib/validations/auth";

function LoginForm() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "", rememberMe: false },
  });

  const onSubmit = async (values: LoginValues) => {
    setPending(true);
    try {
      const user = await authApi.login(values);
      dispatch(sessionEstablished(user));
      if (user.mustChangePassword) {
        router.replace("/change-password?forced=1");
        return;
      }
      const next = searchParams.get("next");
      router.replace(
        next && next.startsWith("/") ? next : homePathFor(user.userType),
      );
    } catch (err) {
      // Backend is deliberately generic (never reveals which field failed).
      toast.error(apiErrorMessage(err));
      setPending(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="identifier">Email or phone</Label>
            <Input
              id="identifier"
              autoComplete="username"
              placeholder="admin@school.edu.bd or 01XXXXXXXXX"
              {...form.register("identifier")}
            />
            {form.formState.errors.identifier ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.identifier.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
            />
            {form.formState.errors.password ? (
              <p className="text-sm text-destructive">
                {form.formState.errors.password.message}
              </p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              {...form.register("rememberMe")}
            />
            Keep me signed in for 30 days
          </label>

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Spinner className="mr-1 size-4" /> : null}
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
