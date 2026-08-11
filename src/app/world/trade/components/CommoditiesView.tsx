"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

/**
 * Commodity Flows — each tradeable good with its top net importer (left) and
 * top net exporter (right), ranked by world traded volume. Country hue is the
 * isolated identity-color exception (seals only); surplus/deficit use semantic
 * success/error tokens.
 */
export default function CommoditiesView({ ledger }: { ledger: WorldTradeLedger }) {
  const { formatAmountChip } = useCurrency();
  const hueOf = (code: string) => ledger.meta.countries.find((c) => c.code === code)?.hue ?? "#888";

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">
          Commodity Flows{" "}
          <span className="font-normal text-muted">· who the world is long &amp; short</span>
        </h3>
        <span className="text-[10px] text-muted">top net importer ◀ · ▶ top net exporter</span>
      </div>

      {ledger.commodities.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">No commodities are trading yet.</p>
      )}

      {ledger.commodities.map((c) => {
        const im = c.topImporter;
        const ex = c.topExporter;
        const mx = Math.max(1, Math.abs(im?.net ?? 0), Math.abs(ex?.net ?? 0));
        const imPct = im ? ((Math.abs(im.net) / mx) * 100).toFixed(1) + "%" : "0%";
        const exPct = ex ? ((Math.abs(ex.net) / mx) * 100).toFixed(1) + "%" : "0%";
        return (
          <div
            key={c.key}
            className="flex items-center gap-3 border-t border-card-border py-3 first:border-t-0"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-card-border bg-card-elevated font-mono text-[11px] font-bold text-primary">
              {c.icon}
            </span>
            <div className="w-44 min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{c.label}</div>
              <div className="font-mono text-[10.5px] text-muted">
                traded {formatAmountChip(c.worldVolume)}
              </div>
            </div>
            <div className="flex w-20 items-center justify-end gap-1.5">
              <span className="font-mono text-[11.5px] font-bold text-error">
                {im ? formatAmountChip(im.net) : "—"}
              </span>
              {im && (
                <span
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ border: `1.5px solid ${hueOf(im.code)}`, color: hueOf(im.code) }}
                >
                  {im.code}
                </span>
              )}
            </div>
            <div className="flex min-w-[100px] flex-1 items-center">
              <div className="flex flex-1 justify-end">
                <div className="h-3 rounded-l-sm bg-error" style={{ width: imPct }} />
              </div>
              <div className="h-5 w-px bg-card-border" />
              <div className="flex flex-1 justify-start">
                <div className="h-3 rounded-r-sm bg-success" style={{ width: exPct }} />
              </div>
            </div>
            <div className="flex w-20 items-center justify-start gap-1.5">
              {ex && (
                <span
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ border: `1.5px solid ${hueOf(ex.code)}`, color: hueOf(ex.code) }}
                >
                  {ex.code}
                </span>
              )}
              <span className="font-mono text-[11.5px] font-bold text-success">
                {ex ? formatAmountChip(ex.net) : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
