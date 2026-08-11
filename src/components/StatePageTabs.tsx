"use client";

import dynamic from "next/dynamic";
import { RegionTabNav, type SuperTabId } from "./state/RegionTabNav";
import type { StatePageTabsProps } from "./state/StatePageTabsTypes";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { partiesUrl } from "@/lib/urls";
import { makeUSPartyFlavor, compareUSParties } from "@/components/region/regionPartiesUSFlavor";
import { CardSkeleton, Skeleton, StatGridSkeleton } from "@/components/ui";

// Generic tab-chunk fallback: stat grid + content card silhouette, sized to
// roughly the shortest loaded tab so the page doesn't collapse then jump.
const TabFallback = () => (
  <div className="min-h-[24rem] space-y-4">
    <StatGridSkeleton cols={2} count={4} />
    <CardSkeleton>
      <Skeleton className="h-5 w-48 mb-4" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </CardSkeleton>
  </div>
);

const OverviewTab = dynamic(
  () => import("./state/StatePageTabsOverview").then((m) => ({ default: m.OverviewTab })),
  { loading: TabFallback }
);
const StateMetricsTab = dynamic(
  () => import("@/components/StateMetricsTab").then((m) => ({ default: m.StateMetricsTab })),
  { loading: TabFallback }
);
const PoliticsTab = dynamic(
  () => import("./state/StatePageTabsPolitics").then((m) => ({ default: m.PoliticsTab })),
  { loading: TabFallback }
);
const DemographicsAndTurnoutTab = dynamic(
  () =>
    import("./state/StatePageTabsDemographicsAndTurnout").then((m) => ({
      default: m.DemographicsAndTurnoutTab,
    })),
  { loading: TabFallback }
);
const LawsTab = dynamic(
  () => import("./state/StatePageTabsLaws").then((m) => ({ default: m.LawsTab })),
  { loading: TabFallback }
);
const PartiesTab = dynamic(
  () => import("./region/RegionPartiesTab").then((m) => ({ default: m.RegionPartiesTab })),
  { loading: TabFallback }
);
const AdminTab = dynamic(
  () => import("./state/StatePageTabsAdmin").then((m) => ({ default: m.AdminTab })),
  { loading: TabFallback }
);
const StateBudgetSection = dynamic(
  () => import("./budget/StateBudgetSection").then((m) => ({ default: m.StateBudgetSection })),
  { loading: TabFallback }
);
const StateElections = dynamic(
  () => import("@/components/StateElections").then((m) => ({ default: m.StateElections })),
  { loading: TabFallback }
);
const StateEconomy = dynamic(
  () => import("./state/StateEconomy").then((m) => ({ default: m.StateEconomy })),
  { loading: TabFallback }
);
const ResourcesTab = dynamic(
  () => import("./state/StatePageTabsResources").then((m) => ({ default: m.ResourcesTab })),
  { loading: TabFallback }
);

export function StatePageTabs({
  state,
  officials,
  players,
  npps,
  demographics,
  categories,
  censusData,
  calculatedLeans,
  partyOrg,
  turnoutData,
  isAdmin = false,
  overview,
  viewerPartyId,
  partyBudgetsByPartyId,
  regLedger,
  regionalConditionsOverviewEnabled = false,
  approvalModifiersForOverview = [],
  regionGovernmentApproval = null,
  regionApprovalBase = null,
  regionParties = [],
  bucketProfile = null,
}: StatePageTabsProps) {
  const renderContent = (superTab: SuperTabId, subTab: string) => {
    // ── Overview ──
    if (superTab === "overview") {
      return overview ? (
        <OverviewTab
          overview={overview}
          viewerPartyId={viewerPartyId ?? null}
          regionalConditionsOverviewEnabled={regionalConditionsOverviewEnabled}
          approvalModifiersForOverview={approvalModifiersForOverview}
          regionGovernmentApproval={regionGovernmentApproval}
          regionApprovalBase={regionApprovalBase}
        />
      ) : (
        <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
          Overview data not yet available for this region. Try the Politics or Economy tab in the
          meantime.
        </div>
      );
    }

    // ── Politics ──
    if (superTab === "politics") {
      if (subTab === "officials" || subTab === "") {
        return (
          <PoliticsTab
            state={state}
            officials={officials}
            players={players}
            npps={npps}
            calculatedLeans={calculatedLeans}
            partyOrg={partyOrg}
            regionalExecutive={overview?.regionalExecutive ?? null}
            viewerPartyId={viewerPartyId ?? null}
            partyBudgetsByPartyId={partyBudgetsByPartyId}
            regLedger={regLedger}
            isAdmin={isAdmin}
          />
        );
      }
      if (subTab === "parties") {
        const stateCountryId = state.countryId as CountryId;
        const regionNoun = COUNTRY_CONFIGS[stateCountryId]?.regionLabel.toLowerCase() ?? "region";
        const sharedConfig = {
          regionNoun,
          emptyStateLink: {
            href: partiesUrl(state.countryId.toLowerCase()),
            label: "Browse all parties →",
          },
        };
        return (
          <PartiesTab
            countryId={stateCountryId}
            regionId={state._id}
            regionName={state.name}
            partyOrg={partyOrg}
            config={
              stateCountryId === "US"
                ? {
                    ...sharedConfig,
                    headingLabel: `State Party Organizations in ${state.name}`,
                    description:
                      "infrastructure, volunteers, and ground-game capacity. Org decays each turn; spend Political Strength on Build Org to raise it.",
                    partyFlavor: makeUSPartyFlavor(state),
                    sortComparator: compareUSParties,
                    emptyStateHint: "Party organization data will appear here once configured.",
                  }
                : sharedConfig
            }
          />
        );
      }
      if (subTab === "elections") {
        return (
          <StateElections stateId={state._id} stateName={state.name} countryId={state.countryId} />
        );
      }
    }

    // ── Economy ──
    if (superTab === "economy") {
      if (subTab === "sectors" || subTab === "") {
        return <StateEconomy stateId={state._id} countryId={state.countryId} />;
      }
      if (subTab === "budget") {
        return (
          <StateBudgetSection
            stateId={state._id}
            countryId={state.countryId}
            regionCode={state._id}
          />
        );
      }
      if (subTab === "resources") {
        return <ResourcesTab stateId={state._id} countryId={state.countryId} isAdmin={isAdmin} />;
      }
    }

    // ── Demographics ──
    if (superTab === "demographics") {
      if (subTab === "demographics" || subTab === "") {
        return (
          <DemographicsAndTurnoutTab
            stateId={state._id}
            demographics={demographics}
            categories={categories}
            censusData={censusData}
            turnoutData={turnoutData ?? null}
            countryId={state.countryId}
            regionParties={regionParties}
            bucketProfile={bucketProfile}
          />
        );
      }
      if (subTab === "metrics") {
        return <StateMetricsTab stateId={state._id} countryId={state.countryId} />;
      }
    }

    // ── Governance ──
    if (superTab === "governance") {
      if (subTab === "laws" || subTab === "") {
        return <LawsTab state={state} />;
      }
      if (subTab === "admin" && isAdmin) {
        return <AdminTab state={state} players={players} npps={npps} />;
      }
    }

    return null;
  };

  return <RegionTabNav isAdmin={isAdmin} renderContent={renderContent} />;
}
