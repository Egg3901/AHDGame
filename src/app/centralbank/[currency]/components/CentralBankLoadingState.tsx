import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import BackButton from "@/components/BackButton";
import { Skeleton } from "@/components/ui";

/**
 * Mirrors CentralBankClient's first paint: the header band with its photo,
 * title, prime rate and figures row, the tab row, then the overview's aside
 * and main column as plain sections.
 */
export function CentralBankLoadingState({ countryId }: { countryId: CountryId }) {
  const config = COUNTRY_CONFIGS[countryId];

  return (
    <div className="pb-16">
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        <BackButton
          fallbackLabel={`Back to ${config.name}`}
          fallbackHref={`/country/${countryId.toLowerCase()}`}
        />

        <header className="mb-8 mt-3 overflow-hidden rounded-xl border border-card-border bg-card">
          <Skeleton className="h-[110px] w-full rounded-none sm:h-[160px]" />
          <div className="flex flex-col gap-4 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-8 w-64 max-w-[80%]" />
              <Skeleton className="h-4 w-56 max-w-[70%]" />
              <Skeleton className="h-4 w-40 max-w-[60%]" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-card-border px-5 py-4 sm:grid-cols-3 sm:px-6">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-8 flex gap-4 border-b border-card-border pb-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-4 w-16" />
          ))}
        </div>

        <div className="grid min-w-0 gap-x-12 gap-y-12 lg:grid-cols-3">
          <div className="min-w-0 space-y-10 lg:col-span-1">
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>

          <div className="min-w-0 space-y-12 lg:col-span-2">
            <div className="space-y-3">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-48 w-full" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-7 w-44" />
              <Skeleton className="h-[240px] w-full" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
