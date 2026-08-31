"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useCabinetOffice } from "./useCabinetOffice";
import { useMergerReviewQueue } from "./useMergerReviewQueue";
import IntelligenceTab from "./components/IntelligenceTab";
import { MergerReviewQueuePanel } from "./components/MergerReviewQueuePanel";
import { CabinetOfficeLayout } from "./components/CabinetOfficeLayout";
import { RestrictedOfficeNotice } from "./components/RestrictedOfficeNotice";
import { CabinetStatStrip } from "./components/CabinetStatStrip";
import { CabinetPositionRail } from "./components/CabinetPositionRail";
import { FlagshipRouter } from "./components/FlagshipRouter";
import { CabinetForceStrip } from "./components/CabinetForceStrip";
import { CabinetEstateStrip } from "./components/CabinetEstateStrip";
import { CabinetEnergyStrip } from "./components/CabinetEnergyStrip";
import { CabinetInfraStrip } from "./components/CabinetInfraStrip";
import { CabinetMonetaryStrip } from "./components/CabinetMonetaryStrip";
import { CabinetBannerUploader } from "./components/CabinetBannerUploader";
import { RegionalBreakdownTable } from "./components/RegionalBreakdownTable";
import { TierSettingPanel } from "./components/TierSettingPanel";
import { ActingLockProvider } from "./components/ActingLock";
import { ActingOfficeNotice } from "./components/ActingOfficeNotice";
import { RegionalTargetPanel } from "./components/RegionalTargetPanel";
import { AdvocacyTogglePanel } from "./components/AdvocacyTogglePanel";
import { MinisterialOrderPanel } from "./components/MinisterialOrderPanel";
import { EmergencyMechanicPanel } from "./components/EmergencyMechanicPanel";
import { ChancellorFundingPanel } from "./components/ChancellorFundingPanel";
import { ForeignSecPanels } from "./components/ForeignSecPanels";
import { StateEnterprisesPanel } from "./components/StateEnterprisesPanel";
import { TradeEmbargoPanel } from "./components/TradeEmbargoPanel";
import { GeologicalSurveyPanel } from "./components/GeologicalSurveyPanel";
import { DoctrineTab } from "./components/military/DoctrineTab";
import { CommandsTab } from "./components/military/CommandsTab";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { useConflictsEnabled } from "@/contexts/AuthDataContext";
import { latestEraIndex } from "@/lib/military/doctrineTree";
import {
  resolveCabinetTabs,
  isFinanceMinister,
  isForeignMinister,
  isDefenseMinister,
  isIntelligenceMinister,
  isCompetitionSeat,
  type CabinetTabId,
} from "./cabinetTabs";
import { DeclareWarPanel } from "./components/military/DeclareWarPanel";
import { PeacePanel } from "./components/PeacePanel";
import { FOREIGN_AFFAIRS_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import {
  getCabinetMechanics,
  getCabinetPositions,
  getCabinetPositionGroup,
} from "@/lib/constants/cabinetMechanics";
import { resolveEstatePortfolio } from "@/lib/constants/cabinetEstates";
import { resolveEnergyPosition } from "@/lib/constants/cabinetEnergy";
import { resolveInfraPosition } from "@/lib/constants/cabinetInfra";
import { resolveFinancePosition } from "@/lib/constants/cabinetMonetary";
import { getCabinetIdentity } from "@/lib/constants/cabinetIdentity";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { TRADE_MINISTER_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { Skeleton } from "@/components/ui";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, CURRENCY_SYMBOLS } from "@/lib/constants/currencies";

export default function CabinetOfficePage() {
  const params = useParams();
  const positionId = params.positionId as string;
  const countryCode = (params.code as string).toLowerCase();
  const countryId = countryCode.toUpperCase();
  const currencySymbol = CURRENCY_SYMBOLS[COUNTRY_CURRENCY_MAP[countryId as CountryId]] ?? "$";

  const { data, loading, error, refetch } = useCabinetOffice(countryCode, positionId);
  const mechanics = getCabinetMechanics(countryId, positionId);
  const positionConfig = getCabinetPositions(countryId).find((p) => p.id === positionId);
  const identity = getCabinetIdentity(countryId);

  const conflictsEnabled = useConflictsEnabled();

  // Declared above the early returns, like the hash effect below: hooks must run
  // in the same order every render. `enabled` only skips a pointless request;
  // the endpoint re-resolves the seat and is the only authority that matters.
  const { data: mergerQueue, refetch: refetchMergerQueue } = useMergerReviewQueue(
    isCompetitionSeat(countryId, positionId) && data?.canAct === true
  );

  const [activeTab, setActiveTab] = useState<CabinetTabId>("overview");

  // Deep-link to a tab via the URL hash, e.g. .../office#commands — how the
  // Commanding General's page links back to their command's structure.
  //
  // A hash rather than a query param on purpose: it is never sent to the server, so
  // there is no hydration mismatch and no useSearchParams Suspense boundary to add.
  //
  // Declared HERE, above the loading/error early returns, because hooks must run in
  // the same order on every render. It resolves the seat's own tab set rather than
  // trusting the hash, or #treasury on a defence office would select a tab whose
  // body never renders and leave a blank panel.
  useEffect(() => {
    const wanted = window.location.hash.slice(1);
    if (!wanted || !mechanics) return;
    const available = resolveCabinetTabs({
      countryId,
      positionId,
      mechanics,
      conflictsEnabled,
      competitionQueueApplies: true,
    });
    if (available.some((t) => t.id === wanted)) setActiveTab(wanted as CabinetTabId);
    // Mount only: a later manual tab change must not be fought by the hash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A #competition hash can select the tab before the queue has answered. If the
  // answer is that the duty does not apply here, fall back rather than leave a
  // blank body implying a feature this seat does not have.
  useEffect(() => {
    if (mergerQueue && mergerQueue.applies === false) {
      setActiveTab((tab) => (tab === "competition" ? "overview" : tab));
    }
  }, [mergerQueue]);

  if (!mechanics || !positionConfig) {
    return <div className="p-8 text-center text-error">Unknown cabinet position</div>;
  }

  // Skeleton only on the first load. A refresh with data already in hand must
  // keep the office mounted or roster state (branch tab, open Manage panel)
  // resets to Ground after every assign.
  if (loading && !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6">
          <Skeleton className="h-[220px] w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
            <h2 className="text-lg font-semibold text-error">{error ?? "Failed to load"}</h2>
          </div>
        </main>
      </div>
    );
  }

  // Fog of war. The server has already withheld every departmental field, so
  // there is nothing below the letterhead left to render: no stat strip, no
  // tabs, and therefore no tab body and none of the panels that fetch on mount.
  // `=== false` so a pre-gate payload mid-deploy keeps today's behaviour.
  if (data.canView === false) {
    return (
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
          <CabinetOfficeLayout
            positionName={data.position?.name ?? positionConfig.name}
            department={data.position?.department ?? mechanics.department}
            sealImage={mechanics.sealImage}
            countryId={countryId as CountryId}
            member={data.member}
            bannerImageUrl={data.member?.bannerImageUrl}
            identityGlyph={identity.glyph}
            identitySerif={identity.serif}
            group={getCabinetPositionGroup(countryId, positionId)}
            registry={COUNTRY_CONFIGS[countryId as CountryId]?.name}
            tabs={[]}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            showActions={false}
            statStrip={null}
          />
          <RestrictedOfficeNotice
            seatName={data.position?.name ?? positionConfig.name}
            allowedTitles={data.restriction?.allowedTitles ?? []}
            // Deliberately no COUNTRY_CONFIGS fallback: the bare `name` drops the
            // definite article ("of United States"), and the notice reads fine
            // without a country at all. The server sends the realm phrase.
            countryName={data.restriction?.countryName ?? ""}
          />
        </main>
      </div>
    );
  }

  const canAct = data.canAct;

  const tabs = resolveCabinetTabs({
    countryId,
    positionId,
    mechanics,
    conflictsEnabled,
    competitionQueueApplies: mergerQueue?.applies === true,
  });
  const isFinance = isFinanceMinister(countryId, positionId);
  const isForeign = isForeignMinister(positionId);
  const isTrade = TRADE_MINISTER_POSITION_BY_COUNTRY[countryId as CountryId] === positionId;
  const flagshipLabel = tabs.find((t) => t.id === "flagship")?.label ?? "Programs";
  const isDefense = isDefenseMinister(positionId);
  const isIntelligence = isIntelligenceMinister(positionId);
  // The foreign PORTFOLIO, which every country with a foreign ministry has — not
  // `isForeign`, which gates the Foreign Relations tab and is capped at US/UK/JP.
  const holdsForeignPortfolio =
    FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[countryId as CountryId] === positionId;
  const hasForce = isDefense && Boolean(data.forceSummary);
  const regions = data.regionData.map((r) => ({ id: r.regionId, name: r.regionName }));
  const estatePortfolio = resolveEstatePortfolio(countryId, positionId);
  const hasEstates = Boolean(estatePortfolio) && Boolean(data.estateSummary);
  const energyPosition = resolveEnergyPosition(countryId, positionId);
  const hasEnergy = Boolean(energyPosition) && Boolean(data.energySummary);
  const infraPosition = resolveInfraPosition(countryId, positionId);
  const hasInfra = Boolean(infraPosition) && Boolean(data.infraSummary);
  const hasMonetary = resolveFinancePosition(countryId) === positionId && Boolean(data.monetary);

  return (
    // Published once, at the top of the office, so every lever inside it reads the
    // same restrictions off the same payload the server gated on.
    <ActingLockProvider member={data.member}>
      <div className="min-h-screen bg-background pb-16">
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
          {data.member?.acting && (
            <ActingOfficeNotice
              turnsRemaining={
                data.member.actingExpiresOnTurn != null
                  ? Math.max(0, data.member.actingExpiresOnTurn - data.currentTurn)
                  : null
              }
            />
          )}
          <CabinetOfficeLayout
            positionName={data.position?.name ?? positionConfig.name}
            department={data.position?.department ?? mechanics.department}
            sealImage={mechanics.sealImage}
            countryId={countryId as CountryId}
            member={data.member}
            bannerImageUrl={data.member?.bannerImageUrl}
            identityGlyph={identity.glyph}
            identitySerif={identity.serif}
            group={getCabinetPositionGroup(countryId, positionId)}
            registry={COUNTRY_CONFIGS[countryId as CountryId]?.name}
            tabs={tabs}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            statStrip={
              hasForce && data.forceSummary ? (
                <CabinetForceStrip
                  forceSummary={data.forceSummary}
                  currencySymbol={currencySymbol}
                  manpowerPool={data.manpower?.pool}
                />
              ) : hasEnergy && data.energySummary ? (
                <CabinetEnergyStrip
                  energySummary={data.energySummary}
                  currencySymbol={currencySymbol}
                />
              ) : hasInfra && data.infraSummary ? (
                <CabinetInfraStrip
                  infraSummary={data.infraSummary}
                  currencySymbol={currencySymbol}
                />
              ) : hasEstates && data.estateSummary ? (
                <CabinetEstateStrip
                  estateSummary={data.estateSummary}
                  currencySymbol={currencySymbol}
                />
              ) : hasMonetary && data.monetary ? (
                <CabinetMonetaryStrip m={data.monetary} />
              ) : (
                <CabinetStatStrip
                  metrics={mechanics.nationalMetrics}
                  values={data.nationalMetrics}
                  currencySymbol={currencySymbol}
                />
              )
            }
            bannerOverlay={
              canAct && data.member ? (
                <CabinetBannerUploader
                  countryCode={countryCode}
                  positionId={positionId}
                  onUploaded={refetch}
                />
              ) : null
            }
          />

          <div className="flex flex-col gap-6 lg:flex-row">
            <CabinetPositionRail
              countryCode={countryCode}
              countryId={countryId}
              activePositionId={positionId}
              liveYear={data.liveYear}
            />

            <div className="min-w-0 flex-1 space-y-6">
              {activeTab === "overview" && (
                <>
                  {mechanics.tierSetting && (
                    <TierSettingPanel
                      config={mechanics.tierSetting}
                      currentValue={
                        data.currentSettings?.tierSetting ?? mechanics.tierSetting.defaultTier
                      }
                      canAct={canAct}
                      countryCode={countryCode}
                      positionId={positionId}
                      onUpdate={refetch}
                    />
                  )}

                  {/* Extra portfolio levers (e.g. HEW education + welfare). */}
                  {mechanics.tierSettings?.map((tierCfg) =>
                    tierCfg.key ? (
                      <TierSettingPanel
                        key={tierCfg.key}
                        config={tierCfg}
                        tierKey={tierCfg.key}
                        currentValue={
                          data.currentSettings?.tierSettings?.[tierCfg.key] ?? tierCfg.defaultTier
                        }
                        canAct={canAct}
                        countryCode={countryCode}
                        positionId={positionId}
                        onUpdate={refetch}
                      />
                    ) : null
                  )}

                  {/* Non-finance seats with a discretionary pool surface allocation on Overview
                    (finance ministers get it on the Treasury tab). */}
                  {mechanics.allocation && !isFinance && (
                    <ChancellorFundingPanel
                      regionData={data.regionData}
                      regionalBudgets={data.regionalBudgets}
                      currentAllocations={data.currentSettings?.allocationPercents ?? null}
                      canAct={canAct}
                      countryCode={countryCode}
                      positionId={positionId}
                      onUpdate={refetch}
                    />
                  )}

                  {mechanics.regionalTarget && (
                    <RegionalTargetPanel
                      config={mechanics.regionalTarget}
                      regionData={data.regionData}
                      currentRegionId={data.currentSettings?.targetRegionId ?? null}
                      canAct={canAct}
                      countryCode={countryCode}
                      positionId={positionId}
                      onUpdate={refetch}
                    />
                  )}

                  {mechanics.advocacy && (
                    <AdvocacyTogglePanel
                      config={mechanics.advocacy}
                      active={data.currentSettings?.advocacyActive ?? false}
                      canAct={canAct}
                      countryCode={countryCode}
                      positionId={positionId}
                      onUpdate={refetch}
                    />
                  )}

                  {isTrade && (
                    <TradeEmbargoPanel
                      countryId={countryId as CountryId}
                      canAct={canAct}
                      actionsRemaining={data.member?.ministerialActions ?? 0}
                    />
                  )}

                  {mechanics.emergency && (
                    <EmergencyMechanicPanel
                      config={mechanics.emergency}
                      regionData={data.regionData}
                      actionsRemaining={data.member?.ministerialActions ?? 0}
                      canAct={canAct}
                      countryCode={countryCode}
                      positionId={positionId}
                      onUpdate={refetch}
                    />
                  )}

                  <MinisterialOrderPanel
                    orders={data.orders}
                    activeOrders={data.activeOrders}
                    actionsRemaining={data.member?.ministerialActions ?? 0}
                    canAct={canAct}
                    countryCode={countryCode}
                    positionId={positionId}
                    singleRegionFocus={mechanics.singleRegionFocus ?? null}
                    regionData={data.regionData}
                    onUpdate={refetch}
                  />

                  {!mechanics.singleRegionFocus && mechanics.regionalMetrics.length > 0 && (
                    <RegionalBreakdownTable
                      metrics={mechanics.regionalMetrics}
                      regionData={data.regionData}
                      currencySymbol={currencySymbol}
                    />
                  )}
                </>
              )}

              {activeTab === "treasury" && isFinance && (
                <>
                  {mechanics.allocation && (
                    <ChancellorFundingPanel
                      regionData={data.regionData}
                      regionalBudgets={data.regionalBudgets}
                      currentAllocations={data.currentSettings?.allocationPercents ?? null}
                      canAct={canAct}
                      countryCode={countryCode}
                      positionId={positionId}
                      onUpdate={refetch}
                    />
                  )}
                  <StateEnterprisesPanel countryCode={countryCode} canAct={canAct} />
                  {data.prospectingEnabled && (
                    <GeologicalSurveyPanel
                      countryId={countryId}
                      canAct={canAct}
                      stateOptions={regions}
                    />
                  )}
                </>
              )}

              {activeTab === "overview" && holdsForeignPortfolio && conflictsEnabled && (
                <div className="mb-4">
                  <PeacePanel
                    countryCode={countryCode}
                    countryId={countryId as CountryId}
                    canAct={canAct}
                  />
                </div>
              )}

              {activeTab === "foreign" && isForeign && (
                <ForeignSecPanels
                  currentSettings={data.currentSettings}
                  targetCountries={data.targetCountries}
                  canAct={canAct}
                  countryCode={countryCode}
                  positionId={positionId}
                  onUpdate={refetch}
                />
              )}

              {activeTab === "flagship" && (
                <FlagshipRouter
                  countryCode={countryCode}
                  countryId={countryId}
                  positionId={positionId}
                  canAct={canAct}
                  currencySymbol={currencySymbol}
                  regions={regions}
                  targetCountries={data.targetCountries}
                  onUpdate={refetch}
                  liveYear={data.liveYear}
                  hasForce={hasForce}
                  force={
                    hasForce && data.forceSummary && data.units
                      ? {
                          units: data.units,
                          forceSummary: data.forceSummary,
                          manpower: data.manpower,
                          commanders: data.commanders ?? [],
                          arsenal: data.arsenal,
                          contracts: data.contracts,
                          suppliers: data.suppliers,
                          lotPricePerLot: data.lotPricePerLot,
                        }
                      : null
                  }
                  estates={
                    hasEstates && estatePortfolio && data.estateSummary && data.estates
                      ? {
                          portfolioKey: estatePortfolio,
                          estates: data.estates,
                          estateSummary: data.estateSummary,
                        }
                      : null
                  }
                  energy={
                    hasEnergy && data.energySummary && data.plants
                      ? { plants: data.plants, energySummary: data.energySummary }
                      : null
                  }
                  infra={
                    hasInfra && data.infraSummary && data.projects
                      ? { projects: data.projects, infraSummary: data.infraSummary }
                      : null
                  }
                  monetary={
                    hasMonetary && data.monetary
                      ? {
                          monetary: data.monetary,
                          debtPrincipal: data.debtPrincipal ?? 0,
                          sovereignBondsOutstanding: data.sovereignBondsOutstanding ?? 0,
                          sovereignBondProfile: data.sovereignBondProfile ?? null,
                          currentTurn: data.currentTurn ?? 1,
                        }
                      : null
                  }
                  placeholderLabel={flagshipLabel}
                />
              )}

              {activeTab === "competition" && (
                <MergerReviewQueuePanel
                  data={mergerQueue}
                  canAct={canAct}
                  onDecided={refetchMergerQueue}
                />
              )}

              {activeTab === "intelligence" && isIntelligence && conflictsEnabled && (
                <IntelligenceTab countryId={countryId as CountryId} positionId={positionId} />
              )}

              {activeTab === "commands" && isDefense && conflictsEnabled && (
                <div className="mb-4">
                  <DeclareWarPanel
                    countryCode={countryCode}
                    countryId={countryId as CountryId}
                    canAct={canAct}
                  />
                </div>
              )}

              {activeTab === "commands" && isDefense && conflictsEnabled && (
                <CommandsTab
                  commands={data.commands ?? []}
                  units={(data.units ?? []) as unknown as MilitaryUnit[]}
                  commanders={data.commanders ?? []}
                  conflictAssignments={data.conflictAssignments ?? []}
                  conflicts={data.conflicts ?? []}
                  corps={data.corps ?? []}
                  commissionCandidates={data.commissionCandidates ?? []}
                  regionThreats={data.regionThreats ?? {}}
                  countryCode={countryCode}
                  positionId={positionId}
                />
              )}

              {activeTab === "doctrine" && isDefense && conflictsEnabled && (
                <DoctrineTab
                  currentEra={data.doctrineEra ?? latestEraIndex()}
                  doctrine={data.doctrine ?? { adopted: {}, points: 0 }}
                  countryCode={countryCode}
                  positionId={positionId}
                  onAdopt={refetch}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </ActingLockProvider>
  );
}
