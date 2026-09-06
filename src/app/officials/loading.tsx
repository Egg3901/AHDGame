import { Skeleton } from "@/components/ui";
import { CardSkeleton, ListRowSkeleton } from "@/components/ui/loading-skeletons";

/**
 * /officials loads elected officials and the three vacancy sets server-side
 * before returning any bytes. Mirrors the page's header + VacanciesPanel.
 */
export default function OfficialsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="space-y-6">
        {[1, 2, 3].map((section) => (
          <CardSkeleton key={section} className="space-y-4">
            <Skeleton className="h-5 w-40" />
            {[1, 2, 3].map((row) => (
              <ListRowSkeleton key={row} withBadge />
            ))}
          </CardSkeleton>
        ))}
      </div>
    </div>
  );
}
