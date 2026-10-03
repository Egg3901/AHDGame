"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";

/**
 * Layout-reserving skeleton shown while a dynamic() tab chunk loads: a heading
 * rule and table rows, the shape every tab now opens with. Reserves the
 * typical tab height so switching tabs doesn't collapse the page.
 */
export const TabFallback = () => (
  <div className="min-h-[480px] space-y-2">
    <div className="flex items-center justify-between border-b border-card-border pb-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-6 w-40" />
    </div>
    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
      <div key={i} className="flex justify-between border-b border-card-border/60 py-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
    ))}
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
export const IndustrialRelationsSection = dynamic(
  () => import("@/components/corporation/IndustrialRelationsSection"),
  { loading: () => null }
);
export const DefaultedBondCrisisModal = dynamic(
  () => import("@/components/corporation/DefaultedBondCrisisModal"),
  // Modal overlay — render nothing (not a tab skeleton) while the chunk loads.
  { loading: () => null }
);
