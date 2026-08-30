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
  const leanToPercent = (v: number) => ((v + 5) / 10) * 100;
  const europeanColors = state.countryId === "UK" || state.countryId === "DE";
  const econThumbColor =
    econ < -0.1
      ? europeanColors
        ? "#ef4444"
        : "#3b82f6"
      : econ > 0.1
        ? europeanColors
          ? "#3b82f6"
          : "#ef4444"
        : "#a1a1aa";
  const socThumbColor = soc < -0.1 ? "#2dd4bf" : soc > 0.1 ? "#f59e0b" : "#a1a1aa";

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
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-card-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          Political Lean
        </h2>
        <div className="grid grid-cols-2 gap-5">
          {/* Economic axis */}
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
                Economic
              </p>
              <PositionLabel
                value={econ}
                axis="economic"
                countryId={state.countryId}
                className="text-xs font-semibold"
              />
              <p className="text-[11px] font-mono text-muted">
                {econ >= 0 ? `+${econ.toFixed(2)}` : econ.toFixed(2)}
              </p>
            </div>
            <div>
              <div
                className="relative h-1.5 rounded-full overflow-hidden"
                style={{
                  background: europeanColors
                    ? "linear-gradient(to right, #b91c1c 0%, #ef4444 30%, #71717a 50%, #3b82f6 70%, #1d4ed8 100%)"
                    : "linear-gradient(to right, #1d4ed8 0%, #3b82f6 30%, #71717a 50%, #ef4444 70%, #b91c1c 100%)",
                }}
              >
                <div className="absolute top-0 h-full w-px bg-white/20" style={{ left: "50%" }} />
              </div>
              <div className="relative h-3 -mt-0.5">
                <div
                  className="absolute h-3 w-3 -top-0.5 rounded-full border-2 border-white shadow-md"
                  style={{
                    left: `${leanToPercent(econ)}%`,
                    transform: "translateX(-50%)",
                    backgroundColor: econThumbColor,
                  }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-muted mt-1">
                <span>Left</span>
                <span>Right</span>
              </div>
            </div>
          </div>

          {/* Social axis */}
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
                Social
              </p>
              <PositionLabel value={soc} axis="social" className="text-xs font-semibold" />
              <p className="text-[11px] font-mono text-muted">
                {soc >= 0 ? `+${soc.toFixed(2)}` : soc.toFixed(2)}
              </p>
            </div>
            <div>
              <div
                className="relative h-1.5 rounded-full overflow-hidden"
                style={{
                  background:
                    "linear-gradient(to right, #0d9488 0%, #2dd4bf 30%, #71717a 50%, #f59e0b 70%, #d97706 100%)",
                }}
              >
                <div className="absolute top-0 h-full w-px bg-white/20" style={{ left: "50%" }} />
              </div>
              <div className="relative h-3 -mt-0.5">
                <div
                  className="absolute h-3 w-3 -top-0.5 rounded-full border-2 border-white shadow-md"
                  style={{
                    left: `${leanToPercent(soc)}%`,
                    transform: "translateX(-50%)",
                    backgroundColor: socThumbColor,
                  }}
                />
              </div>
              <div className="flex justify-between text-[9px] text-muted mt-1">
                <span>Liberal</span>
                <span>Trad</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PartyOrgSectorBreakdown partyOrg={partyOrg} />
    </div>
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

  const officialsSections = (
    <>
      {upperIsMultiSeat ? (
        <>
          <div className="grid gap-8 lg:grid-cols-2">
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
        <div className="grid gap-8 lg:grid-cols-2">
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

      <div className="grid gap-8 lg:grid-cols-2">
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
    </>
  );

  // KPI counts for the summary strip
  const totalOfficials =
    officials.senators.length +
    officials.houseReps.length +
    officials.stateSenators.length +
    (officials.governor ? 1 : 0);
  const activeParties = partyOrg.filter((p) => p.organization > 0).length;

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Elected Officials
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground">{totalOfficials}</span>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Active Parties
          </span>
          <span className="text-lg font-bold tabular-nums text-primary">{activeParties}</span>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Political Lean
          </span>
          <div className="mt-0.5">
            <PositionLabel
              value={econ}
              axis="economic"
              countryId={state.countryId}
              className="text-xs font-semibold"
            />
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-muted">
            Players in {config.regionLabel}
          </span>
          <span className="text-lg font-bold tabular-nums text-foreground">{players.length}</span>
        </div>
      </div>

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

      {agendaBanner}
      {newCardsRow}
      {budgetCardsRow}
      {quickActions}

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
