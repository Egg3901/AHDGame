"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

/**
 * World Trade Ledger masthead. Follows the institution-masthead grammar
 * (always-dark hero banner with a reserved gold accent, then registry line,
 * title, chips including the verdict, then the fused stat strip), but is
 * bespoke because the shared `InstitutionMasthead` is country-bound and this is
 * a world surface. The banner is intentionally always-dark (matching the
 * Budget / Economy masthead family); the fused stat strip below uses semantic
 * tokens so it tracks all themes. Banner hexes are the isolated raw-color
 * exception.
 */
const GOLD = "#d4af37";
const GOLD_SOFT = "#f4e0b4";

export default function LedgerMasthead({ ledger }: { ledger: WorldTradeLedger }) {
  const { formatAmountChip } = useCurrency();
  const h = ledger.headline;
  const imbalanced = h.verdict === "IMBALANCED";

  const cells: Array<{ label: string; value: string; sub: string; tone?: string }> = [
    {
      label: "World Trade Volume",
      value: formatAmountChip(h.worldVolume),
      sub: "gross exports · per turn",
    },
    {
      label: "Largest Surplus",
      value: h.largestSurplus ? `${formatAmountChip(h.largestSurplus.value)} ▲` : "—",
      sub: h.largestSurplus ? nameOf(ledger, h.largestSurplus.code) : "no surplus",
      tone: "text-success",
    },
    {
      label: "Largest Deficit",
      value: h.largestDeficit ? `${formatAmountChip(h.largestDeficit.value)} ▼` : "—",
      sub: h.largestDeficit ? nameOf(ledger, h.largestDeficit.code) : "no deficit",
      tone: "text-error",
    },
    {
      label: "Balance Split",
      value: `${h.surplusCount} / ${h.deficitCount}`,
      sub: "surplus / deficit nations",
    },
    {
      label: "Most Traded Good",
      value: formatAmountChip(h.mostTradedGood.volume),
      sub: h.mostTradedGood.label,
    },
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-card-border shadow-sm">
      {/* Always-dark registry banner (masthead-family convention). */}
      <div
        className="relative px-5 py-5 sm:px-7"
        style={{
          background: "linear-gradient(135deg, #161320 0%, #221d2e 55%, #2a2233 100%)",
        }}
      >
        <div className="relative flex flex-wrap items-center gap-4">
          <div
            aria-hidden
            className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full"
            style={{
              border: `2px solid ${GOLD}b3`,
              background: "linear-gradient(160deg,#2a2233,#1d1a26)",
            }}
          >
            <span className="font-serif text-3xl font-bold" style={{ color: GOLD }}>
              ₳
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="text-[10px] font-bold uppercase tracking-[0.18em]"
              style={{ color: GOLD_SOFT }}
            >
              World Trade Organisation · Settlement &amp; Customs Registry
            </div>
            <h1 className="mt-1 font-serif text-2xl font-bold text-white sm:text-3xl">
              World Trade Ledger
              <span className="ml-2 align-middle text-sm font-semibold text-white/50">
                balance of trade
              </span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className="rounded-full px-2.5 py-0.5 font-semibold text-white"
                style={{ border: `1px solid ${GOLD}66`, background: `${GOLD}29` }}
              >
                Global rollup
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black px-2.5 py-0.5 font-medium text-white/80">
                <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
                Live · Turn {ledger.turn}
              </span>
              <span className="rounded-full border border-white/10 bg-black px-2.5 py-0.5 font-medium text-white/60">
                Customs clearing record
              </span>
              <span
                className="rounded-full border px-2.5 py-0.5 font-mono font-bold tracking-wide"
                style={{
                  borderColor: `${imbalanced ? GOLD : "#22c55e"}b3`,
                  color: imbalanced ? GOLD : "#22c55e",
                }}
                title="Trade equilibrium"
              >
                {h.verdict}
              </span>
            </div>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
            Reading
          </span>
          <span className="text-[11.5px] text-white/65">
            {h.largestSurplus && h.largestDeficit
              ? `${nameOf(ledger, h.largestSurplus.code)} runs the world's largest surplus against ${nameOf(
                  ledger,
                  h.largestDeficit.code
                )}'s deficit — ${(h.verdictRatio * 100).toFixed(0)}% of volume crosses imbalanced.`
              : "Global accounts net to zero by identity; figures derive from current flows."}
          </span>
        </div>
      </div>

      {/* Fused stat strip — semantic tokens (theme-aware). */}
      <div className="grid grid-cols-2 divide-x divide-card-border border-t border-card-border bg-card-elevated sm:grid-cols-5">
        {cells.map((c) => (
          <div key={c.label} className="flex flex-col gap-1 px-4 py-3">
            <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
              {c.label}
            </span>
            <span
              className={`font-mono text-base font-bold tabular-nums leading-tight ${c.tone ?? "text-foreground"}`}
            >
              {c.value}
            </span>
            <span className="text-[11px] text-muted">{c.sub}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function nameOf(ledger: WorldTradeLedger, code: string): string {
  return ledger.meta.countries.find((c) => c.code === code)?.name ?? code;
}
