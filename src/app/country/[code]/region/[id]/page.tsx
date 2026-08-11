import { type Metadata } from "next";
import { Suspense } from "react";
import { RegionPageSkeleton, RegionTabsSkeleton } from "./RegionPageSkeleton";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import Image from "next/image";
import Link from "next/link";
import type { State, PoliticalParty, GameState, GameConfig } from "@/lib/db/types";
import {
  canonicalRegionId,
  COUNTRY_CONFIGS,
  getCountryConfig,
  getRegionalBillAssentTitleForState,
  getRegionalExecutiveOfficeKey,
  type CountryId,
} from "@/lib/constants/countries";
import { UK_REGIONS, UK_NATIONS } from "@/lib/constants/uk";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { isOnboardingChecklistEnabled } from "@/lib/onboarding/featureFlag";
import { isOnboardingDismissed } from "@/lib/onboarding/checklist";
import { OnboardingStepTracker } from "@/components/onboarding/OnboardingStepTracker";
import { resolveOfficeAccess } from "@/lib/governorOffice/access";
import { calculateStateLean } from "@/lib/utils/demographics";
import { isRegionalConditionsOverviewEnabled } from "@/lib/states/conditions/featureFlag";
import { formatPopulation, formatGDP } from "@/lib/utils/formatters";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { regionUrl as buildRegionUrl, regionApprovalUrl } from "@/lib/urls";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import { PositionBadges } from "@/components/PositionBadges";
import { StatePageTabs } from "@/components/StatePageTabs";
import { getBucketProfileForRegion } from "@/lib/demographics/bucketProfile";
import { STATE_FLAGS, getStateDescriptor, STATE_MOTTOS } from "@/lib/constants";
import { IE_REGION_CONSTITUENT_COUNCILS } from "@/lib/constants/ireland";
import { resolveRegionBannerImage } from "@/lib/constants/regionBanner";
import BackButton from "@/components/BackButton";
import { HeroImage } from "@/components/HeroImage";
import { RelocateButton } from "@/components/RelocateButton";
import { RegionDropdown } from "@/components/RegionDropdown";
import UKRegionClient from "@/app/uk/region/[regionId]/UKRegionClient";
import { getStateOverview } from "@/lib/states/overview/getStateOverview";
import { getStateRegLedger } from "@/lib/states/overview/getStateRegLedger";
import { isSameCountry } from "@/lib/api/sameCountry";
import type { RegionPartyPosition } from "@/lib/demographics/preferredParty";
import {
  toIsoStringOrNull,
  getRegionState,
  getUserData,
  getCurrentPartyNav,
  getRegionDemographics,
  getRegionTurnout,
  getStatePartyBudgets,
  getRegionPartyOrg,
  getRegionGovernmentApproval,
  getRegionPlayers,
  getRegionNPPs,
  getRegionOfficials,
  serializePartyOrg,
} from "./regionData";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

interface Props {
  params: Promise<{ code: string; id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, id: rawRegionParam } = await params;
  const id = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return {};

  if (countryId === COUNTRY_CONFIGS.UK.id) {
    const region = UK_REGIONS.find((r) => r.id === id.toUpperCase());
    if (!region) return {};
    return {
      title: `${region.name} | United Kingdom | A House Divided`,
      description: `${region.name} — ${region.constituencies} Westminster constituencies`,
    };
  }

  const stateId = id;
  const db = await getDb();
  const state = await db
    .collection<State>("states")
    .findOne({ _id: stateId, countryId: countryId });
  if (!state) return {};
  const config = getCountryConfig(countryId);
  return {
    title: `${state.name} | ${config.name} | A House Divided`,
    description: `${state.name} — ${config.regionLabel}`,
  };
}

// ── UK rendering path ──

async function renderUKRegion(regionCode: string) {
  const region = UK_REGIONS.find((r) => r.id === regionCode);
  if (!region) notFound();

  const stateId = regionCode;
  // Parallelize all independent data fetching
  const db = await getDb();
  const [
    state,
    userData,
    officials,
    players,
    npps,
    demographicsData,
    partyOrg,
    approvalData,
    turnoutData,
    overview,
    ukGameState,
  ] = await Promise.all([
    getRegionState(stateId, "UK"),
    getAuthUserWithCharacter(),
    getRegionOfficials(stateId, "UK"),
    getRegionPlayers(stateId),
    getRegionNPPs(stateId, "UK"),
    getRegionDemographics(stateId, "UK"),
    getRegionPartyOrg(stateId, "UK"),
    getRegionGovernmentApproval(stateId, "UK"),
    getRegionTurnout(stateId, "UK"),
    getStateOverview(db, { countryId: "UK", stateId }),
    // Independent of every other query — batch it instead of a trailing RTT (O2).
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } }),
  ]);

  const { demographics, categories } = demographicsData;
  const governmentApproval = approvalData?.approval ?? null;
  const approvalBase = approvalData?.baseApproval ?? null;
  const approvalModifiers = approvalData?.modifiers ?? [];

  const nation = UK_NATIONS.find((n) => n.id === region.nationId) ?? null;

  let calculatedLeans =
    state?.cachedEconomicLean != null && state.cachedSocialLean != null
      ? {
          economicLean: state.cachedEconomicLean,
          socialLean: state.cachedSocialLean,
        }
      : demographics
        ? calculateStateLean(demographics, categories)
        : null;
  const isZeroed = calculatedLeans?.economicLean === 0 && calculatedLeans?.socialLean === 0;
  if (!calculatedLeans || isZeroed) {
    calculatedLeans =
      state?.cachedEconomicLean !== undefined && state?.cachedSocialLean !== undefined
        ? { economicLean: state.cachedEconomicLean, socialLean: state.cachedSocialLean }
        : { economicLean: 0, socialLean: 0 };
  }

  const serializedState = state
    ? {
        ...state,
        _id: state._id,
        name: state.name,
        population: state.population,
        gdp: state.gdp,
        houseDistricts: state.houseDistricts,
        cachedEconomicLean: state.cachedEconomicLean,
        cachedSocialLean: state.cachedSocialLean,
      }
    : null;

  const serializedDemographics = demographics
    ? { ...demographics, lastUpdated: toIsoStringOrNull(demographics.lastUpdated) }
    : null;

  const serializedPartyOrg = serializePartyOrg(partyOrg, false);
  const currentParty = await getCurrentPartyNav(userData?.character);

  const ukActivePreset = ukGameState?.preset ?? DEFAULT_SEED_PRESET;
  const censusData = getRegionCensusData("UK", stateId, ukActivePreset);
  const ukBucketProfile = getBucketProfileForRegion("UK", stateId, ukActivePreset);

  const serializedMps = officials.map((o) => ({
    _id: o._id.toString(),
    characterId: o.characterId?.toString() ?? null,
    nppId: o.nppId?.toString() ?? null,
    sequentialId: o.characterSequentialId ?? o.nppSequentialId ?? null,
    characterName: o.characterName,
    party: o.party,
    partyAbbreviation: o.partyAbbreviation,
    partyColor: o.partyColor,
    avatarUrl: o.avatarUrl,
    isNPP: o.isNPP ?? false,
    seatsHeld: o.seatsHeld,
    officeType: o.officeType,
  }));

  const sortedPlayers = [...players].sort(
    (a, b) => (b.politicalInfluence || 0) - (a.politicalInfluence || 0)
  );
  const serializedPlayers = sortedPlayers.map((p) => ({
    ...p,
    _id: p._id.toString(),
    userId: p.userId.toString(),
    // factionId is an ObjectId (or null) — must be stringified to avoid the
    // "Only plain objects can be passed to Client Components" hydration error.
    factionId: p.factionId ? p.factionId.toString() : null,
    politicalInfluence: p.politicalInfluence || 0,
  }));

  const sortedNPPs = [...npps].sort(
    (a, b) => (b.politicalInfluence || 0) - (a.politicalInfluence || 0)
  );
  const serializedNPPs = sortedNPPs.map((npp) => ({
    _id: npp._id.toString(),
    name: npp.name,
    party: npp.party,
    homeState: npp.homeState,
    politicalInfluence: npp.politicalInfluence || 0,
    currentOffice: npp.currentOffice,
    avatarUrl: npp.avatarUrl || null,
    partyName: npp.partyName,
    partyColor: npp.partyColor,
  }));

  // Devolved executive: First Minister of SCO/WAL/NIR or Mayor of LON
  // (recycled `governor` officeType). English non-London regions resolve
  // to null and the chip hides — see `regionalExecutive.ts`.
  const ukExecutiveLabel = getRegionalBillAssentTitleForState("UK", stateId);
  const ukExecutiveOfficeKey = getRegionalExecutiveOfficeKey("UK");
  const ukExecutiveRow = officials.find((o) => o.officeType === ukExecutiveOfficeKey) ?? null;
  const serializedUKExecutive = ukExecutiveRow
    ? {
        _id: ukExecutiveRow._id.toString(),
        characterId: ukExecutiveRow.characterId?.toString() ?? null,
        characterName: ukExecutiveRow.characterName ?? null,
        nppId: ukExecutiveRow.nppId?.toString() ?? null,
      }
    : null;
  // English non-London regions have no devolved executive — hide the chip.
  const showUKExecutive =
    stateId === "SCO" || stateId === "WAL" || stateId === "NIR" || stateId === "LON";

  // Office-link visibility: holder OR authorized party officer of an NPP-held
  // First Minister's office (state Chair/Vice; national Chair/Vice when neither).
  const ukOfficeCanManage = userData?.character?._id
    ? (await resolveOfficeAccess(db, "UK", stateId, userData.character._id)).canManage
    : false;

  // Bug #0668: treat a viewer from another country as unaffiliated for this UK
  // region so cross-country party-id collisions don't surface party actions.
  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { regionalConditionsOverviewEnabled: 1 } });
  const regionalConditionsOverviewEnabled = await isRegionalConditionsOverviewEnabled(gameConfig);

  const viewerPartyIdForRegion = isSameCountry(userData?.character, { countryId: "UK" })
    ? (userData?.character?.party ?? null)
    : null;

  return (
    <Suspense fallback={<RegionPageSkeleton />}>
      <UKRegionClient
        region={region}
        nation={nation}
        state={serializedState}
        demographics={serializedDemographics}
        categories={categories}
        censusData={censusData}
        partyOrg={serializedPartyOrg}
        calculatedLeans={calculatedLeans}
        governmentApproval={governmentApproval}
        approvalBase={approvalBase}
        approvalModifiers={approvalModifiers}
        turnoutData={turnoutData}
        bucketProfile={ukBucketProfile}
        userHomeState={userData?.character?.homeState}
        userCountryId={userData?.character?.countryId}
        currentParty={currentParty}
        isAdmin={userData?.isAdmin ?? false}
        mps={serializedMps}
        players={serializedPlayers}
        npps={serializedNPPs}
        overview={overview}
        executive={showUKExecutive ? serializedUKExecutive : null}
        executiveLabel={showUKExecutive ? ukExecutiveLabel : null}
        canManageOffice={ukOfficeCanManage}
        viewerPartyId={viewerPartyIdForRegion}
        regionalConditionsOverviewEnabled={regionalConditionsOverviewEnabled}
        approvalModifiersForOverview={approvalModifiers}
      />
    </Suspense>
  );
}

// ── Non-UK rendering path (US / CA / DE) ──

async function renderGenericRegion(countryId: CountryId, regionCode: string) {
  const stateId = regionCode;
  const state = await getRegionState(stateId, countryId);
  if (!state) notFound();

  // Parallelize all independent data fetching. gameState (preset) and gameConfig
  // are independent of every other query and of each other, so they join the
  // batch instead of bookending it with two extra sequential round trips (O2).
  const db = await getDb();
  const [
    userData,
    officials,
    approvalData,
    players,
    npps,
    demographicsData,
    partyOrg,
    turnoutData,
    overview,
    partyBudgetsByPartyId,
    regLedger,
    gameStateDoc,
    gameConfig,
  ] = await Promise.all([
    getUserData(),
    getRegionOfficials(stateId, countryId),
    getRegionGovernmentApproval(stateId, countryId),
    getRegionPlayers(stateId),
    getRegionNPPs(stateId, countryId),
    getRegionDemographics(stateId, countryId),
    getRegionPartyOrg(stateId, countryId),
    getRegionTurnout(stateId, countryId),
    getStateOverview(db, { countryId, stateId }),
    getStatePartyBudgets(db, countryId, stateId),
    getStateRegLedger(db, { countryId, stateId }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } }),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { regionalConditionsOverviewEnabled: 1 } }),
  ]);

  const activePreset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;

  // Per-bucket electorate profile for the Demographics tab. Derived from the
  // same granular units the vote engine uses, so the tab cannot disagree with
  // the result. Null for a region with no Layer-1 substrate — the tab keeps its
  // archetype fallback there.
  const bucketProfile = getBucketProfileForRegion(countryId, stateId, activePreset);
  const regionalConditionsOverviewEnabled = await isRegionalConditionsOverviewEnabled(gameConfig);

  // Viewer's party — used by the RegionDropdown to surface a "My Party" link
  // to this region's party-branch page when the viewer is in this country.
  const currentParty = await getCurrentPartyNav(userData?.character);

  const governmentApproval = approvalData?.approval ?? null;
  const approvalBaseScore = approvalData?.baseApproval ?? null;
  const approvalModifiers = approvalData?.modifiers ?? [];
  const { demographics, categories } = demographicsData;

  // Calculate state leans from demographics or fallback to legacy/cached values
  let calculatedLeans =
    state.cachedEconomicLean != null && state.cachedSocialLean != null
      ? {
          economicLean: state.cachedEconomicLean,
          socialLean: state.cachedSocialLean,
        }
      : demographics
        ? calculateStateLean(demographics, categories)
        : null;
  const isZeroed = calculatedLeans?.economicLean === 0 && calculatedLeans?.socialLean === 0;

  if (!calculatedLeans || isZeroed) {
    if (state.cachedEconomicLean !== undefined && state.cachedSocialLean !== undefined) {
      calculatedLeans = {
        economicLean: state.cachedEconomicLean,
        socialLean: state.cachedSocialLean,
      };
    } else if (countryId === COUNTRY_CONFIGS.US.id) {
      // Fallback: derive from 2020 election margin (US only)
      const { ELECTION_2020_MARGIN, marginToLean } = await import("@/lib/data/2020ElectionResults");
      const margin = ELECTION_2020_MARGIN[state._id];
      const lean = margin !== undefined ? marginToLean(margin) : 0;
      calculatedLeans = { economicLean: lean, socialLean: lean };
    } else {
      calculatedLeans = { economicLean: 0, socialLean: 0 };
    }
  }

  // Serialize officials — pick the country's regional chief executive
  // (governor in US/JP, Minister-President in DE, First Minister or
  // Mayor of London in UK).
  const regionalExecutiveLabel = getRegionalBillAssentTitleForState(countryId, stateId);
  const regionalExecutiveOfficeKey = getRegionalExecutiveOfficeKey(countryId);
  const governor = officials.find((o) => o.officeType === regionalExecutiveOfficeKey) ?? null;
  const governorDisplayName = governor?.characterName;

  const serializedGovernor = governor
    ? {
        _id: governor._id.toString(),
        characterId: governor.characterId?.toString() ?? null,
        characterName: governorDisplayName ?? null,
        party: governor.party ?? null,
        partyAbbreviation: governor.partyAbbreviation ?? null,
        partyColor: governor.partyColor ?? null,
        avatarUrl: governor.avatarUrl ?? null,
        borderKey: governor.borderKey ?? null,
        tintColor: governor.tintColor ?? null,
        isNPP: governor.isNPP ?? false,
        nppId: governor.nppId?.toString() ?? null,
        characterSequentialId: governor.characterSequentialId ?? null,
        nppSequentialId: governor.nppSequentialId ?? null,
      }
    : null;

  // Whether the viewer may reach the regional executive's Office page — the
  // human holder, OR an authorized party officer of an NPP-held office (state
  // Chair/Vice, or national Chair/Vice when the state party has neither). Drives
  // the "Office →" link visibility so officers of NPP-held offices can navigate
  // there, not just the holder.
  const officeCanManage = userData?.character?._id
    ? (await resolveOfficeAccess(db, countryId, state._id, userData.character._id)).canManage
    : false;

  // Map country-specific office types to the generic officials buckets.
  // US: senate → senators, house → houseReps, stateSenate → stateSenators
  // JP: sangiin → senators, shugiin → houseReps (no stateSenate equivalent)
  // Other parliamentary: lowerChamber → houseReps, upperChamber → senators
  const countryConfig = getCountryConfig(countryId);

  // Region major parties (with positions) for the Demographics dossier's
  // preferred-party derivation. `isDefault` parties are the country's built-in
  // major parties and are the only records that reliably carry econ/social
  // positions; the semantic `majorPartyIds` codes have no PoliticalParty field
  // to match against, so we select by `isDefault` here.
  const regionPartyDocs = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, isDefault: true })
    .project<
      Pick<
        PoliticalParty,
        "sequentialId" | "name" | "abbreviation" | "color" | "economicPosition" | "socialPosition"
      >
    >({
      sequentialId: 1,
      name: 1,
      abbreviation: 1,
      color: 1,
      economicPosition: 1,
      socialPosition: 1,
    })
    .sort({ sequentialId: 1 })
    .toArray();
  const regionParties: RegionPartyPosition[] = regionPartyDocs.map((p) => ({
    partyId: String(p.sequentialId),
    name: p.name,
    abbreviation: p.abbreviation ?? String(p.sequentialId),
    color: p.color ?? "#888888",
    economicPosition: p.economicPosition ?? 0,
    socialPosition: p.socialPosition ?? 0,
  }));

  const upperChamberKey = countryConfig.legislature?.upperChamber?.key;
  const lowerChamberKey = countryConfig.legislature?.lowerChamber?.key;

  const subNationalChamberKey = countryConfig.subNationalChamber?.key;

  const senatorTypes = new Set(["senate", upperChamberKey].filter(Boolean));
  const houseRepTypes = new Set(["house", lowerChamberKey].filter(Boolean));
  const stateSenatorTypes = new Set(["stateSenate", subNationalChamberKey].filter(Boolean));

  const serializeOfficial = (o: (typeof officials)[number]) => ({
    ...o,
    _id: o._id.toString(),
    characterId: o.characterId?.toString() || null,
    nppId: o.nppId?.toString() || null,
    isNPP: o.isNPP ?? false,
  });

  const serializedOfficials = {
    senators: officials.filter((o) => senatorTypes.has(o.officeType)).map(serializeOfficial),
    houseReps: officials.filter((o) => houseRepTypes.has(o.officeType)).map(serializeOfficial),
    stateSenators: officials
      .filter((o) => stateSenatorTypes.has(o.officeType))
      .map(serializeOfficial),
    governor: serializedGovernor,
  };

  const sortedPlayers = [...players].sort(
    (a, b) => (b.politicalInfluence || 0) - (a.politicalInfluence || 0)
  );
  const serializedPlayers = sortedPlayers.map((p) => ({
    ...p,
    _id: p._id.toString(),
    userId: p.userId.toString(),
    // factionId is an ObjectId (or null) — must be stringified to avoid the
    // "Only plain objects can be passed to Client Components" hydration error.
    factionId: p.factionId ? p.factionId.toString() : null,
    politicalInfluence: p.politicalInfluence || 0,
  }));

  const serializedDemographics = demographics
    ? {
        ...demographics,
        lastUpdated: toIsoStringOrNull(demographics.lastUpdated),
      }
    : null;

  const serializedPartyOrg = serializePartyOrg(partyOrg, true);

  const sortedNPPs = [...npps].sort(
    (a, b) => (b.politicalInfluence || 0) - (a.politicalInfluence || 0)
  );
  const serializedNPPs = sortedNPPs.map((npp) => ({
    _id: npp._id.toString(),
    name: npp.name,
    party: npp.party,
    homeState: npp.homeState,
    politicalInfluence: npp.politicalInfluence || 0,
    currentOffice: npp.currentOffice,
    avatarUrl: npp.avatarUrl || null,
    partyName: npp.partyName,
    partyColor: npp.partyColor,
  }));

  const regionUrl = buildRegionUrl(countryId, regionCode);

  // Bug #0668: party sequentialIds collide across countries, so a foreign
  // viewer's party id can map onto a same-id local party — surfacing the
  // Contest panel / Quick Actions / budget cards for the wrong country. Treat
  // the viewer as unaffiliated for this region when they belong to a different
  // country. (`isSameCountry` resolves a missing country to "US", preserving
  // legacy US characters.)
  const viewerPartyIdForRegion = isSameCountry(userData?.character, { countryId })
    ? (userData?.character?.party ?? null)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl min-w-0 overflow-x-hidden px-6 sm:px-8 lg:px-12 py-12 sm:py-16 space-y-12">
        {/* Hero header with title overlay and stats strip */}
        {/* No `overflow-hidden` here: it would clip the RegionDropdown menu (#915).
            Corner-rounding is instead applied to the masthead (top) and stat
            strip (bottom) so the card still reads as one rounded panel. */}
        <header className="relative rounded-2xl border border-card-border bg-card shadow-lg">
          {/* Hero masthead — banner image fades into a theme-token coloration
              gradient (mirrors the Cabinet Office hero). */}
          <div
            className="relative rounded-t-2xl px-5 pb-5 pt-4 sm:px-7 sm:pt-5"
            style={{
              background:
                "radial-gradient(120% 150% at 0% 0%, color-mix(in srgb, var(--primary) 16%, transparent) 0%, transparent 44%), linear-gradient(135deg, color-mix(in srgb, var(--card) 90%, var(--primary)) 0%, var(--card) 55%, var(--background) 100%)",
            }}
          >
            {/* Decorative art (banner wash + watermark) is clipped by its own
                wrapper so the masthead itself keeps no `overflow-hidden` — that
                clip was hiding the RegionDropdown menu (#915). */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-2xl">
              {/* banner photo, faded into the coloration gradient (like the Cabinet
                  Office hero): the gradient is the container background and the
                  photo is a faint wash above it. */}
              {(() => {
                const bannerSrc = resolveRegionBannerImage(countryId, state._id, state.bannerImage);
                return bannerSrc ? (
                  <HeroImage
                    src={bannerSrc}
                    alt={state.name}
                    fill
                    className="object-cover object-center opacity-30"
                    sizes="(max-width: 1280px) 100vw, 1280px"
                    priority
                  />
                ) : null;
              })()}
              {/* giant faded region-abbreviation watermark */}
              <div
                aria-hidden
                className="absolute -right-3 -top-10 select-none font-black leading-none"
                style={{
                  fontSize: 190,
                  color: "color-mix(in srgb, var(--foreground) 6%, transparent)",
                }}
              >
                {state._id}
              </div>
            </div>

            <div className="relative">
              {/* top-row controls */}
              <div className="mb-4 flex items-center justify-between gap-2">
                <BackButton iconOnly />
                <div className="flex items-center gap-2">
                  <RelocateButton
                    targetStateId={state._id}
                    targetName={state.name}
                    userHomeState={userData?.character?.homeState}
                    userCountryId={userData?.character?.countryId}
                    targetCountryId={countryId}
                    redirectPath={regionUrl}
                  />
                  <RegionDropdown
                    regionId={state._id}
                    regionName={state.name}
                    regionCountryId={countryId}
                    currentParty={currentParty}
                  />
                </div>
              </div>

              {/* identity row: flag icon + eyebrow/title/subtitle + lean */}
              <div className="flex items-center gap-4">
                {STATE_FLAGS[state._id] && (
                  <Image
                    src={`/api/flags/${state._id}`}
                    alt={`${state.name} flag`}
                    width={64}
                    height={46}
                    className="shrink-0 rounded-md object-cover shadow"
                    unoptimized
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
                    {countryConfig.name} · {countryConfig.regionLabel} Profile
                  </p>
                  <h1
                    data-coach="nav-region"
                    className="mt-1 truncate text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl"
                  >
                    {state.name}
                  </h1>
                  <p className="mt-0.5 text-sm italic text-muted">
                    {getStateDescriptor(state._id, countryConfig.regionLabel)}
                  </p>
                </div>
                {calculatedLeans && (
                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-primary/70">
                      Political Lean
                    </p>
                    <div className="mt-1 flex justify-end">
                      <PositionBadges
                        economic={calculatedLeans.economicLean}
                        social={calculatedLeans.socialLean}
                        mode="lean"
                        align="items-end"
                        countryId={countryId}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* accent divider rule */}
          <div
            aria-hidden
            className="h-0.5"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--primary) 16%, color-mix(in srgb, var(--primary) 55%, white) 50%, var(--primary) 84%, transparent)",
              opacity: 0.85,
            }}
          />

          {/* Fused stat strip — responsive grid (2-col mobile, 4-col sm, 6-col lg).
              No horizontal scroll; wraps naturally on narrow viewports. */}
          <div className="grid grid-cols-2 gap-px bg-card-border rounded-b-2xl overflow-hidden sm:flex sm:items-stretch sm:gap-0 sm:divide-x sm:divide-y-0 sm:bg-card">
            {/* Population */}
            <div className="flex flex-col bg-card px-4 py-3">
              <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                Population
              </span>
              <span className="text-sm font-bold tabular-nums">
                {formatPopulation(state.population)}
              </span>
            </div>

            {/* GDP */}
            <div className="flex flex-col bg-card px-4 py-3">
              <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                GDP
              </span>
              <span className="text-sm font-bold tabular-nums">
                {formatGDP(state.gdp, getCurrencyPrefix(countryId))}
              </span>
            </div>

            {/* House/Lower Chamber Districts */}
            <div className="flex flex-col bg-card px-4 py-3">
              <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                {countryConfig.legislature?.lowerChamber?.shortName ?? "House"} Dists.
              </span>
              <span className="text-sm font-bold tabular-nums">{state.houseDistricts}</span>
            </div>

            {/* Political Lean */}
            {calculatedLeans && (
              <div className="flex flex-col gap-1 bg-card px-4 py-3">
                <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                  Political Lean
                </span>
                <PositionBadges
                  economic={calculatedLeans.economicLean}
                  social={calculatedLeans.socialLean}
                  mode="lean"
                  align="items-start"
                  countryId={countryId}
                />
              </div>
            )}

            {/* Government Approval */}
            <div className="flex flex-col bg-card px-4 py-3">
              <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                Gov. Approval
              </span>
              <span className="text-sm font-bold tabular-nums">
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
                      baseApproval={approvalBaseScore ?? governmentApproval}
                      modifiers={approvalModifiers}
                      href={regionApprovalUrl(countryId, stateId)}
                    />
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
            </div>

            {/* Regional chief executive — Governor (US/JP), Minister-President (DE), etc. */}
            <div className="flex flex-col bg-card px-4 py-3 sm:col-span-2 lg:col-span-1">
              <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                {regionalExecutiveLabel}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-sm font-bold tabular-nums">
                {serializedGovernor && (serializedGovernor.characterId || serializedGovernor.nppId)
                  ? (serializedGovernor.characterName ?? "Unknown")
                  : "Vacant"}
                {(officeCanManage || userData?.isAdmin) && (
                  <Link
                    href={`${regionUrl}/office`}
                    className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/25"
                  >
                    Office →
                  </Link>
                )}
              </span>
            </div>

            {/* State motto (US only) */}
            {STATE_MOTTOS[state._id] && (
              <div className="flex flex-col bg-card px-4 py-3 col-span-2 sm:col-span-2 lg:col-span-1">
                <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                  Motto
                </span>
                <span
                  className="mt-0.5 truncate text-sm font-medium italic text-foreground"
                  title={STATE_MOTTOS[state._id]}
                >
                  {STATE_MOTTOS[state._id]}
                </span>
              </div>
            )}

            {/* IE constituent councils — §3.1 Option C flavor (no game-state impact). */}
            {countryId === "IE" && IE_REGION_CONSTITUENT_COUNCILS[state._id] && (
              <div className="flex flex-col bg-card px-4 py-3 col-span-2 sm:col-span-2 lg:col-span-2">
                <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
                  Comprising
                </span>
                <span
                  className="mt-0.5 text-xs text-muted"
                  title={IE_REGION_CONSTITUENT_COUNCILS[state._id].join(", ")}
                >
                  {IE_REGION_CONSTITUENT_COUNCILS[state._id].join(" · ")}
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Tabbed Content */}
        <Suspense fallback={<RegionTabsSkeleton />}>
          <StatePageTabs
            state={state}
            officials={serializedOfficials}
            players={serializedPlayers}
            npps={serializedNPPs}
            demographics={serializedDemographics}
            categories={categories}
            censusData={getRegionCensusData(countryId, state._id, activePreset)}
            calculatedLeans={calculatedLeans}
            regionParties={regionParties}
            partyOrg={serializedPartyOrg}
            turnoutData={turnoutData}
            bucketProfile={bucketProfile}
            isAdmin={userData?.isAdmin ?? false}
            overview={overview}
            viewerPartyId={viewerPartyIdForRegion}
            partyBudgetsByPartyId={partyBudgetsByPartyId}
            regLedger={regLedger}
            regionalConditionsOverviewEnabled={regionalConditionsOverviewEnabled}
            approvalModifiersForOverview={approvalModifiers}
            regionGovernmentApproval={governmentApproval}
            regionApprovalBase={approvalBaseScore}
          />
        </Suspense>
      </main>
    </div>
  );
}

// ── Page component ──

/**
 * Whether to record the "scout-state" onboarding step for this viewer: flag
 * on, this is the viewer's own home region, checklist not dismissed, and the
 * step not yet stored.
 */
async function shouldTrackScoutState(countryId: CountryId, regionCode: string): Promise<boolean> {
  try {
    const authData = await getAuthUserWithCharacter();
    const character = authData?.character;
    if (!character) return false;
    if (character.countryId !== countryId || character.homeState !== regionCode) return false;
    if (isOnboardingDismissed(character)) return false;
    if (character.onboarding?.steps?.["scout-state"] !== undefined) return false;
    return isOnboardingChecklistEnabled();
  } catch {
    return false;
  }
}

export default async function RegionPage({ params }: Props) {
  const { code, id: rawRegionParam } = await params;
  const id = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const countryId = code.toUpperCase() as CountryId;

  if (!COUNTRY_CONFIGS[countryId]) notFound();

  const regionCode = id.toUpperCase();

  const [page, trackScoutState] = await Promise.all([
    countryId === COUNTRY_CONFIGS.UK.id
      ? renderUKRegion(regionCode)
      : renderGenericRegion(countryId, regionCode),
    shouldTrackScoutState(countryId, regionCode),
  ]);

  return (
    <>
      {trackScoutState && <OnboardingStepTracker step="scout-state" />}
      {page}
    </>
  );
}
