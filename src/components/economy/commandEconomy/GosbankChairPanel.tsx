"use client";

import { useState } from "react";
import { Badge, Button, Slider, Tooltip } from "@/components/ui";
import { formatCompactNumber, formatIndex100 } from "@/lib/utils/formatters";
import { CE_TERMS } from "./glossary";
import type { CommandEconomyDashboard } from "@/lib/economy/commandEconomyDashboard";

interface Props {
  dashboard: CommandEconomyDashboard;
  onSaved: () => void;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Gosbank Chair panel — sets state credit policy: how hard to fund the plan
 * (credit aggressiveness), whether weak enterprises are bailed or allowed to
 * fold (budget softness), and which sectors get the cheap money. Writes the
 * gosbankDirective seam the turn engine honors.
 */
export function GosbankChairPanel({ dashboard, onSaved }: Props) {
  const g = dashboard.gosbank;
  const rep = dashboard.repression;
  const [aggr, setAggr] = useState(Math.round(g.creditAggressiveness * 100));
  const [soft, setSoft] = useState(Math.round(g.budgetSoftness * 100));
  const [repression, setRepression] = useState(Math.round(rep.level * 100));
  const [savingRep, setSavingRep] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);

  async function saveRepression() {
    setSavingRep(true);
    setRepError(null);
    try {
      const res = await fetch(
        `/api/country/${dashboard.countryId.toLowerCase()}/command-economy/repression`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: repression / 100 }),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setRepError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingRep(false);
    }
  }
  const [useSectorCredit, setUseSectorCredit] = useState(!!g.sectorCredit);
  const hasUpkeep = typeof g.upkeepLastTurn === "number" && g.upkeepLastTurn > 0;
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const s of dashboard.soes) {
      seed[s.sector] = g.sectorCredit?.[s.sector] ?? 50;
    }
    return seed;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        creditAggressiveness: aggr / 100,
        budgetSoftness: soft / 100,
      };
      // Send the weights when the chair is picking winners; an empty map clears
      // the override back to automatic allocation.
      body.sectorCredit = useSectorCredit
        ? Object.fromEntries(
            dashboard.soes.map((s) => [s.sector, Math.max(0, weights[s.sector] ?? 0) / 100])
          )
        : {};
      const res = await fetch(
        `/api/country/${dashboard.countryId.toLowerCase()}/command-economy/gosbank`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center text-sm font-bold text-foreground">
          Gosbank Chair
          <Tooltip content={CE_TERMS.gosbank} label="About Gosbank" />
        </h3>
        <Badge color="info" variant="subtle">
          State credit
        </Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">
        Fund the plan with directed credit. Printing money you do not have builds an overhang and
        empties the shelves, so choose your favourites.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">Credit aggressiveness</span>
            <span className="tabular-nums text-muted">{aggr}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            value={aggr}
            onChange={(e) => setAggr(Number(e.target.value))}
          />
          <p className="mt-1 text-[10px] text-muted">
            Restrained on the left, flood the enterprises on the right.
          </p>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center font-semibold text-foreground">
              Budget softness
              <Tooltip content={CE_TERMS.budgetSoftness} label="About budget softness" />
            </span>
            <span className="tabular-nums text-muted">{soft}%</span>
          </div>
          <Slider
            variant="warning"
            min={0}
            max={100}
            value={soft}
            onChange={(e) => setSoft(Number(e.target.value))}
          />
          <p className="mt-1 text-[10px] text-muted">
            Hard budgets let insolvent enterprises fold. Soft budgets bail everyone and keep the
            losses on the books.
          </p>
        </div>

        <div className="rounded-lg border border-card-border bg-card-muted/40 p-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <input
              type="checkbox"
              checked={useSectorCredit}
              onChange={(e) => setUseSectorCredit(e.target.checked)}
            />
            Pick winners by sector
          </label>
          {useSectorCredit ? (
            <div className="mt-3 space-y-2">
              {dashboard.soes.map((s) => (
                <div key={s.sector} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-[11px] text-muted">
                    {s.sectorLabel}
                  </span>
                  <Slider
                    min={0}
                    max={100}
                    value={weights[s.sector] ?? 0}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, [s.sector]: Number(e.target.value) }))
                    }
                  />
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">
                    {weights[s.sector] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1.5 text-[10px] text-muted">
              Off: credit flows automatically toward the sectors missing their plan.
            </p>
          )}
        </div>
      </div>

      <div
        className={`mt-4 grid gap-3 rounded-lg border border-card-border bg-card-muted/30 p-3 text-center ${
          hasUpkeep ? "grid-cols-4" : "grid-cols-3"
        }`}
      >
        <Readout
          label="Overhang"
          value={indexOrNa(g.monetaryOverhang)}
          tip={CE_TERMS.monetaryOverhang}
        />
        <Readout label="Shortage" value={indexOrNa(g.shortageIndex)} tip={CE_TERMS.shortage} />
        <Readout label="Issuance" value={compactOrNa(g.issuanceLastTurn)} tip={CE_TERMS.issuance} />
        {hasUpkeep && (
          <Readout label="Upkeep" value={compactOrNa(g.upkeepLastTurn)} tip={CE_TERMS.upkeep} />
        )}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-warning">{g.costLabel}</p>
      {/* The one thing the lever cannot switch off. Shown only when the floor
          actually paid out, and stated hardest at zero credit, which is where a
          chair would otherwise read the presses as a bug. */}
      {hasUpkeep && (
        <p className="mt-1 text-[11px] leading-snug text-muted">
          {g.creditAggressiveness <= 0
            ? "Credit is set to zero, so none of this is new investment. Enterprises still have to replace plant that wore out, and that bill prints money. To stop it you have to close enterprises, not cut credit."
            : "Part of this credit only replaced plant that wore out. That part is paid whatever you set credit to."}
        </p>
      )}

      {error && <p className="mt-3 text-xs text-error">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Set credit policy"}
        </Button>
        <span className="text-[10px] text-muted">
          Current stance {pct(g.creditAggressiveness)} credit, {pct(g.budgetSoftness)} softness
        </span>
      </div>

      {dashboard.viewerRoles.canSetRepression && (
        <div className="mt-5 rounded-lg border border-card-border bg-card-muted/40 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-bold text-foreground">Internal repression</h4>
            <Badge color="warning" variant="subtle">
              Stay the course
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Force the second economy down to slow reform. It hides the black market, it does not
            fill the shelves, and the harder you push amid shortage the more legitimacy it costs.
          </p>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">Repression level</span>
              <span className="tabular-nums text-muted">{repression}%</span>
            </div>
            <Slider
              variant="warning"
              min={0}
              max={100}
              value={repression}
              onChange={(e) => setRepression(Number(e.target.value))}
            />
            <p className="mt-1 text-[10px] text-muted">None on the left, heavy on the right.</p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-card-border bg-card-muted/30 p-3 text-center">
            <PressureReadout
              base={rep.blackMarketPressureBase}
              effective={rep.blackMarketPressureEffective}
            />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
                Legitimacy cost / turn
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">
                {rep.legitimacyCostPerTurn == null || !Number.isFinite(rep.legitimacyCostPerTurn)
                  ? "n/a"
                  : rep.legitimacyCostPerTurn.toFixed(2)}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-warning">{rep.costLabel}</p>

          {repError && <p className="mt-3 text-xs text-error">{repError}</p>}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={saveRepression} disabled={savingRep}>
              {savingRep ? "Saving..." : "Set repression"}
            </Button>
            <span className="text-[10px] text-muted">In force {pct(rep.level)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PressureReadout({ base, effective }: { base: number | null; effective: number | null }) {
  const fmt = (v: number | null) =>
    v == null || !Number.isFinite(v) ? "n/a" : `${Math.round(v * 100)}%`;
  return (
    <div>
      <div className="flex items-center justify-center text-[10px] font-bold uppercase tracking-wide text-muted">
        Black market pressure
        <Tooltip content={CE_TERMS.blackMarketPressure} label="About black market pressure" />
      </div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">
        {fmt(effective)}
        {base != null && effective != null && base > effective && (
          <span className="ml-1 text-[10px] font-normal text-muted">from {fmt(base)}</span>
        )}
      </div>
    </div>
  );
}

/** 0..100 index readout string, or "n/a" when the metric is missing. */
function indexOrNa(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "n/a" : formatIndex100(value);
}

/** Compact money readout string, or "n/a" when the metric is missing. */
function compactOrNa(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "n/a" : formatCompactNumber(value);
}

function Readout({ label, value, tip }: { label: string; value: string; tip?: string }) {
  return (
    <div>
      <div className="flex items-center justify-center text-[10px] font-bold uppercase tracking-wide text-muted">
        {label}
        {tip && <Tooltip content={tip} label={`About ${label}`} />}
      </div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

export default GosbankChairPanel;
