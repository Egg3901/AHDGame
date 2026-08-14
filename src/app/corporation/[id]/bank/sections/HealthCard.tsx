"use client";

import { Badge } from "@/components/ui";
import { WarningBandBadge } from "@/components/banking/WarningBandBadge";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import {
  assessCapital,
  borrowingsFromCharter,
  capitalShortfall,
} from "@/lib/banking/capitalAdequacy";
import type { ConsolePayload } from "../types";
import { charterLabel } from "../lib/helpers";

/**
 * Plain-language read on the confidence band. The band alone is a colour with
 * no stated consequence, which is the thing a CEO actually needs to know.
 */
function bandMeaning(
  band: "green" | "amber" | "red" | null,
  panicTurns: number
): { tone: "success" | "warning" | "error" | "default"; headline: string; detail: string } {
  if (panicTurns > 0) {
    return {
      tone: "error",
      headline: "Depositors are running",
      detail: `A bank run is in its ${panicTurns === 1 ? "first" : `${panicTurns}th`} turn. Withdrawals are elevated and reserves drain fastest now. Raise the deposit rate, sell assets, or draw the discount window.`,
    };
  }
  if (band === "red") {
    return {
      tone: "error",
      headline: "Depositors are losing confidence",
      detail:
        "One more bad turn can start a run. Hold more reserves, cut risk, and consider a better deposit rate before it tips.",
    };
  }
  if (band === "amber") {
    return {
      tone: "warning",
      headline: "Confidence is slipping",
      detail:
        "Depositors are watching. Arrears in the loan book and a thin reserve buffer are the usual causes.",
    };
  }
  if (band === "green") {
    return {
      tone: "success",
      headline: "Depositors are comfortable",
      detail: "Nothing here needs attention today.",
    };
  }
  return {
    tone: "default",
    headline: "No confidence reading yet",
    detail: "A band appears once the bank has traded for a turn.",
  };
}

export function HealthCard({ data }: { data: ConsolePayload }) {
  const charter = data.charter!;
  const capital = assessCapital({
    cashReserves: charter.cashReserves,
    totalLoans: charter.totalLoans,
    borrowings: borrowingsFromCharter(charter),
    propBookMarkValue: charter.propBookMarkValue,
  });
  const shortfall = capitalShortfall(capital);
  const meaning = bandMeaning(charter.warningBand, charter.panicTurns);
  const requiredReserves = charter.requiredReserves;
  const reserveGap = charter.cashReserves - requiredReserves;
  const arrears = data.loans.filter((l) => l.status === "arrears" || l.status === "defaulted");
  const arrearsValue = arrears.reduce((sum, l) => sum + l.outstanding, 0);

  const toneBorder =
    meaning.tone === "error"
      ? "border-error/40 bg-error/5"
      : meaning.tone === "warning"
        ? "border-warning/40 bg-warning/5"
        : meaning.tone === "success"
          ? "border-success/30 bg-success/5"
          : "border-card-border bg-card";

  return (
    <section className={`space-y-4 rounded-xl border p-5 ${toneBorder}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{meaning.headline}</h2>
            <WarningBandBadge band={charter.warningBand} confidence={charter.confidence} />
          </div>
          <p className="max-w-2xl text-sm text-muted">{meaning.detail}</p>
        </div>
        <Badge color="default" variant="subtle">
          {charterLabel(charter.type)} · {charter.currency}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <HealthStat
          label="Capital"
          value={
            capital.riskAssetsAnchor > 0 ? `${(capital.capitalRatio * 100).toFixed(1)}%` : "No risk"
          }
          tone={
            capital.standing === "undercapitalized"
              ? "error"
              : capital.standing === "stressed"
                ? "warning"
                : "success"
          }
          detail={
            capital.standing === "undercapitalized"
              ? `Post ${formatBankMoney(shortfall, charter.currency)} or lose the charter`
              : capital.standing === "stressed"
                ? "Survives today, fails the stress scenario"
                : "Above the minimum and the stress scenario"
          }
        />
        <HealthStat
          label="Reserves"
          value={formatBankMoney(charter.reserves, charter.currency)}
          tone={reserveGap == null ? "default" : reserveGap < 0 ? "error" : "success"}
          detail={
            requiredReserves == null
              ? "No reserve requirement"
              : reserveGap != null && reserveGap < 0
                ? `${formatBankMoney(Math.abs(reserveGap), charter.currency)} short of the requirement`
                : `${formatBankMoney(reserveGap ?? 0, charter.currency)} above the requirement`
          }
        />
        <HealthStat
          label="Bad loans"
          value={arrears.length === 0 ? "None" : String(arrears.length)}
          tone={arrears.length === 0 ? "success" : "warning"}
          detail={
            arrears.length === 0
              ? "Every named loan is current"
              : `${formatBankMoney(arrearsValue, charter.currency)} in arrears or defaulted`
          }
        />
      </div>
    </section>
  );
}

function HealthStat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "error" | "default";
}) {
  const valueTone =
    tone === "error"
      ? "text-error"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueTone}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{detail}</div>
    </div>
  );
}
