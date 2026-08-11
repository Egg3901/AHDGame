"use client";

import { useMemo, useState } from "react";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FundHoldingRow } from "./types";

const PIE_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
  "#f97316",
  "#06b6d4",
  "#84cc16",
  "#a855f7",
];

type View = "actual" | "target";

/**
 * Single panel that holds the donut + holdings tables. The toggle swaps the
 * table below the donut between "Actual holdings" (shares, avg cost, value,
 * return, dividends) and "Target index" (target weight, market cap, drift).
 *
 * Holdings and target constituents are joined by corporationId so the actual
 * row can show the target's drift column when needed.
 */
export function ConstituentsPanel({
  holdings,
  targetConstituents,
  formatAmount,
  formatPrice,
  ccy,
}: {
  holdings: FundHoldingRow[];
  targetConstituents: FundHoldingRow[];
  formatAmount: (n: number, c?: CurrencyCode) => string;
  formatPrice: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}) {
  const [view, setView] = useState<View>("actual");

  // Compute totals + per-row weight for the donut and bar.
  const totalHoldingsValue = holdings.reduce(
    (s, h) => s + (h.lastValueAnchor ?? h.shares * (h.avgCostPerShareAnchor ?? 0)),
    0
  );
  const totalTargetWeight = targetConstituents.reduce((s, t) => s + (t.targetWeight ?? 0), 0);

  // Build the joined view once.
  const joined = useMemo(() => {
    const byId = new Map(holdings.map((h) => [h.corporationId, h]));
    const targetById = new Map(targetConstituents.map((t) => [t.corporationId, t]));
    const ids = Array.from(new Set([...byId.keys(), ...targetById.keys()]));
    return ids.map((id) => {
      const h = byId.get(id);
      const t = targetById.get(id);
      const valueAnchor = h ? (h.lastValueAnchor ?? h.shares * (h.avgCostPerShareAnchor ?? 0)) : 0;
      const weightActual = totalHoldingsValue > 0 ? valueAnchor / totalHoldingsValue : 0;
      const weightTarget = t?.targetWeight ?? 0;
      return {
        id,
        corporationName: h?.corporationName ?? t?.corporationName ?? "Unknown",
        tickerSymbol: h?.tickerSymbol ?? t?.tickerSymbol ?? null,
        shares: h?.shares ?? 0,
        avgCostPerShareAnchor: h?.avgCostPerShareAnchor ?? null,
        lastValueAnchor: h?.lastValueAnchor ?? null,
        valueAnchor,
        returnPct: h
          ? computeReturnPct(h.shares, h.avgCostPerShareAnchor, h.lastValueAnchor)
          : null,
        dividendsReceivedAnchor: h?.dividendsReceivedAnchor ?? null,
        targetWeight: weightTarget,
        marketCapAnchor: t?.marketCapAnchor ?? null,
        weightActual,
      };
    });
  }, [holdings, targetConstituents, totalHoldingsValue]);

  // Sort + color so the donut and bars line up.
  const sorted = useMemo(
    () =>
      [...joined].sort(
        (a, b) => (b.weightActual || b.targetWeight) - (a.weightActual || a.targetWeight)
      ),
    [joined]
  );
  const colorFor = (id: string) => {
    const idx = sorted.findIndex((r) => r.id === id);
    return PIE_COLORS[(idx >= 0 ? idx : 0) % PIE_COLORS.length];
  };

  const maxWeight =
    sorted.length === 0
      ? 0
      : Math.max(...sorted.map((r) => Math.max(r.weightActual, r.targetWeight)));

  const totalHoldingsLabel = formatAmount(totalHoldingsValue, ccy);

  return (
    <div className="overflow-hidden rounded-xl border border-card-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-card-border px-5 py-4">
        <h2 className="text-sm font-semibold">Constituents</h2>
        <div className="flex gap-0.5 rounded-lg border border-card-border bg-card-elevated p-0.5">
          {(
            [
              { key: "actual" as const, label: "Actual holdings" },
              { key: "target" as const, label: "Target index" },
            ] as const
          ).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-all ${
                view === v.key
                  ? "border-primary/45 bg-primary/14 text-primary"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Donut + legend */}
      <div className="flex flex-col items-center gap-7 px-5 pb-5 sm:flex-row">
        <DonutChart rows={sorted} totalTargetWeight={totalTargetWeight} />
        <div className="grid w-full flex-1 grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.slice(0, 12).map((r) => (
            <div key={r.id} className="flex min-w-0 items-center gap-2" title={r.corporationName}>
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: colorFor(r.id) }}
                aria-hidden
              />
              <span className="font-mono text-[11px] font-semibold">{r.tickerSymbol ?? "—"}</span>
              <span className="ml-auto font-mono tabular-nums text-[11px] text-muted">
                {(r.weightActual * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tables */}
      {view === "actual" ? (
        <ActualHoldings
          rows={sorted}
          totalHoldingsLabel={totalHoldingsLabel}
          colorFor={colorFor}
          maxWeight={maxWeight}
          formatAmount={formatAmount}
          formatPrice={formatPrice}
          ccy={ccy}
        />
      ) : (
        <TargetHoldings
          rows={sorted}
          colorFor={colorFor}
          maxWeight={maxWeight}
          formatAmount={formatAmount}
        />
      )}
    </div>
  );
}

function computeReturnPct(
  shares: number,
  avgCost: number | null,
  lastValue: number | null
): number | null {
  if (!avgCost || !lastValue || shares <= 0) return null;
  const price = lastValue / shares;
  if (avgCost <= 0) return null;
  return ((price - avgCost) / avgCost) * 100;
}

function DonutChart({
  rows,
  totalTargetWeight,
}: {
  rows: {
    id: string;
    weightActual: number;
    targetWeight: number;
    tickerSymbol: string | null;
    corporationName: string;
  }[];
  totalTargetWeight: number;
}) {
  const size = 168;
  const cx = 90;
  const cy = 90;
  const rOuter = 84;
  const rInner = 54;

  const polar = (deg: number, radius: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
  };
  const arcSeg = (a0: number, a1: number) => {
    if (a1 - a0 <= 0) return null;
    const [ox0, oy0] = polar(a0, rOuter);
    const [ox1, oy1] = polar(a1, rOuter);
    const [ix1, iy1] = polar(a1, rInner);
    const [ix0, iy0] = polar(a0, rInner);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${ox0.toFixed(2)} ${oy0.toFixed(2)} A ${rOuter} ${rOuter} 0 ${large} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)} L ${ix1.toFixed(2)} ${iy1.toFixed(2)} A ${rInner} ${rInner} 0 ${large} 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)} Z`;
  };

  // Renormalize to whatever non-zero rows we have so the donut fills the full
  // 360° sweep. Falls back to target weight when actual weight is zero (e.g.
  // a target that's not yet held).
  const total = rows.reduce((s, r) => s + (r.weightActual > 0 ? r.weightActual : 0), 0);
  const fillFromActual = total > 0;
  const fallbackTotal = totalTargetWeight > 0 ? totalTargetWeight : rows.length;
  const denom = fillFromActual ? total : fallbackTotal;

  const segs: { d: string; color: string; ticker: string; name: string }[] = [];
  let acc = 0;
  rows.forEach((r, i) => {
    const w = fillFromActual ? r.weightActual : r.targetWeight;
    if (w <= 0) return;
    const a0 = (acc / denom) * 360;
    acc += w;
    const a1 = (acc / denom) * 360 - 0.4; // small gap between slices
    const d = arcSeg(a0, a1);
    if (!d) return;
    segs.push({
      d,
      color: PIE_COLORS[i % PIE_COLORS.length],
      ticker: r.tickerSymbol ?? "—",
      name: r.corporationName,
    });
  });

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label="Constituent weights"
    >
      <svg
        viewBox={`0 0 ${size + 24} ${size + 24}`}
        className="block"
        style={{ width: size, height: size }}
      >
        {segs.map((s, i) => (
          <path key={i} d={s.d} fill={s.color} stroke="var(--card)" strokeWidth={1.5} />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-bold">{rows.length}</span>
        <span className="text-[10px] uppercase tracking-widest text-muted">holdings</span>
      </div>
    </div>
  );
}

// ── Actual holdings ────────────────────────────────────────────────────────

type ActualRow = {
  id: string;
  corporationName: string;
  tickerSymbol: string | null;
  shares: number;
  avgCostPerShareAnchor: number | null;
  lastValueAnchor: number | null;
  valueAnchor: number;
  returnPct: number | null;
  dividendsReceivedAnchor: number | null;
  weightActual: number;
};

function ActualHoldings({
  rows,
  totalHoldingsLabel,
  colorFor,
  maxWeight,
  formatAmount,
  formatPrice,
  ccy,
}: {
  rows: ActualRow[];
  totalHoldingsLabel: string;
  colorFor: (id: string) => string;
  maxWeight: number;
  formatAmount: (n: number, c?: CurrencyCode) => string;
  formatPrice: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}) {
  return (
    <div className="border-t border-card-border">
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <div className="min-w-[680px]">
          <div
            className="grid items-center gap-3 bg-card-elevated px-5 py-2.5"
            style={{ gridTemplateColumns: "26px minmax(0,1.5fr) 150px 90px 90px 100px 80px 90px" }}
          >
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              #
            </span>
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Corporation
            </span>
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Weight
            </span>
            <span className="text-right text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Shares
            </span>
            <span className="text-right text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Avg cost
            </span>
            <span className="text-right text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Value
            </span>
            <span className="text-right text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Return
            </span>
            <span className="text-right text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Dividends
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted">No active holdings.</div>
          ) : (
            rows.map((r, i) => (
              <ActualDesktopRow
                key={r.id}
                r={r}
                i={i}
                colorFor={colorFor}
                maxWeight={maxWeight}
                formatAmount={formatAmount}
                formatPrice={formatPrice}
                ccy={ccy}
              />
            ))
          )}
          {rows.length > 0 && (
            <div className="flex justify-between border-t border-card-border bg-card-elevated px-5 py-2.5 text-[11px] text-muted">
              <span>Total holdings value</span>
              <span className="font-mono tabular-nums font-semibold text-foreground">
                {totalHoldingsLabel}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="block sm:hidden">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">No active holdings.</div>
        ) : (
          <div className="divide-y divide-card-border">
            {rows.map((r, i) => (
              <ActualMobileCard
                key={r.id}
                r={r}
                i={i}
                colorFor={colorFor}
                maxWeight={maxWeight}
                formatAmount={formatAmount}
                formatPrice={formatPrice}
                ccy={ccy}
              />
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className="flex justify-between border-t border-card-border bg-card-elevated px-5 py-2.5 text-[11px] text-muted">
            <span>Total holdings value</span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {totalHoldingsLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ActualDesktopRow({
  r,
  i,
  colorFor,
  maxWeight,
  formatAmount,
  formatPrice,
  ccy,
}: {
  r: ActualRow;
  i: number;
  colorFor: (id: string) => string;
  maxWeight: number;
  formatAmount: (n: number, c?: CurrencyCode) => string;
  formatPrice: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}) {
  const price = r.shares > 0 && r.lastValueAnchor != null ? r.lastValueAnchor / r.shares : null;
  const retColor =
    r.returnPct == null ? "var(--muted)" : r.returnPct >= 0 ? "var(--success)" : "var(--error)";
  const barPct = maxWeight > 0 ? (r.weightActual / maxWeight) * 100 : 0;
  return (
    <div
      className="grid items-center gap-3 border-t border-card-border px-5 py-2.5 transition-colors hover:bg-card-elevated"
      style={{
        gridTemplateColumns: "26px minmax(0,1.5fr) 150px 90px 90px 100px 80px 90px",
      }}
    >
      <span className="font-mono text-[11px] text-muted">{i + 1}</span>
      <NameCell corporationName={r.corporationName} tickerSymbol={r.tickerSymbol} />
      <WeightBar weight={r.weightActual} barPct={barPct} color={colorFor(r.id)} />
      <span className="text-right font-mono tabular-nums text-xs">
        {r.shares.toLocaleString("en-US")}
      </span>
      <span className="text-right font-mono tabular-nums text-xs text-muted">
        {r.avgCostPerShareAnchor != null && price != null
          ? formatPrice(r.avgCostPerShareAnchor, ccy)
          : "—"}
      </span>
      <span className="text-right font-mono tabular-nums text-xs font-semibold">
        {formatAmount(r.valueAnchor, ccy)}
      </span>
      <span
        className="text-right font-mono tabular-nums text-xs font-semibold"
        style={{ color: retColor }}
      >
        {r.returnPct == null ? "—" : `${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(1)}%`}
      </span>
      <span className="text-right font-mono tabular-nums text-xs text-muted">
        {r.dividendsReceivedAnchor ? formatAmount(r.dividendsReceivedAnchor, ccy) : "—"}
      </span>
    </div>
  );
}

function ActualMobileCard({
  r,
  i,
  colorFor,
  maxWeight,
  formatAmount,
  formatPrice,
  ccy,
}: {
  r: ActualRow;
  i: number;
  colorFor: (id: string) => string;
  maxWeight: number;
  formatAmount: (n: number, c?: CurrencyCode) => string;
  formatPrice: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}) {
  const price = r.shares > 0 && r.lastValueAnchor != null ? r.lastValueAnchor / r.shares : null;
  const retColor =
    r.returnPct == null ? "var(--muted)" : r.returnPct >= 0 ? "var(--success)" : "var(--error)";
  const barPct = maxWeight > 0 ? (r.weightActual / maxWeight) * 100 : 0;
  return (
    <div className="px-5 py-3 transition-colors hover:bg-card-elevated">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-muted">{i + 1}</span>
        <NameCell corporationName={r.corporationName} tickerSymbol={r.tickerSymbol} />
      </div>
      <div className="mt-2">
        <WeightBar weight={r.weightActual} barPct={barPct} color={colorFor(r.id)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <MobileMetric label="Shares" value={r.shares.toLocaleString("en-US")} />
        <MobileMetric
          label="Avg cost"
          value={
            r.avgCostPerShareAnchor != null && price != null
              ? formatPrice(r.avgCostPerShareAnchor, ccy)
              : "—"
          }
        />
        <MobileMetric
          label="Value"
          value={formatAmount(r.valueAnchor, ccy)}
          valueClass="font-semibold"
        />
        <MobileMetric
          label="Return"
          value={
            r.returnPct == null ? "—" : `${r.returnPct >= 0 ? "+" : ""}${r.returnPct.toFixed(1)}%`
          }
          valueStyle={{ color: retColor }}
          valueClass="font-semibold"
        />
        <MobileMetric
          label="Dividends"
          value={r.dividendsReceivedAnchor ? formatAmount(r.dividendsReceivedAnchor, ccy) : "—"}
        />
      </div>
    </div>
  );
}

// ── Target holdings ────────────────────────────────────────────────────────

type TargetRow = {
  id: string;
  corporationName: string;
  tickerSymbol: string | null;
  targetWeight: number;
  marketCapAnchor: number | null;
  weightActual: number;
};

function TargetHoldings({
  rows,
  colorFor,
  maxWeight,
  formatAmount,
}: {
  rows: TargetRow[];
  colorFor: (id: string) => string;
  maxWeight: number;
  formatAmount: (n: number, c?: CurrencyCode) => string;
}) {
  return (
    <div className="border-t border-card-border">
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <div className="min-w-[520px]">
          <div
            className="grid items-center gap-3 bg-card-elevated px-5 py-2.5"
            style={{ gridTemplateColumns: "26px minmax(0,1.5fr) 170px 110px 110px" }}
          >
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              #
            </span>
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Corporation
            </span>
            <span className="text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Target weight
            </span>
            <span className="text-right text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Market cap
            </span>
            <span className="text-right text-[9.5px] font-semibold uppercase tracking-wider text-muted">
              Drift vs actual
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted">No target constituents.</div>
          ) : (
            rows.map((r, i) => (
              <TargetDesktopRow
                key={r.id}
                r={r}
                i={i}
                colorFor={colorFor}
                maxWeight={maxWeight}
                formatAmount={formatAmount}
              />
            ))
          )}
          <div className="border-t border-card-border px-5 py-2.5 text-[11px] text-muted">
            Drift is actual weight minus the index target. The fund trades toward target at each
            rebalance.
          </div>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="block sm:hidden">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">No target constituents.</div>
        ) : (
          <div className="divide-y divide-card-border">
            {rows.map((r, i) => (
              <TargetMobileCard
                key={r.id}
                r={r}
                i={i}
                colorFor={colorFor}
                maxWeight={maxWeight}
                formatAmount={formatAmount}
              />
            ))}
          </div>
        )}
        <div className="border-t border-card-border px-5 py-2.5 text-[11px] text-muted">
          Drift is actual weight minus the index target. The fund trades toward target at each
          rebalance.
        </div>
      </div>
    </div>
  );
}

function TargetDesktopRow({
  r,
  i,
  colorFor,
  maxWeight,
  formatAmount,
}: {
  r: TargetRow;
  i: number;
  colorFor: (id: string) => string;
  maxWeight: number;
  formatAmount: (n: number, c?: CurrencyCode) => string;
}) {
  const drift = r.weightActual - r.targetWeight;
  const driftPts = drift * 100;
  const driftColor =
    Math.abs(driftPts) < 0.05 ? "var(--muted)" : driftPts > 0 ? "var(--warning)" : "var(--info)";
  const barPct = maxWeight > 0 ? (r.targetWeight / maxWeight) * 100 : 0;
  return (
    <div
      className="grid items-center gap-3 border-t border-card-border px-5 py-2.5 transition-colors hover:bg-card-elevated"
      style={{ gridTemplateColumns: "26px minmax(0,1.5fr) 170px 110px 110px" }}
    >
      <span className="font-mono text-[11px] text-muted">{i + 1}</span>
      <NameCell corporationName={r.corporationName} tickerSymbol={r.tickerSymbol} />
      <WeightBar weight={r.targetWeight} barPct={barPct} color={colorFor(r.id)} />
      <span className="text-right font-mono tabular-nums text-xs">
        {r.marketCapAnchor != null ? formatAmount(r.marketCapAnchor) : "—"}
      </span>
      <span
        className="text-right font-mono tabular-nums text-xs font-semibold"
        style={{ color: driftColor }}
      >
        {driftPts >= 0 ? "+" : "−"}
        {Math.abs(driftPts).toFixed(1)} pts
      </span>
    </div>
  );
}

function TargetMobileCard({
  r,
  i,
  colorFor,
  maxWeight,
  formatAmount,
}: {
  r: TargetRow;
  i: number;
  colorFor: (id: string) => string;
  maxWeight: number;
  formatAmount: (n: number, c?: CurrencyCode) => string;
}) {
  const drift = r.weightActual - r.targetWeight;
  const driftPts = drift * 100;
  const driftColor =
    Math.abs(driftPts) < 0.05 ? "var(--muted)" : driftPts > 0 ? "var(--warning)" : "var(--info)";
  const barPct = maxWeight > 0 ? (r.targetWeight / maxWeight) * 100 : 0;
  return (
    <div className="px-5 py-3 transition-colors hover:bg-card-elevated">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] text-muted">{i + 1}</span>
        <NameCell corporationName={r.corporationName} tickerSymbol={r.tickerSymbol} />
      </div>
      <div className="mt-2">
        <WeightBar weight={r.targetWeight} barPct={barPct} color={colorFor(r.id)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <MobileMetric
          label="Market cap"
          value={r.marketCapAnchor != null ? formatAmount(r.marketCapAnchor) : "—"}
        />
        <MobileMetric
          label="Drift"
          value={`${driftPts >= 0 ? "+" : "−"}${Math.abs(driftPts).toFixed(1)} pts`}
          valueStyle={{ color: driftColor }}
          valueClass="font-semibold"
        />
      </div>
    </div>
  );
}

// ── Shared cells ───────────────────────────────────────────────────────────

function NameCell({
  corporationName,
  tickerSymbol,
}: {
  corporationName: string;
  tickerSymbol: string | null;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="truncate text-[12.5px] font-semibold">{corporationName}</span>
      {tickerSymbol && (
        <span className="shrink-0 font-mono text-[10.5px] font-semibold text-primary">
          {tickerSymbol}
        </span>
      )}
    </div>
  );
}

function WeightBar({ weight, barPct, color }: { weight: number; barPct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: color }} />
      </div>
      <span className="w-[42px] shrink-0 text-right font-mono tabular-nums text-[11.5px]">
        {(weight * 100).toFixed(1)}%
      </span>
    </div>
  );
}

function MobileMetric({
  label,
  value,
  valueClass = "",
  valueStyle,
}: {
  label: string;
  value: string;
  valueClass?: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <span className={`font-mono tabular-nums ${valueClass}`} style={valueStyle}>
        {value}
      </span>
    </div>
  );
}
