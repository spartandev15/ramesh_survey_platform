import type { Metadata } from "next";
import { SignOutButton } from "@/components/layout/sign-out-button";

export const metadata: Metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl bg-brand-navy-900 p-8 text-center text-white">
        <h1 className="text-xl font-semibold">Your account has no workspace yet</h1>
        <p className="mt-2 text-sm text-white/75">Ask a PSG administrator to add you to a shop or grant you a PSG role.</p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
