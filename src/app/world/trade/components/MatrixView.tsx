"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";
import { directionToneClass } from "../lib/ledgerFormat";

/**
 * Bilateral net-balance matrix: each cell is the row nation's net balance vs.
 * the column nation. Sign drives a semantic success/error tint whose opacity
 * scales with magnitude; the value itself carries the sign so the cell is never
 * color-only. Scrolls horizontally on narrow viewports.
 */
export default function MatrixView({ ledger }: { ledger: WorldTradeLedger }) {
  const { formatAmountChip } = useCurrency();
  const countries = ledger.meta.countries;

  let maxCell = 1;
  for (const a of countries)
    for (const b of countries)
      if (a.code !== b.code)
        maxCell = Math.max(maxCell, Math.abs(ledger.bilateral[a.code]?.[b.code] ?? 0));

  const netByCode = new Map(ledger.nations.map((n) => [n.code, n.net]));

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">
          Bilateral Net-Balance Matrix{" "}
          <span className="font-normal text-muted">· row&rsquo;s balance vs. column</span>
        </h3>
        <span className="inline-flex items-center gap-3 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-success" />
            surplus
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-error" />
            deficit
          </span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[640px] flex-col gap-1">
          {/* Header */}
          <div className="flex items-center gap-1">
            <div className="w-32 flex-shrink-0 pl-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">
              vs →
            </div>
            {countries.map((h) => (
              <div key={h.code} className="flex flex-1 justify-center">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ border: `1.5px solid ${h.hue}`, color: h.hue }}
                >
                  {h.code}
                </div>
              </div>
            ))}
            <div className="w-20 flex-shrink-0 text-right text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted">
              Net
            </div>
          </div>

          {/* Rows */}
          {countries.map((row) => (
            <div key={row.code} className="flex items-center gap-1">
              <div className="flex w-32 flex-shrink-0 items-center gap-2">
                <div
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ border: `1.5px solid ${row.hue}`, color: row.hue }}
                >
                  {row.code}
                </div>
                <span className="truncate text-[11.5px] font-semibold text-foreground">
                  {row.name}
                </span>
              </div>
              {countries.map((col) => {
                if (row.code === col.code) {
                  return (
                    <div
                      key={col.code}
                      className="flex h-10 flex-1 items-center justify-center rounded-md border border-card-border bg-card-elevated font-mono text-[11px] text-muted"
                    >
                      —
                    </div>
                  );
                }
                const v = ledger.bilateral[row.code]?.[col.code] ?? 0;
                const inten = Math.min(1, Math.abs(v) / maxCell);
                const tone = v >= 0 ? "var(--success)" : "var(--error)";
                return (
                  <div
                    key={col.code}
                    title={`${row.name} ${v >= 0 ? "surplus" : "deficit"} with ${col.name}`}
                    className="flex h-10 flex-1 items-center justify-center rounded-md border font-mono text-[11px] font-bold tabular-nums text-foreground"
                    style={{
                      background: `color-mix(in srgb, ${tone} ${(8 + inten * 50).toFixed(0)}%, transparent)`,
                      borderColor: `color-mix(in srgb, ${tone} ${(25 + inten * 30).toFixed(0)}%, transparent)`,
                    }}
                  >
                    {v === 0
                      ? "0"
                      : (v > 0 ? "+" : "−") + abbreviate(formatAmountChip(Math.abs(v)))}
                  </div>
                );
              })}
              <span
                className={`w-20 flex-shrink-0 text-right font-mono text-[12.5px] font-bold tabular-nums ${directionToneClass(
                  netByCode.get(row.code) ?? 0
                )}`}
              >
                {formatAmountChip(netByCode.get(row.code) ?? 0)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Strip a leading currency symbol for the dense matrix cell (sign is shown separately). */
function abbreviate(formatted: string): string {
  return formatted.replace(/^[^\d-]+/, "");
}
