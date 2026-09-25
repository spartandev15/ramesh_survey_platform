"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { authClient } from "@/modules/auth/auth-client";

const schema = z
  .object({
    password: z.string().min(12, "Use at least 12 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

type Values = z.infer<typeof schema>;

function ResetPasswordForm() {
  const token = useSearchParams().get("token");
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });

  if (!token) return <FormAlert tone="error">This reset link is invalid or has expired. Request a new one.</FormAlert>;
  if (done) return <FormAlert tone="success">Your password was changed. You can now sign in.</FormAlert>;

  async function onSubmit({ password }: Values) {
    setFormError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    if (error) {
      setFormError("This reset link is invalid or has expired. Request a new one.");
      return;
    }
    setDone(true);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <TextField id="password" label="New password" type="password" autoComplete="new-password" error={errors.password?.message} {...register("password")} />
      <TextField id="confirm" label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm?.message} {...register("confirm")} />
      <SubmitButton pending={isSubmitting} pendingLabel="Saving...">
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
