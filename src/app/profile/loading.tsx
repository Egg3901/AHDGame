import { Skeleton } from "@/components/ui";
import {
  PROFILE_ASIDE_COLUMN_CLASS,
  PROFILE_CONTAINER_CLASS,
  PROFILE_GRID_CLASS,
  PROFILE_MAIN_COLUMN_CLASS,
} from "./components/profileStyles";

/** Section placeholder: a heading, then content rows. */
function SectionSkeleton({
  aside = false,
  rows,
  children,
}: {
  aside?: boolean;
  rows?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <Skeleton className={aside ? "h-5 w-28" : "h-7 w-48"} />
      {children ??
        Array.from({ length: rows ?? 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
    </div>
  );
}

export default function ProfileLoading() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background pb-16">
      {/* Header band: identity, then the view tabs on its bottom edge */}
      <div className="border-b border-card-border bg-card">
        <div className={`${PROFILE_CONTAINER_CLASS} pt-6 sm:pt-8`}>
          <div className="flex items-start gap-4 sm:gap-6">
            <Skeleton className="h-18 w-18 shrink-0 rounded-lg sm:h-24 sm:w-24" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-8 w-56 sm:h-10 sm:w-80" />
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-full max-w-xl" />
            </div>
          </div>
          <div className="mt-6 flex gap-6 pb-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-32" />
          </div>
        </div>
      </div>

      <div className={`${PROFILE_CONTAINER_CLASS} pt-8`}>
        <div className={PROFILE_GRID_CLASS}>
          {/* Main (2/3): standing, stats, finances, achievements */}
          <div className={PROFILE_MAIN_COLUMN_CLASS}>
            <SectionSkeleton rows={6} />
            <SectionSkeleton rows={4} />
            <SectionSkeleton>
              <div className="grid grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-28" />
                  </div>
                ))}
              </div>
            </SectionSkeleton>
            <SectionSkeleton>
              <div className="flex flex-wrap gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-20 rounded-md" />
                ))}
              </div>
            </SectionSkeleton>
          </div>

          {/* Aside (1/3): positions, social, career */}
          <div className={PROFILE_ASIDE_COLUMN_CLASS}>
            <SectionSkeleton aside>
              <Skeleton className="aspect-square w-full max-w-[320px] rounded-md" />
            </SectionSkeleton>
            <SectionSkeleton aside rows={1} />
            <SectionSkeleton aside rows={3} />
          </div>
        </div>
      </div>
    </div>
  );
}
