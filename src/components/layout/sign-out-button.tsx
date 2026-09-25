"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { authClient } from "@/modules/auth/auth-client";

export function SignOutButton({ className, role }: { className?: string; role?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role={role}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await authClient.signOut();
          router.replace("/login");
          router.refresh();
        })
      }
      className={className}
    >
      <LogOut aria-hidden="true" className="size-4" />
      {pending ? "Logging out..." : "Log out"}
    </button>
  );
}
