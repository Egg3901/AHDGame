import { Skeleton } from "@/components/ui";

/**
 * /world reads country access, game state and per-country metrics before the
 * first byte. Mirrors WorldClient: the title, the map, then the nations table
 * beside the column of links to the other world pages.
 */
export default function WorldLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="max-w-2xl space-y-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-4 w-full" />
      </div>

      <Skeleton className="mt-8 aspect-[800/460] w-full rounded-xl" />

      <div className="mt-12 grid gap-x-12 gap-y-12 xl:grid-cols-3">
        <section className="space-y-4 xl:col-span-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-2/3" />
          <div className="divide-y divide-card-border/60 border-t border-card-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="h-4 w-6 rounded-sm" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        </section>
        <div className="space-y-10">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
