import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthAdmin } from "@/lib/auth";
import { AdminTabs } from "@/components/AdminTabs";
import { AdminTabsSkeleton } from "./components/AdminTabsSkeleton";

export default async function AdminPanelPage() {
  const user = await getAuthAdmin();

  if (!user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Cron auto-pause now surfaces via the AdminAlertsStrip inside AdminTabs. */}
      {/* No separate mobile header: below lg the sticky AdminMobileNav
          breadcrumb bar carries the brand row; on lg+ the sidebar does. */}
      <Suspense fallback={<AdminTabsSkeleton />}>
        <AdminTabs />
      </Suspense>
    </div>
  );
}
