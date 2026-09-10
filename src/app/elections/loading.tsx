import { Skeleton } from "@/components/ui";
import { CardSkeleton } from "@/components/ui/loading-skeletons";

/**
 * /elections resolves the viewer's country and redirects to `/country/[code]/elections`.
 * This covers the round-trip before that redirect resolves.
 *
 * Kept deliberately plain: a detailed layout here would flash and then be
 * replaced by a different page, which reads as loading twice. The destination
 * wants its own `loading.tsx` for the render that actually takes time.
 */
export default function ElectionsLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <CardSkeleton className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </CardSkeleton>
    </div>
  );
}
