"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  MilitaryUnitView,
  ForceSummaryView,
  ManpowerView,
  ArsenalView,
  DefenceContractView,
  DefenceSupplierView,
} from "../../useCabinetOffice";
import type { CommanderRef } from "@/lib/military/types";
import { MilitaryRosterTab } from "./MilitaryRosterTab";
import { MilitaryBudgetTab } from "./MilitaryBudgetTab";
import { MilitaryOperationsTab } from "./MilitaryOperationsTab";
import { ArsenalTab } from "./ArsenalTab";
import { NuclearTab, type NuclearStatusView } from "./NuclearTab";
import { CovertPanel, type CovertStatusView } from "./CovertPanel";
import { NUCLEAR_CAPABLE } from "@/lib/military/nuclearProgram";
import { COVERT_CAPABLE, type CovertFunding } from "@/lib/military/covertNuclear";

type SubTab = "military" | "arsenal" | "nuclear" | "budget" | "operations";
const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "military", label: "Military" },
  { id: "arsenal", label: "Arsenal" },
  { id: "nuclear", label: "Nuclear" },
  { id: "budget", label: "Budget" },
  { id: "operations", label: "Operations" },
];

export function MilitaryFlagship({
  countryCode,
  countryId,
  positionId,
  units,
  forceSummary,
  commanders,
  manpower,
  arsenal,
  contracts,
  suppliers,
  lotPricePerLot,
  canAct,
  currencySymbol,
  onUpdate,
  liveYear = null,
}: {
  countryCode: string;
  countryId: string;
  positionId: string;
  units: MilitaryUnitView[];
  forceSummary: ForceSummaryView;
  commanders: CommanderRef[];
  manpower?: ManpowerView;
  /** The national materiel store and the contracts filling it (defence seat only). */
  arsenal?: ArsenalView;
  contracts?: DefenceContractView[];
  /** Plants that could take a new contract, and the going rate per lot. */
  suppliers?: DefenceSupplierView[];
  lotPricePerLot?: number | null;
  canAct: boolean;
  currencySymbol: string;
  onUpdate: () => void;
  /** Live in-game year for era-gated branches (null = modern catalog). */
  liveYear?: number | null;
}) {
  const [tab, setTab] = useState<SubTab>("military");
  const [busy, setBusy] = useState(false);
  const [contractError, setContractError] = useState<string | null>(null);

  // The nuclear tab exists only for countries in the era's capable set OR the
  // covert set; everyone else never sees it and never fetches a programme.
  const nuclearCapable = (NUCLEAR_CAPABLE as readonly string[]).includes(countryId);
  const covertCapable = (COVERT_CAPABLE as readonly string[]).includes(countryId);
  const [nuclear, setNuclear] = useState<NuclearStatusView | undefined>(undefined);
  const [covert, setCovert] = useState<CovertStatusView | undefined>(undefined);
  const [nuclearError, setNuclearError] = useState<string | null>(null);

  const refreshNuclear = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/nuclear`
      );
      if (!res.ok) return;
      setNuclear((await res.json()) as NuclearStatusView);
    } catch {
      // A failed status read leaves the loading card; mutations surface their own errors.
    }
  }, [countryCode, positionId]);

  const refreshCovert = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/nuclear/covert`
      );
      if (!res.ok) return;
      setCovert((await res.json()) as CovertStatusView);
    } catch {
      // Same posture as the overt read: leave the loading card.
    }
  }, [countryCode, positionId]);

  useEffect(() => {
    // A covert-set country fetches BOTH: the overt GET's widened eligibility
    // decides whether the post-breakout tree renders alongside the panel.
    if (nuclearCapable || covertCapable) void refreshNuclear();
    if (covertCapable) void refreshCovert();
  }, [nuclearCapable, covertCapable, refreshNuclear, refreshCovert]);

  /** Shared POST plumbing for the three nuclear mutations. */
  async function nuclearPost(path: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setNuclearError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/nuclear/${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        // The route refuses for reasons the tab cannot pre-empt - a drained
        // appropriation, a lost seat - so surface its own wording.
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setNuclearError(payload?.error ?? "That order could not be given.");
        return false;
      }
      await refreshNuclear();
      if (covertCapable) await refreshCovert();
      onUpdate();
      return true;
    } catch {
      setNuclearError("That request could not be sent.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function awardContract(
    sectorId: string,
    lotsOrdered: number,
    // Suggestion #291/#292. Both optional: omitting them reproduces the old behaviour exactly,
    // a fair computed price at the supplier's own grade ceiling.
    options?: { pricePerLot?: number; gradeCeiling?: number; component?: string }
  ) {
    setBusy(true);
    setContractError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/defence-contracts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectorId,
            lotsOrdered,
            ...(options?.pricePerLot != null ? { pricePerLot: options.pricePerLot } : {}),
            ...(options?.gradeCeiling != null ? { gradeCeiling: options.gradeCeiling } : {}),
            ...(options?.component != null ? { component: options.component } : {}),
          }),
        }
      );
      if (!res.ok) {
        // The route refuses for reasons the form cannot pre-empt — a re-tooled plant, a lost
        // seat, a country whose GDP went unusable between render and submit. Surface its own
        // wording rather than a generic failure.
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setContractError(payload?.error ?? "That contract could not be awarded.");
        return false;
      }
      onUpdate();
      return true;
    } catch {
      setContractError("That request could not be sent.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cancelContract(contractId: string) {
    setBusy(true);
    setContractError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/defence-contracts?contractId=${encodeURIComponent(contractId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        // Silence would read as a dead button — the route refuses for reasons the panel
        // cannot infer (a lost seat, an already-closed contract).
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setContractError(payload?.error ?? "That contract could not be cancelled.");
        return;
      }
      onUpdate();
    } catch {
      setContractError("That request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-card-border bg-card p-0.5">
        {SUB_TABS.filter((t) => t.id !== "nuclear" || nuclearCapable || covertCapable).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
              tab === t.id
                ? "bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] text-gov-soft"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "military" && (
        <MilitaryRosterTab
          countryCode={countryCode}
          countryId={countryId}
          positionId={positionId}
          units={units}
          commanders={commanders}
          canAct={canAct}
          currencySymbol={currencySymbol}
          gdp={forceSummary.gdp}
          baselineGdp={forceSummary.militaryPriceBaselineGdp}
          hasBudget={forceSummary.hasBudget}
          appropriation={forceSummary.appropriation}
          appropriationNetPerTurn={
            forceSummary.appropriationAccrual - forceSummary.appropriationUpkeep
          }
          arrearsRatio={forceSummary.arrearsRatio}
          upkeepPerIndexUnit={
            forceSummary.totalUpkeep > 0
              ? forceSummary.appropriationUpkeep / forceSummary.totalUpkeep
              : 0
          }
          manpowerPool={manpower?.pool}
          onUpdate={onUpdate}
          liveYear={liveYear}
        />
      )}
      {contractError && (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-2.5 text-[12px] text-foreground">
          {contractError}
        </div>
      )}

      {tab === "arsenal" && (
        <ArsenalTab
          arsenal={arsenal}
          contracts={contracts}
          suppliers={suppliers}
          lotPricePerLot={lotPricePerLot}
          units={units}
          currencySymbol={currencySymbol}
          canAct={canAct}
          busy={busy}
          onAwardContract={awardContract}
          onCancelContract={cancelContract}
        />
      )}
      {tab === "nuclear" && (nuclearCapable || covertCapable) && (
        <>
          {nuclearError && (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-2.5 text-[12px] text-foreground">
              {nuclearError}
            </div>
          )}
          {covertCapable && (
            <CovertPanel
              status={covert}
              currencySymbol={currencySymbol}
              canAct={canAct}
              busy={busy}
              onSetFunding={(funding: CovertFunding) => nuclearPost("covert/funding", { funding })}
              onBreakout={() => nuclearPost("covert/breakout", {})}
            />
          )}
          {/* A covert-set country sees the overt tree only once it HAS an overt
              programme: the GET route's widened eligibility flips capable on
              after the breakout, and the locked-gates card before it would
              only advertise a tree the DDR is not supposed to have. */}
          {(nuclearCapable || nuclear?.eligibility.capable === true) && (
            <NuclearTab
              status={nuclear}
              currencySymbol={currencySymbol}
              canAct={canAct}
              busy={busy}
              onConductTest={(nodeKey) => nuclearPost("test", { nodeKey })}
              onAdoptDelivery={(nodeKey) => nuclearPost("adopt", { nodeKey })}
              onSetProduction={(rate) => nuclearPost("production", { rate })}
            />
          )}
        </>
      )}
      {tab === "budget" && (
        <MilitaryBudgetTab
          countryId={countryId}
          units={units}
          forceSummary={forceSummary}
          currencySymbol={currencySymbol}
          liveYear={liveYear}
        />
      )}
      {tab === "operations" && (
        <MilitaryOperationsTab
          units={units}
          manpower={manpower}
          countryCode={countryCode}
          positionId={positionId}
          canWrite={canAct}
        />
      )}
    </div>
  );
}
