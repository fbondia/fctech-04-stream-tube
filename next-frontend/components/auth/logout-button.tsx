"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState(false);

  async function logout() {
    setIsPending(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      router.replace("/login");
      router.refresh();
    } catch {
      setError(true);
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" variant="outline" disabled={isPending} onClick={logout}>
        {isPending ? "Signing out…" : "Sign out"}
      </Button>
      {error && <p role="alert" className="text-caption text-destructive">Could not sign out. Please try again.</p>}
    </div>
  );
}
