import { Skeleton } from "@/components/ui";

export default function ProfileLoading() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8 overflow-x-hidden">
        {/* Profile Header card */}
        <div className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-card">
          {/* Accent line */}
          <Skeleton className="h-1.5 w-full rounded-none" />
          {/* Banner */}
          <Skeleton className="h-32 w-full sm:h-40 md:h-52 rounded-none bg-card-elevated" />
          {/* Overlap identity row */}
          <div className="-mt-12 sm:-mt-[4.5rem] md:-mt-20 lg:-mt-[5.5rem] relative z-10 px-4 pb-5 pt-0 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div className="flex min-w-0 flex-row items-end gap-3 sm:gap-6">
                {/* Avatar */}
                <Skeleton className="h-24 w-24 sm:h-36 sm:w-36 md:h-40 md:w-40 lg:h-44 lg:w-44 rounded-2xl shrink-0" />
                {/* Name + meta */}
                <div className="min-w-0 flex-1 pb-2 space-y-2">
                  <Skeleton className="h-7 w-40 sm:h-10 sm:w-64" />
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-32 sm:w-44" />
                </div>
              </div>
              {/* Right-side action buttons */}
              <div className="flex gap-2 pb-2 shrink-0">
                <Skeleton className="h-8 w-28 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
            </div>
            <div className="mt-5 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full max-w-2xl" />
              <Skeleton className="h-4 w-3/4 max-w-xl" />
              <Skeleton className="mt-3 h-10 w-full max-w-md rounded-lg" />
            </div>
          </div>
        </div>

        {/* Main 3-column grid */}
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Left column (2/3) — Political Standing + meters */}
          <div className="lg:col-span-2 space-y-8 min-w-0">
            <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6 shadow-card space-y-6">
              <Skeleton className="h-5 w-40" />
              {/* Progress meters */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                  <Skeleton className="h-2.5 w-full rounded-full" />
                  <Skeleton className="h-2.5 w-1/2 rounded-full" />
                </div>
              ))}
              {/* Stat chips grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-card-border p-3 space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-2.5 w-12" />
                  </div>
                ))}
              </div>
            </div>
            {/* Finances — separate from political standing */}
            <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6 shadow-card space-y-4">
              <Skeleton className="h-5 w-24" />
              <div className="rounded-lg border border-card-border p-4 flex flex-wrap gap-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1 min-w-[80px]">
                    <Skeleton className="h-2.5 w-14" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right column (1/3) — Policy + Career */}
          <div className="space-y-8 min-w-0">
            {/* Policy compass card */}
            <div className="rounded-xl border border-card-border bg-card p-5 shadow-card space-y-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="aspect-square w-full rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-lg border border-card-border p-3 space-y-1">
                    <Skeleton className="h-2.5 w-12" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            </div>

            {/* Social */}
            <div className="rounded-xl border border-card-border bg-card p-5 shadow-card space-y-3">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-36 rounded-lg" />
            </div>

            {/* Career history card */}
            <div className="rounded-xl border border-card-border bg-card p-5 shadow-card space-y-3">
              <Skeleton className="h-4 w-28" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 items-start">
                  <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-2.5 w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Achievements — full width */}
        <div className="rounded-xl border border-card-border bg-card p-6 shadow-card space-y-4">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
