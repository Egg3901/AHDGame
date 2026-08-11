import { Skeleton } from "@/components/ui";
import { AdminTabsSkeleton } from "./components/AdminTabsSkeleton";

/**
 * Admin panel loading skeleton.
 * Header bar (mobile-only) + AdminTabs skeleton content area.
 */
export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header — hidden on lg+ where the sidebar carries the brand row */}
      <div className="border-b border-card-border bg-card shadow-sm lg:hidden">
        <div className="mx-auto max-w-7xl px-3 sm:px-6">
          <div className="flex items-center gap-3 py-3 sm:py-5">
            <Skeleton className="h-8 w-1 flex-shrink-0 rounded-full sm:h-10" />
            <div>
              <Skeleton className="h-5 w-28 sm:h-6 sm:w-36" />
              <Skeleton className="mt-1.5 hidden h-3 w-64 sm:block" />
            </div>
          </div>
        </div>
      </div>

      <AdminTabsSkeleton />
    </div>
  );
}
