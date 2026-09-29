"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { authClient } from "@/modules/auth/auth-client";

function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [pending, setPending] = useState(false);

  if (!token) return <FormAlert tone="error">This reset link is invalid or has expired. Request a new one.</FormAlert>;
  if (done) return <FormAlert tone="success">Your password was changed. You can now sign in.</FormAlert>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const found = {
      password: password.length < 12 ? "Use at least 12 characters" : password.length > 128 ? "Use at most 128 characters" : undefined,
      confirm: password === confirm ? undefined : "Passwords do not match",
    };
    setErrors(found);
    setFormError(null);
    if (found.password || found.confirm) return;
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (error) {
      setFormError("This reset link is invalid or has expired. Request a new one.");
      return;
    }
    setDone(true);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <TextField id="password" label="New password" type="password" autoComplete="new-password" name="password" error={errors.password} />
      <TextField id="confirm" label="Confirm new password" type="password" autoComplete="new-password" name="confirm" error={errors.confirm} />
      <SubmitButton pending={pending} pendingLabel="Saving...">
        Set new password
      </SubmitButton>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-brand-navy-900">Choose a new password</h1>
      <div className="mt-8 flex flex-col gap-5">
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
        <Link href="/login" className="text-center text-sm font-medium text-brand-red hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
