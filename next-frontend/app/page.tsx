import { redirect } from "next/navigation";

import { BrandLogo } from "@/components/auth/brand-logo";
import { LogoutButton } from "@/components/auth/logout-button";
import { Card } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await getSession();
  if (!session.isLoggedIn) redirect("/login");

  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-[448px] items-center gap-6 px-6 py-10 text-center">
        <BrandLogo size="lg" />
        <h1 className="text-h1 text-foreground">Welcome to StreamTube</h1>
        <p className="text-body-md text-muted-foreground">
          Signed in as {session.email}. The video interface is coming in a later phase.
        </p>
        <LogoutButton />
      </Card>
    </main>
  );
}
