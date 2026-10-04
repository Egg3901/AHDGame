"use client";

import { usePathname } from "next/navigation";
import type { OverviewViewModel, StateOverviewResult } from "@/lib/states/overview/types";
import { buildOverviewViewModel } from "@/lib/states/overview/buildOverviewViewModel";
import { BuildOrgControl } from "./overview/BuildOrgControl";
import { PoolBreakdown, type PoolSlice } from "./overview/PoolBreakdown";
import { EconomySummary } from "./overview/EconomySummary";
import { ContestedPrimariesCard } from "./overview/PrimaryContestCard";
import { RaceWatchlist } from "./overview/RaceWatchlist";
import { RegionalConditionsCard } from "./overview/RegionalConditionsCard";
import { PlayerRoster } from "./overview/PlayerRoster";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

const INDEPENDENT_COLOR = "#9CA3AF";
const EMPTY_POOL_COLOR = "var(--card-border)";

function orgSlices(vm: OverviewViewModel): PoolSlice[] {
  return [
    ...vm.partyOrg.map((p) => ({
      key: p.id,
      label: p.name,
      abbr: p.abbr,
      partyId: p.id,
      color: p.color,
      value: p.orgPct,
    })),
    {
      key: "unaffiliated",
      label: "Unaffiliated",
      color: EMPTY_POOL_COLOR,
      value: vm.unaffiliatedPct,
    },
  ];
}

function registrationSlices(vm: OverviewViewModel): PoolSlice[] {
  const { registrationPool } = vm;
  if (!registrationPool.seeded) return [];
  return [
    ...registrationPool.parties.map((p) => ({
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
      color: EMPTY_POOL_COLOR,
      value: registrationPool.unregistered,
    },
  ];
}

/**
 * The State Overview tab.
 *
 * Main column: party strength (Organization and Registration pools, each a
 * donut and legend that highlight together, with Build Org under the
 * Organization pool), regional conditions when enabled, and the player roster.
 * Side column: economy, close races and contested primaries. Each module is a
 * single card; nothing nests a card inside another.
 *
 * Builds the view-model on each render from the server-fetched
 * `StateOverviewResult` plus the viewing user's `partyId`.
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
  const pathname = usePathname();
  const vm = buildOverviewViewModel(overview, { viewerPartyId });
  const economyHref = `${pathname}?tab=economy&sub=sectors`;

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-8">
        <section
          aria-labelledby="overview-strength-title"
          className="rounded-xl border border-card-border bg-card p-5 sm:p-6"
        >
          <h2
            id="overview-strength-title"
            className="text-heading-lg font-semibold text-foreground"
          >
            Party strength
          </h2>
          <p className="mt-1 text-body text-muted">
            Organization is each party&apos;s ground game here. Registration is who voters have
            signed up with.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-2">
            <PoolBreakdown
              title="Organization"
              slices={orgSlices(vm)}
              focusKey={vm.pieFocusPartyId || null}
              countryId={vm.countryId}
              stateId={vm.stateId}
              emptyMessage="No party has organization in this state yet."
            >
              <BuildOrgControl vm={vm} viewerPartyId={viewerPartyId} />
            </PoolBreakdown>
            <PoolBreakdown
              title="Registration"
              slices={registrationSlices(vm)}
              focusKey={vm.pieFocusPartyId || null}
              countryId={vm.countryId}
              stateId={vm.stateId}
              emptyMessage="Registration has not been seeded for this state yet."
            />
          </div>
        </section>

        {regionalConditionsOverviewEnabled && (
          <RegionalConditionsCard
            countryId={overview.countryId}
            stateId={overview.stateId}
            modifiers={approvalModifiersForOverview}
            approval={regionGovernmentApproval}
            baseApproval={regionApprovalBase}
          />
        )}

        <PlayerRoster countryId={overview.countryId} stateId={overview.stateId} />
      </div>

      <aside className="min-w-0 space-y-6">
        <EconomySummary vm={vm} economyHref={economyHref} />
        <RaceWatchlist vm={vm} />
        <ContestedPrimariesCard vm={vm} />
      </aside>
    </div>
  );
}
