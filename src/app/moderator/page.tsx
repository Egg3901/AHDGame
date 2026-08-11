import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthModerator } from "@/lib/auth";
import { ModeratorTabs } from "@/components/ModeratorTabs";
import { ClockDriftBanner } from "@/components/admin/system/ClockDriftBanner";

export default async function ModeratorPanelPage() {
  const user = await getAuthModerator();

  if (!user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      <ClockDriftBanner panelHref="/moderator" panelLabel="moderator panel" />
      {/* Header */}
      <div className="border-b border-card-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-3 sm:px-6">
          <div className="flex items-center gap-3 py-3 sm:py-5">
            <div className="h-8 w-1 flex-shrink-0 rounded-full bg-info sm:h-10" />
            <div>
              <h1 className="text-base font-bold sm:text-lg">Moderator Panel</h1>
              <p className="mt-0.5 hidden text-xs text-muted sm:block">
                Player management &middot; Transaction review &middot; Content moderation
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabbed content */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-info border-t-transparent" />
          </div>
        }
      >
        <ModeratorTabs />
      </Suspense>
    </div>
  );
}
