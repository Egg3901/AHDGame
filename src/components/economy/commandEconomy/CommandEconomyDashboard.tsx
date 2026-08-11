"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Tooltip } from "@/components/ui";
import { formatCompactNumber } from "@/lib/utils/formatters";
import { CE_TERMS } from "./glossary";
import type { CommandEconomyDashboard as Dashboard } from "@/lib/economy/commandEconomyDashboard";
import { GosbankChairPanel } from "./GosbankChairPanel";
import { GosplanPlannerPanel } from "./GosplanPlannerPanel";
import { SoeDirectorPanel } from "./SoeDirectorPanel";

interface Props {
  countryId: string;
}

/** 0..1 bar; green at/above 1.0 plan, warning below. */
function FulfillmentBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const under = value < 0.9;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-muted">
      <div
        className={`h-full rounded-full ${under ? "bg-warning/80" : "bg-success/80"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** The marketization dial (0 command … 100 market) with a moving marker. */
function MarketizationGauge({ level }: { level: number }) {
  const pct = Math.max(0, Math.min(100, level));
  return (
    <div className="relative mt-3">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-warning/30 via-info/30 to-success/30" />
      <div
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow"
        style={{ left: `${pct}%` }}
        aria-hidden
      />
      <div className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-muted">
        <span>Command</span>
        <span>Dual-track</span>
        <span>Market</span>
      </div>
    </div>
  );
}

function Driver({
  label,
  value,
  scale,
  hint,
  tone,
  tip,
}: {
  label: string;
  value: string;
  /** Optional small scale anchor rendered under the value (e.g. "-1 to +1"). */
  scale?: string;
  hint: string;
  tone: "up" | "down" | "neutral";
  /** Optional tooltip on the label. */
  tip?: string;
}) {
  const color =
    tone === "up" ? "text-success" : tone === "down" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border bg-card-muted/30 p-3">
      <div className="flex items-center text-[10px] font-bold uppercase tracking-wide text-muted">
        {label}
        {tip && <Tooltip content={tip} label={`About ${label}`} />}
      </div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${color}`}>
        {value}
        {scale && <span className="ml-1 text-[10px] font-normal text-muted">{scale}</span>}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-muted">{hint}</p>
    </div>
  );
}

export function CommandEconomyDashboardView({ countryId }: Props) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/country/${countryId.toLowerCase()}/command-economy`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setData(null);
        setError("This country does not run a command economy.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    load();
  }, [load]);

  async function seatAction(corpId: string, characterId: string | null | undefined) {
    setClaiming(corpId);
    try {
      const body = characterId === undefined ? {} : { characterId };
      await fetch(
        `/api/country/${countryId.toLowerCase()}/command-economy/soe/${corpId}/director`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      await load();
    } finally {
      setClaiming(null);
    }
  }

  if (loading) return <div className="text-sm text-muted">Loading command economy...</div>;
  if (error && !data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 text-sm text-muted">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const roles = data.viewerRoles;
  const canAppoint = roles.isPlanner || roles.isHeadOfGovernment;
  const directedSoes = data.soes.filter((s) => s.viewerIsDirector);
  const drivers = data.drivers;

  return (
    <div className="space-y-6">
      {/* Regime + marketization gauge with its three live drivers */}
      <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-foreground">Command Economy</h2>
            <Badge color={data.regime === "command" ? "warning" : "info"} variant="subtle">
              {data.regimeLabel}
            </Badge>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end text-[10px] font-bold uppercase tracking-wide text-muted">
              Marketization
              <Tooltip content={CE_TERMS.marketization} label="About marketization" />
            </div>
            <div className="text-xl font-bold tabular-nums text-foreground">
              {Math.round(data.marketizationLevel)}
              <span className="text-sm text-muted"> / 100</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Three jobs run this economy: the Gosplan planner sets the quotas, the Gosbank chair
          directs the credit, and each SOE director delivers a plant. Every turn you choose whether
          to reform toward the market, deliver on the plan, or repress the black market to hold the
          line.
        </p>
        <MarketizationGauge level={data.marketizationLevel} />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Driver
            label="Black-market pressure"
            value={`${Math.round(drivers.blackMarketPressure * 100)}`}
            scale="/ 100"
            tone={drivers.blackMarketPressure > 0.4 ? "down" : "neutral"}
            hint="Shortages and the grey market push toward the market."
            tip={CE_TERMS.blackMarketPressure}
          />
          <Driver
            label="Plan fulfillment"
            value={`${Math.round(drivers.soePerformance * 100)}%`}
            tone={drivers.soePerformance >= 0.95 ? "up" : "down"}
            hint="Strong enterprises hold the line. Weak ones invite reform."
          />
          <Driver
            label="Policy stance"
            value={
              drivers.policyStance >= 0
                ? `+${drivers.policyStance.toFixed(2)}`
                : drivers.policyStance.toFixed(2)
            }
            scale="(-1 to +1)"
            tone={drivers.policyStance > 0 ? "up" : drivers.policyStance < 0 ? "down" : "neutral"}
            hint="Reformist government and disciplined credit marketize; orthodoxy entrenches."
          />
        </div>
      </div>

      {/* Role panels the viewer can operate */}
      {(roles.isBankChair || roles.isHeadOfGovernment) && (
        <GosbankChairPanel dashboard={data} onSaved={load} />
      )}
      {(roles.isPlanner || roles.isHeadOfGovernment) && (
        <GosplanPlannerPanel dashboard={data} onSaved={load} />
      )}
      {directedSoes.map((soe) => (
        <SoeDirectorPanel key={soe.corpId} dashboard={data} soe={soe} onSaved={load} />
      ))}

      {/* SOE list with plan-fulfillment bars + seat management */}
      <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-bold text-foreground">State enterprises</h3>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
            {data.plannerName && <span>Planner: {data.plannerName}</span>}
            {data.bankChairName && <span>Gosbank: {data.bankChairName}</span>}
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted">
          Claim a vacant seat to take over an enterprise and unlock its Director panel above, where
          you set its target, labour mix, and investment request.
        </p>
        <div className="mt-3 space-y-3">
          {data.soes.map((s) => (
            <div key={s.corpId} className="rounded-lg border border-card-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-foreground">{s.sectorLabel}</span>
                  <span className="text-[11px] text-muted">{s.corpName}</span>
                  {s.viewerIsDirector && (
                    <Badge color="success" variant="subtle">
                      You direct this
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      s.planFulfillment < 0.9 ? "text-warning" : "text-success"
                    }`}
                  >
                    {Math.round(s.planFulfillment * 100)}%
                  </span>
                  {s.vacant ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={claiming === s.corpId}
                      onClick={() => seatAction(s.corpId, undefined)}
                    >
                      {claiming === s.corpId ? "..." : "Claim seat"}
                    </Button>
                  ) : canAppoint && !s.viewerIsDirector ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={claiming === s.corpId}
                      onClick={() => seatAction(s.corpId, null)}
                    >
                      {claiming === s.corpId ? "..." : "Release"}
                    </Button>
                  ) : (
                    !s.vacant && (
                      <span className="text-[11px] text-muted">{s.directorName ?? "Director"}</span>
                    )
                  )}
                </div>
              </div>
              <div className="mt-2">
                <FulfillmentBar value={s.planFulfillment} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted">
                <span>
                  Output{" "}
                  <span className="tabular-nums text-foreground">
                    {formatCompactNumber(s.output)}
                  </span>
                </span>
                <span>
                  Quota{" "}
                  <span className="tabular-nums text-foreground">
                    {formatCompactNumber(s.planTarget)}
                  </span>
                </span>
                <span>
                  Efficiency{" "}
                  <span className="tabular-nums text-foreground">
                    {Math.round(s.efficiency * 100)}%
                  </span>
                </span>
                {s.directedCreditLastTurn != null && s.directedCreditLastTurn > 0 && (
                  <span>
                    Credit{" "}
                    <span className="tabular-nums text-foreground">
                      {formatCompactNumber(s.directedCreditLastTurn)}
                    </span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CommandEconomyDashboardView;
