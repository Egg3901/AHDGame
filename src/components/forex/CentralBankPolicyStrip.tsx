"use client";

import type { ExchangeRateDisplay } from "@/app/country/[code]/forex/types";

interface Props {
  rates: ExchangeRateDisplay[];
  currentTurn: number;
}

/**
 * Public strip showing currently-posted Central Bank intervention bands.
 * Reserve numbers and per-turn spend amounts are deliberately hidden here — see the
 * Chair-only CentralBankInterventionTab for those.
 */
export function CentralBankPolicyStrip({ rates, currentTurn }: Props) {
  const withBands = rates.filter((r) => r.interventionBand != null);
  if (withBands.length === 0) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
        Central Bank Policy
      </h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {withBands.map((r) => {
          const band = r.interventionBand!;
          const turnsSince = currentTurn - band.setAtTurn;
          return (
            <div
              key={r.currencyCode}
              className="rounded border border-card-border px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{r.currencyCode}</span>
                {band.defending ? (
                  <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                    Defending
                  </span>
                ) : (
                  <span className="text-xs text-green-400">In band</span>
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-muted">
                Band: [{band.floor.toFixed(4)}, {band.ceiling.toFixed(4)}]
              </p>
              <p className="text-xs text-muted">
                Posted {turnsSince} turn{turnsSince === 1 ? "" : "s"} ago
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
