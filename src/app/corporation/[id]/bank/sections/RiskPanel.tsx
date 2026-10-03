"use client";

import { Tooltip } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload } from "../types";
import { Td, Th } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

/**
 * The panel that names the number which kills banks.
 *
 * Everything here already existed inside the engine; none of it was on screen.
 * A bank could walk from green to failed in eight turns while the console
 * showed a confidence score with no threshold attached to it.
 */

const BAND_TONE: Record<"green" | "amber" | "red", string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-error",
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
    <div className="space-y-1">
      <div className="relative h-2 w-full overflow-hidden rounded-sm bg-card-border/60">
        <div
          className={`h-full ${under ? "bg-error" : cash < required ? "bg-warning" : "bg-success"}`}
          style={{ width: pct(cash) }}
        />
        {/* the run line */}
        <div
          className="absolute inset-y-0 w-0.5 bg-error"
          style={{ left: pct(failAt) }}
          title="Cash below this line fails the bank once its band is red"
        />
        {/* the requirement */}
        <div
          className="absolute inset-y-0 w-0.5 bg-foreground/60"
          style={{ left: pct(required) }}
          title="Reserve requirement"
        />
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 text-[11px] text-muted">
        <span>
          cash <span className="font-mono text-foreground">{formatBankMoney(cash, currency)}</span>
        </span>
        <span>
          required{" "}
          <span className="font-mono text-foreground">{formatBankMoney(required, currency)}</span>
        </span>
        <span className="text-error">
          fails under <span className="font-mono">{formatBankMoney(failAt, currency)}</span>
        </span>
      </div>
    </div>
  );
}

export function RiskPanel({
  risk,
  currency,
  pointerDeposits,
}: {
  risk: NonNullable<ConsolePayload["risk"]>;
  currency: CurrencyCode;
  /** Player savings pointed at the bank: excluded from every denominator below. */
  pointerDeposits?: number | null;
}) {
  const danger = risk.oneBandFromFailure || (risk.band === "red" && risk.headroomToFailure < 0);

  return (
    <BankPanel
      kind="monitor"
      title="Run risk"
      actions={
        <span className={`font-mono text-xs font-medium ${BAND_TONE[risk.band]}`}>
          {risk.band}, {risk.confidence.toFixed(2)}
        </span>
      }
    >
      <div className="space-y-2 py-1.5">
        <p className={`text-xs ${danger ? "font-medium text-error" : "text-muted"}`}>
          {risk.verdict}
        </p>

        <ReserveGauge
          cash={risk.cashReserves}
          required={risk.requiredReserves}
          failAt={risk.runFailureThreshold}
          currency={currency}
        />
        <p className="text-[11px] text-muted">
          Denominators count household cash only
          {pointerDeposits != null && pointerDeposits > 0
            ? `: ${formatBankMoney(pointerDeposits, currency)} of player savings pointed here never arrived as cash, so it sits outside reserves, equity, and the run line`
            : "."}
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th>What is holding confidence</Th>
            <Th align="right">Contribution</Th>
            <Th className="w-1/3">
              <span className="sr-only">Share of maximum</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {risk.terms.map((term) => {
            const share = term.max > 0 ? term.contribution / term.max : 0;
            return (
              <tr key={term.key}>
                <Td className="text-foreground">
                  {term.label}
                  <Tooltip content={term.lever} label={`How to move ${term.label}`} />
                </Td>
                <Td align="right" className="text-muted">
                  {term.contribution.toFixed(2)} / {term.max.toFixed(2)}
                </Td>
                <Td numeric={false}>
                  <div className="h-1.5 w-full overflow-hidden rounded-sm bg-card-border/60">
                    <div
                      className={`h-full ${share < 0.4 ? "bg-error" : share < 0.85 ? "bg-warning" : "bg-success"}`}
                      style={{ width: `${Math.min(100, share * 100)}%` }}
                    />
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </BankPanel>
  );
}
