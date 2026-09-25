"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { authClient } from "@/modules/auth/auth-client";

const schema = z.object({ email: z.email("Enter a valid email address") });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  async function onSubmit({ email }: Values) {
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
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
            <TextField id="email" label="Email address" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
            <SubmitButton pending={isSubmitting} pendingLabel="Sending...">
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
