"use client";

import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload } from "../types";

/**
 * The panel that names the number which kills banks.
 *
 * Everything here already existed inside the engine; none of it was on screen.
 * A bank could walk from green to failed in eight turns while the console
 * showed a confidence score with no threshold attached to it.
 */

const BAND_TONE: Record<"green" | "amber" | "red", string> = {
  green: "text-emerald-500",
  amber: "text-amber-500",
  red: "text-rose-500",
};

function ReserveGauge({
  cash,
  required,
  failAt,
  currency,
}: {
  cash: number;
  required: number;
  failAt: number;
  currency: CurrencyCode;
}) {
  // Scale so the requirement sits at 60% of the track: the failure line and a
  // healthy surplus both stay visible without the bar pinning at either end.
  const scale = Math.max(required / 0.6, cash / 0.95, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;
  const under = cash < failAt;

  return (
    <div className="space-y-2">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-card-border/50">
        <div
          className={`h-full rounded-full ${under ? "bg-rose-500" : cash < required ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: pct(cash) }}
        />
        {/* the run line */}
        <div
          className="absolute inset-y-0 w-0.5 bg-rose-500"
          style={{ left: pct(failAt) }}
          title="Cash below this line fails the bank once its band is red"
        />
        {/* the requirement */}
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground/50"
          style={{ left: pct(required) }}
          title="Reserve requirement"
        />
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted">
        <span>
          cash <span className="font-mono text-foreground">{formatBankMoney(cash, currency)}</span>
        </span>
        <span>
          required{" "}
          <span className="font-mono text-foreground">{formatBankMoney(required, currency)}</span>
        </span>
        <span className="text-rose-500">
          fails under <span className="font-mono">{formatBankMoney(failAt, currency)}</span>
        </span>
      </div>
    </div>
  );
}

export function RiskPanel({
  risk,
  currency,
}: {
  risk: NonNullable<ConsolePayload["risk"]>;
  currency: CurrencyCode;
}) {
  const danger = risk.oneBandFromFailure || (risk.band === "red" && risk.headroomToFailure < 0);

  return (
    <section
      className={`rounded-xl border p-5 space-y-4 ${
        danger ? "border-rose-500/40 bg-rose-500/5" : "border-card-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Run risk</h3>
        <span className={`text-sm font-semibold ${BAND_TONE[risk.band]}`}>
          {risk.band} · {risk.confidence.toFixed(2)}
        </span>
      </div>

      <p className={`text-sm ${danger ? "text-rose-500" : "text-muted"}`}>{risk.verdict}</p>

      <ReserveGauge
        cash={risk.cashReserves}
        required={risk.requiredReserves}
        failAt={risk.runFailureThreshold}
        currency={currency}
      />

      <div className="rounded-lg border border-card-border/60 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-muted">
          What is holding confidence
        </div>
        <div className="space-y-2">
          {risk.terms.map((term) => {
            const share = term.max > 0 ? term.contribution / term.max : 0;
            return (
              <div key={term.key} className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-foreground">{term.label}</span>
                  <span className="font-mono tabular-nums text-muted">
                    {term.contribution.toFixed(2)} / {term.max.toFixed(2)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-border/60">
                  <div
                    className={`h-full rounded-full ${share < 0.4 ? "bg-rose-500" : share < 0.85 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, share * 100)}%` }}
                  />
                </div>
                {share < 0.85 && (
                  <p className="text-[11px] leading-snug text-muted">{term.lever}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
