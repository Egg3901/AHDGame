"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";
import { directionMark, directionToneClass } from "../lib/ledgerFormat";

/**
 * Trade Balance League — nations ranked by net exports, with a center-split
 * diverging bar (deficit left / surplus right). Direction is shown with ▲▼ and
 * a semantic tone token, never color alone. Country hue is the isolated
 * identity-color exception (seals only).
 */
export default function NationsView({ ledger }: { ledger: WorldTradeLedger }) {
  const { formatAmountChip } = useCurrency();
  const maxNet = Math.max(1, ...ledger.nations.map((n) => Math.abs(n.net)));

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-foreground">
          Trade Balance League <span className="font-normal text-muted">· net exports, ranked</span>
        </h3>
        <span className="text-[10px] text-muted">◀ deficit · surplus ▶</span>
      </div>

      {ledger.nations.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">No nations are trading yet.</p>
      )}

      {ledger.nations.map((n, i) => {
        const pct = ((Math.abs(n.net) / maxNet) * 100).toFixed(1) + "%";
        return (
          <div
            key={n.code}
            className="flex items-center gap-3 border-t border-card-border py-3 first:border-t-0"
          >
            <span className="w-5 text-right font-mono text-xs font-bold text-muted">{i + 1}</span>
            <span
              className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
              style={{ border: `1.5px solid ${n.hue}`, color: n.hue, background: `${n.hue}24` }}
            >
              {n.code}
            </span>
            <div className="w-40 min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{n.name}</div>
              <div className="font-mono text-[10.5px] text-muted">
                exp {formatAmountChip(n.exports)} · imp {formatAmountChip(n.imports)}
              </div>
            </div>
            <div className="flex min-w-[120px] flex-1 items-center">
              <div className="flex flex-1 justify-end">
                <div
                  className="h-3.5 rounded-l-sm bg-error"
                  style={{ width: n.net < 0 ? pct : "0%" }}
                />
              </div>
              <div className="h-6 w-px bg-card-border" />
              <div className="flex flex-1 justify-start">
                <div
                  className="h-3.5 rounded-r-sm bg-success"
                  style={{ width: n.net > 0 ? pct : "0%" }}
                />
              </div>
            </div>
            <span
              className={`inline-flex w-24 items-center justify-end gap-1 text-right font-mono text-sm font-bold tabular-nums ${directionToneClass(
                n.net
              )}`}
            >
              {formatAmountChip(n.net)} {directionMark(n.net)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
