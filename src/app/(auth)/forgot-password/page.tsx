"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { authClient } from "@/modules/auth/auth-client";
import { emailError } from "../validate";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    const found = emailError(email);
    setError(found);
    if (found) return;
    setPending(true);
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    // Same confirmation whether or not the account exists.
    setSent(true);
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-brand-navy-900">Reset your password</h1>
      <p className="mt-2 text-sm text-gray-500">Enter your account email. We will send you a reset link.</p>
      <div className="mt-8 flex flex-col gap-5">
        {sent ? (
          <FormAlert tone="success">If an account exists for that email, a reset link is on its way. The link expires in 1 hour.</FormAlert>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
            <TextField id="email" label="Email address" type="email" autoComplete="email" name="email" error={error} />
            <SubmitButton pending={pending} pendingLabel="Sending...">
              Send reset link
            </SubmitButton>
          </form>
        )}
        <Link href="/login" className="text-center text-sm font-medium text-brand-red hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
