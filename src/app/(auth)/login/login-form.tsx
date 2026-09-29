"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextField } from "@/components/form/text-field";
import { authClient } from "@/modules/auth/auth-client";
import { emailError } from "../validate";

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
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const rememberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const email = readRememberedEmail();
    if (!email || !emailRef.current || !rememberRef.current) return;
    emailRef.current.value = email;
    rememberRef.current.checked = true;
    passwordRef.current?.focus();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const rememberMe = form.get("rememberMe") === "on";
    const found = { email: emailError(email), password: password ? undefined : "Enter your password" };
    setErrors(found);
    setFormError(null);
    if (found.email || found.password) return;
    setPending(true);
    const { error } = await authClient.signIn.email({ email, password, rememberMe });
    if (error) {
      setPending(false);
      // One generic message; never reveal whether the email exists.
      setFormError(error.status === 429 ? "Too many attempts. Please wait a minute and try again." : "Email or password is incorrect.");
      return;
    }
    saveRememberedEmail(rememberMe ? email.toLowerCase() : null);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError && <FormAlert tone="error">{formError}</FormAlert>}
      <TextField id="email" label="Email address" type="email" autoComplete="email" name="email" ref={emailRef} error={errors.email} />
      <TextField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        name="password"
        ref={passwordRef}
        error={errors.password}
      />
      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-gray-600">
          <input type="checkbox" className="size-4 accent-brand-red" name="rememberMe" ref={rememberRef} />
          Keep me logged in
        </label>
        <Link href="/forgot-password" className="font-medium text-brand-red hover:underline">
          Forgot password?
        </Link>
      </div>
      <SubmitButton pending={pending} pendingLabel="Signing in...">
        Sign in
      </SubmitButton>
    </form>
  );
}
