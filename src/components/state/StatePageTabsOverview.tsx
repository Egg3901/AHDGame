"use client";

import type { OverviewViewModel, StateOverviewResult } from "@/lib/states/overview/types";
import { buildOverviewViewModel } from "@/lib/states/overview/buildOverviewViewModel";
import { AllPartyOrgPie } from "./overview/AllPartyOrgPie";
import { AllPartyRegPie } from "./overview/AllPartyRegPie";
import { PoliticalSummaryCard } from "./overview/PoliticalSummaryCard";
import { PoolLegend, type PoolLegendRow } from "./overview/PoolLegend";
import { EconomySummary } from "./overview/EconomySummary";
import { ContestedPrimariesCard } from "./overview/PrimaryContestCard";
import { RaceWatchlist } from "./overview/RaceWatchlist";
import { RegionalConditionsCard } from "./overview/RegionalConditionsCard";
import { PlayerRoster } from "./overview/PlayerRoster";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

const INDEPENDENT_COLOR = "#9CA3AF";
const UNREGISTERED_COLOR = "var(--card-border)";

function RegistrationLegend({ vm }: { vm: OverviewViewModel }) {
  const { registrationPool } = vm;
  if (!registrationPool.seeded) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Registration Pool
        </div>
        <div className="mt-2 text-sm opacity-70">Registration not yet seeded for this state.</div>
        <div className="mt-1 text-[10px] italic opacity-60">
          Once the bootstrap seed runs, this card shows party Reg shares plus the Independent /
          Unregistered slices that complete the 100% pool.
        </div>
      </div>
    );
  }
  const rows: PoolLegendRow[] = [
    ...registrationPool.parties
      .filter((p) => p.regPct > 0)
      .map((p) => ({
        key: p.id,
        label: p.name,
        abbr: p.abbr,
        partyId: p.id,
        color: p.color,
        value: p.regPct,
      })),
    {
      key: "independent",
      label: "Independent",
      color: INDEPENDENT_COLOR,
      value: registrationPool.independent,
    },
    {
      key: "unregistered",
      label: "Unregistered",
      color: UNREGISTERED_COLOR,
      value: registrationPool.unregistered,
    },
  ].filter((r) => r.value > 0);
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
        Registration Pool
      </div>
      <PoolLegend rows={rows} countryId={vm.countryId} />
    </div>
  );
}

/**
 * Orchestrator for the State Overview tab (Phase 1).
 *
 * Composes:
 *   - KPI strip (Org%, Reg%, GDP, Competitive Races)
 *   - All-party Org pie + Political Summary card
 *   - Economy / Primary Contest / Race Watchlist row
 *
 * Builds the view-model on each render from the server-fetched
 * `StateOverviewResult` plus the viewing user's `partyId`. Pure leaf
 * components below; this orchestrator handles the wiring.
 *
 * See plan Task 1.7.
 */
export function OverviewTab({
  overview,
  viewerPartyId,
  regionalConditionsOverviewEnabled = false,
  approvalModifiersForOverview = [],
  regionGovernmentApproval = null,
  regionApprovalBase = null,
}: {
  overview: StateOverviewResult;
  viewerPartyId: string | null;
  regionalConditionsOverviewEnabled?: boolean;
  approvalModifiersForOverview?: ActiveModifier[];
  regionGovernmentApproval?: number | null;
  regionApprovalBase?: number | null;
}) {
  const vm = buildOverviewViewModel(overview, { viewerPartyId });
  return (
    <div className="flex flex-col gap-4">
      {/* Pies share a row on mobile; summary + legend stack below so rings aren't clipped. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col items-center gap-2">
          <AllPartyOrgPie vm={vm} />
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Org Pool</div>
        </div>
        <div className="flex min-w-0 flex-col items-center gap-2">
          <AllPartyRegPie vm={vm} />
          <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Registration Pool
          </div>
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <PoliticalSummaryCard vm={vm} viewerPartyId={viewerPartyId} />
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <RegistrationLegend vm={vm} />
        </div>
      </div>
      <PlayerRoster countryId={overview.countryId} stateId={overview.stateId} />
      {regionalConditionsOverviewEnabled && (
        <RegionalConditionsCard
          countryId={overview.countryId}
          stateId={overview.stateId}
          modifiers={approvalModifiersForOverview}
          approval={regionGovernmentApproval}
          baseApproval={regionApprovalBase}
        />
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div className="sm:col-span-2 md:col-span-1">
          <EconomySummary vm={vm} />
        </div>
        <ContestedPrimariesCard vm={vm} />
        <RaceWatchlist vm={vm} />
      </div>
    </div>
  );
}
