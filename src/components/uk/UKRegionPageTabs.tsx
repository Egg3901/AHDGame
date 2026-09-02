"use client";

import { RegionTabNav, type SuperTabId } from "@/components/state/RegionTabNav";
import { UKRegionPageTabsPolitics } from "./UKRegionPageTabsPolitics";
import { RegionPartiesTab } from "@/components/region/RegionPartiesTab";
import { countryUrl } from "@/lib/urls";
import { UKRegionPageTabsMetrics } from "./UKRegionPageTabsMetrics";
import { RegionRegistryTab } from "@/components/state/RegionRegistryTab";
import { DemographicsAndTurnoutTab } from "@/components/state/StatePageTabsDemographicsAndTurnout";
import { StateElections } from "@/components/StateElections";
import { StateEconomy } from "@/components/state/StateEconomy";
import { ResourcesTab } from "@/components/state/StatePageTabsResources";
import { StateBudgetSection } from "@/components/budget/StateBudgetSection";
import { LawsTab } from "@/components/state/StatePageTabsLaws";
import { AdminTab } from "@/components/state/StatePageTabsAdmin";
import { RegionReferendumCampaign } from "./RegionReferendumCampaign";
import { OverviewTab } from "@/components/state/StatePageTabsOverview";
import type { StateOverviewResult } from "@/lib/states/overview/types";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import type { UKRegion } from "@/lib/constants/uk";
import type { State, StateDemographics, DemographicCategory } from "@/lib/db/types";
import type {
  PartyOrgDisplay,
  SerializedPlayer,
  NPPDisplaySimple,
} from "@/components/state/StatePageTabsTypes";
import type { RegionCensus } from "@/lib/seeds/regionCensusData";
import type { SerializedMP } from "@/app/uk/region/[regionId]/UKRegionClient";
import type { BucketProfileSection } from "@/lib/demographics/bucketProfile";

interface UKRegionPageTabsProps {
  region: UKRegion;
  state:
    | (Pick<
        State,
        | "_id"
        | "name"
        | "population"
        | "gdp"
        | "houseDistricts"
        | "cachedEconomicLean"
        | "cachedSocialLean"
      > & {
        population: number;
        gdp: number;
        houseDistricts: number;
      })
    | null;
  demographics: (Omit<StateDemographics, "lastUpdated"> & { lastUpdated: string | null }) | null;
  categories: DemographicCategory[];
  censusData: RegionCensus | null;
  partyOrg: PartyOrgDisplay[];
  calculatedLeans: { economicLean: number; socialLean: number } | null;
  turnoutData?: {
    stateId: string;
    /** census dimension → bucket → cell (see `buildRegionTurnoutResponse`). */
    turnout: Record<string, Record<string, { baseline: number; modifier: number; actual: number }>>;
    lastUpdated: string | null;
    lastDecayApplied: string | null;
  } | null;
  /** Per-bucket electorate profile for the Demographics tab (server-derived). */
  bucketProfile?: BucketProfileSection[] | null;
  mps?: SerializedMP[];
  players?: SerializedPlayer[];
  npps?: NPPDisplaySimple[];
  isAdmin?: boolean;
  overview?: StateOverviewResult;
  viewerPartyId?: string | null;
  regionalConditionsOverviewEnabled?: boolean;
  approvalModifiersForOverview?: ActiveModifier[];
  regionGovernmentApproval?: number | null;
  regionApprovalBase?: number | null;
}

export function UKRegionPageTabs({
  region,
  state,
  demographics,
  categories,
  censusData,
  partyOrg,
  calculatedLeans,
  turnoutData,
  bucketProfile = null,
  mps = [],
  players = [],
  npps = [],
  isAdmin = false,
  overview,
  viewerPartyId,
  regionalConditionsOverviewEnabled = false,
  approvalModifiersForOverview = [],
  regionGovernmentApproval = null,
  regionApprovalBase = null,
}: UKRegionPageTabsProps) {
  const stateForTabs = state
    ? {
        _id: state._id,
        name: state.name,
        countryId: "UK" as const,
        population: state.population,
        gdp: state.gdp,
        houseDistricts: state.houseDistricts,
        cachedEconomicLean: state.cachedEconomicLean,
        cachedSocialLean: state.cachedSocialLean,
      }
    : null;

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
          <UKRegionPageTabsPolitics
            region={region}
            state={stateForTabs}
            partyOrg={partyOrg}
            calculatedLeans={calculatedLeans}
            mps={mps}
            players={players}
            npps={npps}
          />
        );
      }
      if (subTab === "parties") {
        return (
          <RegionPartiesTab
            countryId="UK"
            regionId={region.id}
            regionName={region.name}
            partyOrg={partyOrg}
            config={{
              description:
                "Party organization reflects each party's share of the regional Org pool. Org decays passively each turn; spend Political Strength on Build Org to push it back up.",
              emptyStateHint:
                "Party organization data will appear when the UK simulation is fully active.",
              emptyStateLink: { href: countryUrl("UK"), label: "Browse UK overview →" },
            }}
          />
        );
      }
      if (subTab === "elections") {
        return (
          <StateElections
            stateId={stateForTabs?._id ?? region.id}
            stateName={stateForTabs?.name ?? region.name}
            countryId="UK"
          />
        );
      }
    }

    // ── Economy ──
    if (superTab === "economy") {
      if (subTab === "sectors" || subTab === "") {
        return <StateEconomy stateId={stateForTabs?._id ?? region.id} countryId="UK" />;
      }
      if (subTab === "budget") {
        return (
          <StateBudgetSection
            stateId={stateForTabs?._id ?? region.id}
            countryId="UK"
            regionCode={stateForTabs?._id ?? region.id}
          />
        );
      }
      if (subTab === "resources") {
        return (
          <ResourcesTab stateId={stateForTabs?._id ?? region.id} countryId="UK" isAdmin={isAdmin} />
        );
      }
    }

    // ── Metrics ──
    // Same registry the other region pages get. UK is one of the four board
    // countries, so leaving it behind would be exactly the inconsistency the
    // promotion set out to remove.
    if (superTab === "metrics") {
      return (
        <RegionRegistryTab
          countryId="UK"
          regionId={stateForTabs?._id ?? region.id}
          regionName={stateForTabs?.name ?? region.name}
        />
      );
    }

    // ── Demographics ──
    if (superTab === "demographics") {
      if (subTab === "demographics" || subTab === "") {
        return (
          <DemographicsAndTurnoutTab
            stateId={region.id}
            demographics={demographics}
            categories={categories}
            censusData={censusData}
            turnoutData={turnoutData ?? null}
            countryId="UK"
            bucketProfile={bucketProfile}
          />
        );
      }
      // The legacy stateMetrics boards, renamed Statistics.
      if (subTab === "statistics") {
        return <UKRegionPageTabsMetrics regionId={region.id} />;
      }
    }

    // ── Governance ──
    if (superTab === "governance") {
      if (subTab === "laws" || subTab === "") {
        return stateForTabs ? <LawsTab state={stateForTabs as State} /> : null;
      }
      if (subTab === "admin" && isAdmin) {
        return stateForTabs ? (
          <AdminTab state={stateForTabs as State} players={players} npps={npps} />
        ) : null;
      }
    }

    return null;
  };

  return (
    <RegionTabNav
      isAdmin={isAdmin}
      renderContent={renderContent}
      preTabContent={
        <RegionReferendumCampaign countryId="UK" regionId={stateForTabs?._id ?? region.id} />
      }
    />
  );
}
