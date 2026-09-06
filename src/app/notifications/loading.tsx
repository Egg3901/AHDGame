import { Skeleton } from "@/components/ui";
import { ListRowSkeleton } from "@/components/ui/loading-skeletons";

/**
 * /notifications renders the inbox two-pane layout (352px list + reading
 * pane). Matches InboxClient's grid so the panes do not jump on hydration.
 */
export default function NotificationsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="mb-6 mt-6 space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[352px_1fr]">
        <div className="min-h-[480px] space-y-3 rounded-xl border border-card-border bg-card p-6">
          {Array.from({ length: 7 }).map((_, i) => (
            <ListRowSkeleton key={i} withBadge />
          ))}
        </div>
        <div className="hidden min-h-[480px] space-y-4 rounded-xl border border-card-border bg-card p-6 lg:block">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3 w-32" />
          <div className="space-y-2 pt-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </div>
    </div>
  );
}
