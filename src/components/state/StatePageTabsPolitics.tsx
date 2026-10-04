"use client";

import type { State } from "@/lib/db/types";
import {
  getCountryConfig,
  getRegionalBillAssentTitleForState,
  getRegionalExecutiveOfficeKey,
  isParliamentarySystem,
} from "@/lib/constants/countries";
import { getStateLean } from "@/lib/utils/demographics";
import { PositionLabel } from "@/components/PositionLabel";
import { positionBucketHex, usesEuropeanLeanColours } from "@/lib/utils/politics";
import {
  SenateSection,
  HouseSection,
  GovernorSection,
  StateSenateSection,
} from "./politics/OfficialsSection";
import { PlayersList } from "./politics/PlayersList";
import { NPPsList } from "./politics/NPPsList";
import { PartyOrgSectorBreakdown } from "./politics/PartyOrgSectorBreakdown";
import { GovModifierChip } from "./politics/GovModifierChip";
import { RegistrationLedgerCard } from "./politics/RegistrationLedgerCard";
import { BuildOrgPanel } from "./politics/orgActions/BuildOrgPanel";
import { GotvDriveCard } from "./politics/GotvDriveCard";
import { SuppressionCounterOpsCard } from "./politics/SuppressionCounterOpsCard";
import { QuickActionsPanel } from "./politics/QuickActionsPanel";
import { AdminRedistrictPanel } from "./politics/AdminRedistrictPanel";
import { StateDistrictsSection } from "./politics/StateDistrictsSection";
import { AgendaBannerWithEdit } from "@/components/party-hub/AgendaBannerWithEdit";
import type { RegionalExecutive } from "@/lib/states/regionalExecutive";
import type { StateRegLedgerResult } from "@/lib/states/overview/getStateRegLedger";
import type {
  PartyOrgDisplay,
  NPPDisplaySimple,
  SerializedOfficial,
  SerializedPlayer,
} from "./StatePageTabsTypes";

interface PoliticsTabPartyBudget {
  gotvBudgetPercent: number;
  gotvTargetCategory?: string;
  gotvTargetGroup?: string;
  suppressionBudgetPercent: number;
  suppressionTargetCategory?: string;
  suppressionTargetGroup?: string;
  orgBuildingPercent: number;
}

/**
 * One axis of the region's lean: the bucket word (in its lean colour) and the
 * exact score above, then the axis ramp with a marker at the score.
 */
function leanGradient(axis: "economic" | "social", european: boolean): string {
  if (axis === "social") {
    return "linear-gradient(to right, #0d9488 0%, #2dd4bf 30%, #71717a 50%, #f59e0b 70%, #d97706 100%)";
  }
  return european
    ? "linear-gradient(to right, #b91c1c 0%, #ef4444 30%, #71717a 50%, #3b82f6 70%, #1d4ed8 100%)"
    : "linear-gradient(to right, #1d4ed8 0%, #3b82f6 30%, #71717a 50%, #ef4444 70%, #b91c1c 100%)";
}

function LeanMeter({
  label,
  value,
  axis,
  countryId,
  leftLabel,
  rightLabel,
}: {
  label: string;
  value: number;
  axis: "economic" | "social";
  countryId: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const pct = ((value + 5) / 10) * 100;
  const color = positionBucketHex(value, axis, usesEuropeanLeanColours(countryId));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body text-muted">{label}</span>
        <span className="text-body font-semibold">
          <PositionLabel value={value} axis={axis} countryId={countryId} />
          <span className="ml-2 font-normal tabular-nums text-muted">
            {value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2)}
          </span>
        </span>
      </div>
      <div
        className="relative mt-3 h-2 rounded-full"
        style={{ background: leanGradient(axis, usesEuropeanLeanColours(countryId)) }}
        aria-hidden
      >
        <div className="absolute left-1/2 top-1/2 h-4 w-px -translate-y-1/2 bg-white/40" />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-body-sm text-muted">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

export function PoliticsTab({
  state,
  officials,
  players,
  npps,
  calculatedLeans,
  partyOrg,
  regionalExecutive,
  viewerPartyId,
  partyBudgetsByPartyId,
  regLedger,
  isAdmin = false,
}: {
  state: State;
  officials: {
    senators: SerializedOfficial[];
    houseReps: SerializedOfficial[];
    stateSenators: SerializedOfficial[];
    governor: {
      _id: string;
      characterId: string | null;
      characterName: string | null;
      party: string | null;
      partyAbbreviation: string | null;
      partyColor?: string | null;
      avatarUrl: string | null;
      isNPP: boolean;
      nppId: string | null;
    } | null;
  };
  players: SerializedPlayer[];
  npps: NPPDisplaySimple[];
  calculatedLeans: { economicLean: number; socialLean: number } | null;
  partyOrg: PartyOrgDisplay[];
  regionalExecutive?: RegionalExecutive | null;
  viewerPartyId?: string | null;
  partyBudgetsByPartyId?: Record<string, PoliticsTabPartyBudget>;
  regLedger: StateRegLedgerResult;
  isAdmin?: boolean;
}) {
  const config = getCountryConfig(state.countryId);
  const isParliamentary = isParliamentarySystem(config);
  // `calculateStateLean` returns on the −5..+5 scale (same as candidate/group
  // leans), and every other surface — the map tooltip (`leanService`), the
  // profile position markers (`DetailedPolicyDisplay`), and the vote engine —
  // renders that raw value. Clamp to ±5 (not ±1) so strong-lean regions are not
  // compressed: e.g. eastern German states sit near +2 social, which a ±1 clamp
  // would mislabel as +1.00 and disagree with the profile/map.
  const econ = Math.max(-5, Math.min(5, calculatedLeans?.economicLean ?? getStateLean(state) ?? 0));
  const soc = Math.max(-5, Math.min(5, calculatedLeans?.socialLean ?? getStateLean(state) ?? 0));
  const upperChamberName = config.legislature?.upperChamber?.shortName ?? "Senate";
  const upperChamber = config.legislature?.upperChamber;
  const lowerChamberName = config.legislature?.lowerChamber?.shortName ?? "House";
  const subNationalName = config.subNationalChamber?.shortName ?? "State Senate";
  // Country-aware regional chief-executive label — "Governor" (US/JP),
  // "Minister-President" (DE), etc.
  const regionalExecutiveLabel = getRegionalBillAssentTitleForState(state.countryId, state._id);
  // Matching electedOfficials officeType key, drives the avatar card's
  // office badge.
  const regionalExecutiveOfficeType = getRegionalExecutiveOfficeKey(state.countryId);
  // JP Sangiin is multi-seat proportional in rotating classes; US Senate is single-seat per class
  const upperIsMultiSeat = config.legislature?.upperChamber?.key === "sangiin";
  // Elected upper chambers WITHOUT rotating classes (RU Soviet of Nationalities,
  // IE Seanad, the beta senates): one delegation per region, each member
  // holding a seat count. Keyed on the chamber's `regionElectedClasses` flag,
  // the same signal the admin seat appointer uses, so the US Senate keeps its
  // classed cards and never shows "Class" on a proportional deputy.
  const upperIsProportional =
    !upperIsMultiSeat && upperChamber?.elected === true && !upperChamber.regionElectedClasses;
  const upperOffice = upperChamber
    ? config.officeTypes.find(
        (o) => o.chamberKey === upperChamber.key && !o.isExecutive && !o.isSubNational
      )
    : undefined;
  const upperMemberTitle = upperIsMultiSeat
    ? `${upperChamberName} Member`
    : upperIsProportional
      ? (upperOffice?.label ?? "Senator")
      : "Senator";
  const lowerMemberTitle =
    config.legislature?.lowerChamber?.key === "shugiin"
      ? `${lowerChamberName} Member`
      : "Representative";

  const leanAndOrg = (
    <section
      aria-labelledby="politics-lean-title"
      className="rounded-xl border border-card-border bg-card p-5 sm:p-6"
    >
      <h2 id="politics-lean-title" className="text-heading-lg font-semibold text-foreground">
        Lean and organization
      </h2>
      <div className="mt-6 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <div className="space-y-6">
          <LeanMeter
            label="Economic"
            value={econ}
            axis="economic"
            countryId={state.countryId}
            leftLabel="Left"
            rightLabel="Right"
          />
          <LeanMeter
            label="Social"
            value={soc}
            axis="social"
            countryId={state.countryId}
            leftLabel="Liberal"
            rightLabel="Traditional"
          />
        </div>
        <PartyOrgSectorBreakdown partyOrg={partyOrg} />
      </div>
    </section>
  );

  // Party-id lookup helpers for the GovModifierChip enrichment.
  const partyAbbreviationById = new Map(partyOrg.map((po) => [po.partyId, po.partyAbbreviation]));
  const partyColorById = new Map(partyOrg.map((po) => [po.partyId, po.partyColor]));

  // Viewer-party budget for the GOTV / Suppression summary cards.
  const viewerBudget = viewerPartyId ? partyBudgetsByPartyId?.[viewerPartyId] : undefined;
  const viewerHasRowInState =
    viewerPartyId != null && partyOrg.some((po) => po.partyId === viewerPartyId);

  // Build Org panel auth — chair-only auth AND presence are enforced
  // server-side, so we only require party membership here. A party can have
  // genuine presence (player / NPP / official) in a state with no seeded Org
  // row (e.g. CDU in Bayern); the build-org route bootstraps the 0% row on
  // first use, so gating on row-existence would wrongly hide a valid action.
  // The API short-circuits with a clear message if auth or presence fails.
  const canBuildOrg = !!viewerPartyId;

  // Viewer's own state-party row — drives the inline Build Org panel's PS +
  // presence (politicalStrength surfaced via serializePartyOrg).
  const viewerOrgRow = viewerPartyId
    ? partyOrg.find((po) => po.partyId === viewerPartyId)
    : undefined;

  const newCardsRow = (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <GovModifierChip
        regionalExecutive={regionalExecutive ?? null}
        partyAbbreviationById={partyAbbreviationById}
        partyColorById={partyColorById}
      />
      <RegistrationLedgerCard regLedger={regLedger} />
      {viewerPartyId && viewerOrgRow ? (
        <BuildOrgPanel
          compact
          countryCode={state.countryId}
          stateId={state._id}
          partyId={viewerPartyId}
          partyColor={viewerOrgRow.partyColor}
          ps={viewerOrgRow.politicalStrength ?? 0}
          hasPresence={viewerHasRowInState}
          canBuildOrg={canBuildOrg}
          onSuccess={() => {}}
        />
      ) : null}
    </div>
  );

  // Only render the budget summary cards when the viewer's party has a
  // state-party row here. Otherwise the deep-link CTA would lead to a
  // state-party page with no row, which is a dead-end for the user.
  const budgetCardsRow =
    viewerPartyId && viewerHasRowInState ? (
      <div className="grid gap-4 md:grid-cols-2">
        <GotvDriveCard
          countryCode={state.countryId}
          stateId={state._id}
          partyId={viewerPartyId}
          budgetPercent={viewerBudget?.gotvBudgetPercent}
          targetCategory={viewerBudget?.gotvTargetCategory}
          targetGroup={viewerBudget?.gotvTargetGroup}
        />
        <SuppressionCounterOpsCard
          countryCode={state.countryId}
          stateId={state._id}
          partyId={viewerPartyId}
          budgetPercent={viewerBudget?.suppressionBudgetPercent}
          targetCategory={viewerBudget?.suppressionTargetCategory}
          targetGroup={viewerBudget?.suppressionTargetGroup}
        />
      </div>
    ) : null;

  const quickActions = (
    <QuickActionsPanel
      countryCode={state.countryId}
      stateId={state._id}
      viewerPartyId={viewerPartyId ?? null}
      hasViewerPartyRowInState={viewerHasRowInState}
    />
  );

  // National Agenda banner — read-only on the State Politics tab. Renders only when the
  // viewer is affiliated with a party AND that party has an active agenda. Non-edit; the
  // chair edits on the National Party Hub.
  const viewerPartyAbbreviation = viewerPartyId
    ? partyOrg.find((po) => po.partyId === viewerPartyId)?.partyAbbreviation
    : undefined;
  const viewerPartyColor = viewerPartyId
    ? partyOrg.find((po) => po.partyId === viewerPartyId)?.partyColor
    : undefined;
  const agendaBanner = viewerPartyId ? (
    <AgendaBannerWithEdit
      countryCode={state.countryId}
      partyId={viewerPartyId}
      partyAbbreviation={viewerPartyAbbreviation ?? undefined}
      partyColor={viewerPartyColor ?? undefined}
      canEdit={false}
    />
  ) : null;

  // Split upper chamber by class for multi-seat staggered systems (JP Sangiin)
  const upperClass1 = upperIsMultiSeat
    ? officials.senators.filter((s) => (s as { chamberClass?: number }).chamberClass === 1)
    : [];
  const upperClass2 = upperIsMultiSeat
    ? officials.senators.filter((s) => (s as { chamberClass?: number }).chamberClass === 2)
    : [];

  // Counts for the Officials summary line
  const totalOfficials =
    officials.senators.length +
    officials.houseReps.length +
    officials.stateSenators.length +
    (officials.governor ? 1 : 0);
  const activeParties = partyOrg.filter((p) => p.organization > 0).length;

  const officialsSections = (
    <section aria-labelledby="politics-officials-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="politics-officials-title" className="text-heading-lg font-semibold text-foreground">
          Officials
        </h2>
        <p className="text-body-sm text-muted">
          {totalOfficials} elected, {activeParties} active part{activeParties === 1 ? "y" : "ies"},{" "}
          {players.length} player{players.length === 1 ? "" : "s"} based in this{" "}
          {config.regionLabel.toLowerCase()}
        </p>
      </div>
      <div className="mt-4 space-y-6">
        {upperIsMultiSeat ? (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <SenateSection
                state={state}
                senators={upperClass1}
                label={`${upperChamberName} (I)`}
                memberTitle={upperMemberTitle}
                isMultiSeat
              />
              <SenateSection
                state={state}
                senators={upperClass2}
                label={`${upperChamberName} (II)`}
                memberTitle={upperMemberTitle}
                isMultiSeat
              />
            </div>
            <HouseSection
              state={state}
              houseReps={officials.houseReps}
              label={lowerChamberName}
              memberTitle={lowerMemberTitle}
            />
          </>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <SenateSection
              state={state}
              senators={officials.senators}
              label={upperChamberName}
              memberTitle={upperMemberTitle}
              isMultiSeat={upperIsProportional}
              isElected={upperChamber?.elected !== false}
              configuredSeats={upperChamber?.seats ?? 2}
              description={upperChamber?.description}
            />
            <HouseSection
              state={state}
              houseReps={officials.houseReps}
              label={lowerChamberName}
              memberTitle={lowerMemberTitle}
            />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <GovernorSection
            state={state}
            governor={officials.governor}
            label={regionalExecutiveLabel}
            officeType={regionalExecutiveOfficeType}
          />
          <StateSenateSection
            state={state}
            stateSenators={officials.stateSenators}
            label={subNationalName}
          />
        </div>
      </div>
    </section>
  );

  return (
    <div className="space-y-10">
      {isAdmin && state.countryId === "US" ? (
        <AdminRedistrictPanel countryCode={state.countryId} stateId={state._id} />
      ) : null}

      {isParliamentary ? (
        <>
          {officialsSections}
          {leanAndOrg}
        </>
      ) : (
        <>
          {leanAndOrg}
          {officialsSections}
        </>
      )}

      <section aria-labelledby="politics-operations-title" className="space-y-4">
        <h2
          id="politics-operations-title"
          className="text-heading-lg font-semibold text-foreground"
        >
          Party operations
        </h2>
        {agendaBanner}
        {newCardsRow}
        {budgetCardsRow}
        {quickActions}
      </section>

      {state.countryId === "US" ? (
        <StateDistrictsSection
          countryCode={state.countryId}
          stateId={state._id}
          isAdmin={isAdmin}
        />
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <PlayersList state={state} players={players} partyOrg={partyOrg} />
        <NPPsList state={state} npps={npps} partyOrg={partyOrg} />
      </div>
    </div>
  );
}
