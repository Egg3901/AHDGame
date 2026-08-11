"use client";
import type { BucketProfileSection } from "@/lib/demographics/bucketProfile";
import Image from "next/image";
import Link from "next/link";
import { PositionBadges } from "@/components/PositionBadges";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { getUKRegionImage, type UKRegion, type UKNation } from "@/lib/constants/uk";
import { formatPopulation, formatGDP } from "@/lib/utils/formatters";
import BackButton from "@/components/BackButton";
import { HeroImage } from "@/components/HeroImage";
import { RegionDropdown } from "@/components/RegionDropdown";
import { RelocateButton } from "@/components/RelocateButton";
import { UKRegionPageTabs } from "@/components/uk/UKRegionPageTabs";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import { regionUrl, regionApprovalUrl } from "@/lib/urls";
import type { State, StateDemographics, DemographicCategory } from "@/lib/db/types";
import type {
  PartyOrgDisplay,
  SerializedPlayer,
  NPPDisplaySimple,
  TurnoutResponse,
} from "@/components/state/StatePageTabsTypes";
import type { RegionCensus } from "@/lib/seeds/regionCensusData";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { getCountryFlagUrl } from "@/lib/constants";
import type { StateOverviewResult } from "@/lib/states/overview/types";

export interface SerializedMP {
  _id: string;
  characterId: string | null;
  nppId: string | null;
  sequentialId?: number | null;
  characterName?: string;
  party?: string;
  partyAbbreviation?: string;
  partyColor?: string;
  avatarUrl?: string;
  isNPP: boolean;
  seatsHeld?: number;
  officeType?: string;
}

interface UKRegionClientProps {
  region: UKRegion;
  nation: UKNation | null;
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
  governmentApproval: number | null;
  approvalBase?: number | null;
  approvalModifiers?: ActiveModifier[];
  turnoutData?: TurnoutResponse | null;
  /** Per-bucket electorate profile for the Demographics tab (server-derived). */
  bucketProfile?: BucketProfileSection[] | null;
  userHomeState?: string | null;
  userCountryId?: string | null;
  currentParty?: {
    id: string;
    name: string;
    countryId: string;
  } | null;
  isAdmin?: boolean;
  mps?: SerializedMP[];
  players?: SerializedPlayer[];
  npps?: NPPDisplaySimple[];
  overview?: StateOverviewResult;
  viewerPartyId?: string | null;
  /**
   * Devolved executive (First Minister for SCO/WAL/NIR, Mayor of London
   * for LON). Null for English non-London regions or when the seat is
   * vacant. Surfaced as a chip in the hero stats strip.
   */
  executive?: {
    _id: string;
    characterId: string | null;
    characterName: string | null;
    nppId: string | null;
  } | null;
  /** Display label for the executive ("First Minister" / "Mayor of London"). */
  executiveLabel?: string | null;
  /**
   * Whether the viewer may reach the executive's Office page — the holder OR an
   * authorized party officer of an NPP-held office. Gates the "Office →" link.
   */
  canManageOffice?: boolean;
  regionalConditionsOverviewEnabled?: boolean;
  approvalModifiersForOverview?: ActiveModifier[];
}

const NATION_COLORS: Record<string, string> = {
  ENG: "#4f7ac7",
  SCO: "#1a5fa8",
  WAL: "#2a7c3e",
  NIR: "#7a4ba8",
};

export default function UKRegionClient({
  region,
  nation,
  state,
  demographics,
  categories,
  censusData,
  partyOrg,
  calculatedLeans,
  governmentApproval,
  approvalBase,
  approvalModifiers = [],
  turnoutData,
  bucketProfile = null,
  userHomeState,
  userCountryId,
  currentParty,
  isAdmin = false,
  mps = [],
  players = [],
  npps = [],
  overview,
  viewerPartyId,
  executive,
  executiveLabel,
  canManageOffice = false,
  regionalConditionsOverviewEnabled = false,
  approvalModifiersForOverview = [],
}: UKRegionClientProps) {
  const _nationColor = NATION_COLORS[region.nationId] ?? "#4f7ac7";

  const population = state?.population ?? nation?.population ?? 0;
  const gdp = state?.gdp ?? 0;
  const constituencies = region.constituencies;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl min-w-0 overflow-x-hidden px-6 sm:px-8 lg:px-12 py-12 sm:py-16 space-y-12">
        {/* Hero header with title overlay and stats strip */}
        <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          {/* Hero image section */}
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              src={getUKRegionImage(region.id)}
              alt={region.name}
              fill
              className="object-cover object-center"
              sizes="(max-width: 1280px) 100vw, 1280px"
              priority
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
              <div className="flex items-center justify-between gap-2">
                <BackButton iconOnly />
                <div className="flex items-center gap-2">
                  <RelocateButton
                    targetStateId={state?._id ?? region.id}
                    targetName={region.name}
                    userHomeState={userHomeState}
                    userCountryId={userCountryId}
                    targetCountryId="UK"
                    redirectPath={regionUrl("UK", region.id)}
                  />
                  <RegionDropdown
                    regionId={region.id}
                    regionName={region.name}
                    regionCountryId="UK"
                    nationId={region.nationId}
                    currentParty={currentParty}
                  />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-white/80 drop-shadow italic mb-1">
                  United Kingdom · {nation?.name ?? region.nationId}
                </p>
                <div className="flex items-center gap-2">
                  <Image
                    src={getCountryFlagUrl("GB")}
                    alt="UK Flag"
                    width={48}
                    height={32}
                    className="h-8 w-12 sm:h-10 sm:w-15 object-cover rounded shadow-sm"
                    unoptimized={bypassNextImageOptimization(getCountryFlagUrl("GB"))}
                  />
                  <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl lg:text-4xl leading-tight">
                    {region.name}
                  </h1>
                </div>
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Population
              </span>
              <span className="text-base font-bold tabular-nums">
                {formatPopulation(population)}
              </span>
            </div>
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                GDP
              </span>
              <span className="text-base font-bold tabular-nums">
                {gdp > 0 ? formatGDP(gdp, "£") : "—"}
              </span>
            </div>
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Constituencies
              </span>
              <span className="text-base font-bold tabular-nums">{constituencies}</span>
            </div>
            {calculatedLeans && (
              <div className="flex flex-col px-5 py-3 min-w-max gap-1">
                <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                  Political Lean
                </span>
                <PositionBadges
                  economic={calculatedLeans.economicLean}
                  social={calculatedLeans.socialLean}
                  mode="lean"
                  align="items-start"
                />
              </div>
            )}
            <div className="flex flex-col px-5 py-3 min-w-max">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Government Approval
              </span>
              <span className="text-base font-bold tabular-nums">
                {governmentApproval != null ? (
                  <span
                    className={
                      governmentApproval >= 50
                        ? "text-success"
                        : governmentApproval >= 40
                          ? "text-warning"
                          : "text-error"
                    }
                  >
                    <ApprovalTooltip
                      approval={governmentApproval}
                      baseApproval={approvalBase ?? governmentApproval}
                      modifiers={approvalModifiers}
                      href={regionApprovalUrl("UK", region.id)}
                    />
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
            </div>
            {executiveLabel && (
              <div className="flex flex-col px-5 py-3 min-w-max">
                <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                  {executiveLabel}
                </span>
                <span className="text-base font-bold tabular-nums mt-0.5 flex items-center gap-2">
                  {executive && (executive.characterId || executive.nppId)
                    ? (executive.characterName ?? "Unknown")
                    : "Vacant"}
                  {(canManageOffice || isAdmin) && (
                    <Link
                      href={`/country/uk/region/${region.id.toLowerCase()}/office`}
                      className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/25 transition-colors"
                    >
                      Office →
                    </Link>
                  )}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Tabbed Content */}
        <UKRegionPageTabs
          region={region}
          state={state}
          demographics={demographics}
          categories={categories}
          censusData={censusData}
          partyOrg={partyOrg}
          calculatedLeans={calculatedLeans}
          turnoutData={turnoutData}
          bucketProfile={bucketProfile}
          mps={mps}
          players={players}
          npps={npps}
          isAdmin={isAdmin}
          overview={overview}
          viewerPartyId={viewerPartyId ?? null}
          regionalConditionsOverviewEnabled={regionalConditionsOverviewEnabled}
          approvalModifiersForOverview={approvalModifiersForOverview}
          regionGovernmentApproval={governmentApproval}
          regionApprovalBase={approvalBase}
        />
      </main>
    </div>
  );
}
