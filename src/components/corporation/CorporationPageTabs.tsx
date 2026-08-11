"use client";

import dynamic from "next/dynamic";
import { Skeleton, CardSkeleton } from "@/components/ui";

/**
 * Layout-reserving skeleton shown while a dynamic() tab chunk loads.
 * Mirrors the overview tab's two-column card layout and reserves the
 * typical tab height so switching tabs doesn't collapse/expand the page.
 */
export const TabFallback = () => (
  <div className="min-h-[480px]">
    <div className="grid gap-6 lg:grid-cols-2">
      <CardSkeleton className="space-y-4">
        <Skeleton className="h-4 w-32" />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex justify-between py-2 border-b border-card-border last:border-0"
          >
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </CardSkeleton>
      <CardSkeleton className="space-y-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </CardSkeleton>
    </div>
  </div>
);

export const SectorsTab = dynamic(() => import("@/components/corporation/SectorsTab"), {
  loading: TabFallback,
});
export const SharesTab = dynamic(() => import("@/components/corporation/SharesTab"), {
  loading: TabFallback,
});
export const CreditRatingTab = dynamic(() => import("@/components/corporation/CreditRatingTab"), {
  loading: TabFallback,
});
export const BondsTab = dynamic(() => import("@/components/corporation/BondsTab"), {
  loading: TabFallback,
});
export const ChartsTab = dynamic(() => import("@/components/corporation/ChartsTab"), {
  loading: TabFallback,
});
export const SnapshotTab = dynamic(() => import("@/components/corporation/SnapshotTab"), {
  loading: TabFallback,
});
export const CeoOfficeTab = dynamic(() => import("@/components/corporation/CeoOfficeTab"), {
  loading: TabFallback,
});
export const OverviewTab = dynamic(() => import("@/components/corporation/OverviewTab"), {
  loading: TabFallback,
});
export const TechTab = dynamic(() => import("@/components/corporation/TechTab"), {
  loading: TabFallback,
});
export const CommoditiesTab = dynamic(() => import("@/components/corporation/CommoditiesTab"), {
  loading: TabFallback,
});
export const DealsTab = dynamic(() => import("@/components/corporation/DealsTab"), {
  loading: TabFallback,
});
export const CorporationContractsTab = dynamic(
  () => import("@/components/corporation/CorporationContractsTab"),
  { loading: TabFallback }
);
export const DefenceContractsTab = dynamic(
  () => import("@/components/corporation/DefenceContractsTab"),
  { loading: TabFallback }
);
export const SupplyAgreementsSection = dynamic(
  () => import("@/components/corporation/SupplyAgreementsSection"),
  { loading: () => null }
);
export const DefaultedBondCrisisModal = dynamic(
  () => import("@/components/corporation/DefaultedBondCrisisModal"),
  // Modal overlay — render nothing (not a tab skeleton) while the chunk loads.
  { loading: () => null }
);
