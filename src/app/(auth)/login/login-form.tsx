"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { authClient } from "@/modules/auth/auth-client";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  rememberMe: z.boolean(),
});

type Values = z.infer<typeof schema>;

// Only the email is remembered on this device, never the password.
const REMEMBERED_EMAIL_KEY = "psg.rememberedEmail";

function readRememberedEmail(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
  } catch {
    return null;
  }
}

function saveRememberedEmail(email: string | null) {
  try {
    if (email) window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    else window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // Storage blocked (private window, site data disabled): sign-in still works.
  }
}

export function LoginForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "", rememberMe: false } });

  useEffect(() => {
    const email = readRememberedEmail();
    if (!email) return;
    setValue("email", email);
    setValue("rememberMe", true);
    setFocus("password");
  }, [setValue, setFocus]);

  async function onSubmit(values: Values) {
    setFormError(null);
    const { error } = await authClient.signIn.email(values);
    if (error) {
      // One generic message; never reveal whether the email exists.
      setFormError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Email or password is incorrect.");
      return;
    }
    saveRememberedEmail(values.rememberMe ? values.email.trim().toLowerCase() : null);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <TextField id="email" label="Email address" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
      <TextField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-gray-600">
          <input type="checkbox" className="size-4 accent-brand-red" {...register("rememberMe")} />
          Keep me logged in
        </label>
        <Link href="/forgot-password" className="font-medium text-brand-red hover:underline">
          Forgot password?
        </Link>
      </div>
      <SubmitButton pending={isSubmitting} pendingLabel="Signing in...">
        Sign in
      </SubmitButton>
    </form>
  );
}
