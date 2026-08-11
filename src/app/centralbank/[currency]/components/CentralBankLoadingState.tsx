import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import BackButton from "@/components/BackButton";
import { Skeleton } from "@/components/ui";

export function CentralBankLoadingState({ countryId }: { countryId: CountryId }) {
  const config = COUNTRY_CONFIGS[countryId];

  return (
    <div className="pb-16">
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <BackButton
          fallbackLabel={`Back to ${config.name}`}
          fallbackHref={`/country/${countryId.toLowerCase()}`}
        />

        <header className="relative mt-3 mb-8 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <Skeleton className="absolute inset-0 rounded-none bg-card-elevated" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/10 to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end px-5 pb-4 sm:px-6 sm:pb-5">
              <Skeleton className="h-7 w-52 max-w-[75%] bg-white/15 sm:h-8" />
              <Skeleton className="mt-2 h-4 w-36 max-w-[55%] bg-white/10 sm:h-5" />
            </div>
          </div>

          <div className="flex items-center overflow-x-auto min-w-0 divide-x divide-card-border border-t border-card-border">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex min-w-[120px] shrink-0 flex-col px-5 py-3">
                <Skeleton className="h-3 w-20 bg-card-elevated" />
                <Skeleton className="mt-2 h-5 w-16 bg-card-elevated" />
              </div>
            ))}
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid min-w-0 gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-1">
            <div className="rounded-xl border border-card-border bg-card p-5">
              <Skeleton className="h-3 w-24 bg-card-elevated" />
              <div className="mt-4 flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-lg bg-card-elevated" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32 bg-card-elevated" />
                  <Skeleton className="h-3 w-24 bg-card-elevated" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Skeleton className="h-3 w-40 bg-card-elevated" />
                <Skeleton className="h-2 w-full rounded-full bg-card-elevated" />
              </div>
            </div>

            <div className="rounded-xl border border-card-border bg-card p-5">
              <Skeleton className="h-3 w-28 bg-card-elevated" />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Skeleton className="h-16 rounded-xl bg-card-elevated" />
                <Skeleton className="h-16 rounded-xl bg-card-elevated" />
              </div>
              <Skeleton className="mt-4 h-24 rounded-xl bg-card-elevated" />
            </div>
          </div>

          <div className="min-w-0 space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-card-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-40 bg-card-elevated" />
                <Skeleton className="h-8 w-28 rounded-lg bg-card-elevated" />
              </div>
              <Skeleton className="mt-4 h-[280px] w-full rounded-xl bg-card-elevated" />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-5">
                <Skeleton className="h-5 w-36 bg-card-elevated" />
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 rounded-xl bg-card-elevated" />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-card-border bg-card p-5">
                <Skeleton className="h-5 w-32 bg-card-elevated" />
                <div className="mt-4 space-y-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 rounded-xl bg-card-elevated" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
