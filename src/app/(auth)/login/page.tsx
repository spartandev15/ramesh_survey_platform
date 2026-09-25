import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/access/principal";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <>
      <span className="text-xs font-semibold uppercase tracking-widest text-brand-red">Welcome back</span>
      <h1 className="mt-2 text-2xl font-semibold leading-tight text-brand-navy-900">Sign in with your credentials</h1>
      <p className="mt-2 text-sm text-gray-500">Enter your credentials to access your survey portal.</p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </>
  );
}
