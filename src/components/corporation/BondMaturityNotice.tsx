"use client";

import { useEffect, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { projectBondMaturityAffordability } from "@/lib/bonds/bondMaturityAffordability";
import { bondMaturitySchedule } from "@/lib/bonds/bondMaturitySchedule";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondInfo } from "./CorporationPageTypes";

interface BondMaturityNoticeProps {
  bondInfo: BondInfo | null;
  /** Currency of `liquidCapital`. Bonds carry their own, which may differ. */
  liquidCurrencyCode?: string;
  /** Corp-local cash, compared against the repayment for the shortfall line. */
  liquidCapital: number;
  /** Last-turn realized retained earnings, converted to a per-turn local rate. */
  recentRetainedEarningsPerTurn?: number | null;
  corporationName: string;
  /** Scopes the dismissal so one corp's notice never hides another's. */
  corporationId: string;
}

/** Dismissal hides informational notices. A cash shortfall overrides it once
 * it enters the 48-turn action window. */
const PERSISTENT_ACTION_WINDOW_TURNS = 48;

function dismissKey(corporationId: string, maturityTurn: number): string {
  return `ahd-bond-maturity-dismissed-v1:${corporationId}:${maturityTurn}`;
}

/**
 * Standing notice to a CEO of what this corporation still owes its bondholders.
 *
 * Page-level rather than inside the Bonds tab on purpose: the repayment is a
 * surprise precisely because nobody visits that tab between issuing a bond and
 * the turn the face value leaves liquid capital. CEOs read the coupon as the
 * whole cost of borrowing, so the number they never saw was the principal.
 *
 * CEO-only. Everything here is addressed to whoever has to find the cash, and
 * the same figures are on the Bonds tab for anyone else who wants them.
 * `bondInfo.isCeo` is the server's own answer to that question, the same flag
 * that gates the issue form, so this cannot drift from who may actually act.
 *
 * All arithmetic runs in ₳. A corporation that has relocated keeps bonds in the
 * currency they were issued in while its own liquid capital is re-denominated,
 * so neither the sum across bonds nor the comparison against cash is safe in
 * raw local units.
 */
export default function BondMaturityNotice({
  bondInfo,
  liquidCurrencyCode,
  liquidCapital,
  recentRetainedEarningsPerTurn,
  corporationName,
  corporationId,
}: BondMaturityNoticeProps) {
  const { formatAmount, toInternalFrom } = useCurrency();
  const [dismissed, setDismissed] = useState(false);

  const { next, approaching, totalPrincipalDue } = bondMaturitySchedule(
    // `totalIssuedAnchor` is absent only on a response from an older deploy,
    // where falling back to the raw local is what every other bond figure on
    // the page already does.
    bondInfo?.isCeo
      ? bondInfo.bonds?.map((bond) => ({
          principalAnchor: bond.totalIssuedAnchor ?? bond.totalIssued,
          maturityTurn: bond.maturityTurn,
          matured: bond.matured,
          defaulted: bond.defaulted,
        }))
      : undefined,
    bondInfo?.currentTurn ?? Number.NaN
  );

  const key = next ? dismissKey(corporationId, next.maturityTurn) : null;
  // Read the dismissal after mount (SSR-safe): the server renders the notice
  // and the client hides it only if this repayment was already dismissed.
  /* eslint-disable react-hooks/set-state-in-effect -- reading localStorage */
  useEffect(() => {
    if (!key) return;
    try {
      setDismissed(window.localStorage.getItem(key) === "1");
    } catch {
      // storage blocked — show the notice, best effort
    }
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!bondInfo?.isCeo || !next || !key) return null;

  const code = (liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const cashAnchor = code ? toInternalFrom(liquidCapital, code) : liquidCapital;
  const retainedEarningsAnchor =
    recentRetainedEarningsPerTurn == null
      ? null
      : code
        ? toInternalFrom(recentRetainedEarningsPerTurn, code)
        : recentRetainedEarningsPerTurn;
  const dueNow = next.turnsRemaining === 0;
  const affordability = projectBondMaturityAffordability({
    currentLiquidCapital: cashAnchor,
    repaymentAmount: next.amount,
    turnsRemaining: next.turnsRemaining,
    retainedEarningsPerTurn: retainedEarningsAnchor,
  });
  const shortOfCash = !affordability.isCovered;
  const onTrack = affordability.usedProjection && affordability.isCovered;
  const persistentActionNeeded =
    shortOfCash && next.turnsRemaining <= PERSISTENT_ACTION_WINDOW_TURNS;

  // A dismissal is a snooze, not a waiver: shortfalls return as persistent
  // alerts once they enter the action window.
  if (dismissed && !persistentActionNeeded) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // private mode — dismissal just won't persist
    }
  };

  const tone = persistentActionNeeded
    ? "border-warning/40 bg-warning/10"
    : "border-info/30 bg-info/10";
  const dueTurn = next.maturityTurn.toLocaleString("en-US");
  const shortfallDescription = affordability.usedProjection
    ? `projected cash at turn ${dueTurn} is short by ${formatAmount(affordability.shortfall)}`
    : `current cash is short by ${formatAmount(affordability.shortfall)}`;
  const status = shortOfCash
    ? persistentActionNeeded
      ? `Action needed: ${shortfallDescription}.`
      : `${shortfallDescription.charAt(0).toUpperCase()}${shortfallDescription.slice(1)}.`
    : onTrack
      ? `On track: projected cash at turn ${dueTurn} covers this.`
      : dueNow
        ? "Due now."
        : approaching
          ? "Due soon."
          : "No action needed.";

  return (
    <div
      className={`relative rounded-xl border px-4 py-3 text-sm ${tone} ${!persistentActionNeeded ? "pr-10" : ""}`}
    >
      <p className="font-semibold text-foreground">
        {dueNow
          ? `Bond repayment due now: ${formatAmount(next.amount)}`
          : `Bond repayment of ${formatAmount(next.amount)} due on turn ${next.maturityTurn.toLocaleString("en-US")} (${next.turnsRemaining} ${next.turnsRemaining === 1 ? "turn" : "turns"})`}{" "}
        <span className="font-normal text-muted">{status}</span>
      </p>
      {onTrack && (
        <p className="mt-0.5 text-muted">
          Using the most recent turn&apos;s retained earnings, projected liquid capital at turn{" "}
          {dueTurn} is {formatAmount(affordability.cashAtMaturity)}. Figures on Finance &gt; Credit.
        </p>
      )}
      {shortOfCash && (
        <p className="mt-0.5 text-muted">
          Liquid capital is {formatAmount(cashAnchor)} today.
          {affordability.usedProjection && (
            <>
              {" "}
              Projected cash at turn {dueTurn} is {formatAmount(affordability.cashAtMaturity)}.
            </>
          )}
          {persistentActionNeeded ? (
            <>
              {" "}
              Build cash, refinance, or plan asset sales before turn {dueTurn}; a repayment that
              drives liquid capital below zero can default. Figures on Finance &gt; Credit.
            </>
          ) : (
            <> Figures on Finance &gt; Credit.</>
          )}
        </p>
      )}
      {!shortOfCash && (dueNow || approaching) && (
        <p className="mt-0.5 text-muted">
          Covered by current liquid capital of {formatAmount(cashAnchor)}. Paid out of liquid
          capital in one payment
          {next.bondCount > 1 ? `, across ${next.bondCount} bonds maturing together` : ""}. Figures
          on Finance &gt; Credit.
        </p>
      )}
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer hover:text-foreground">Why this matters</summary>
        <p className="mt-0.5">
          {corporationName} repays the face value out of liquid capital in one payment; coupons are
          only the running cost, the amount borrowed comes back out in full at maturity. If that
          payment drives liquid capital below zero and the debt is not covered by what selling up
          could realize, the bond defaults.
          {totalPrincipalDue > next.amount && (
            <> Principal outstanding across every live bond is {formatAmount(totalPrincipalDue)}.</>
          )}
        </p>
      </details>
      {!persistentActionNeeded && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss bond repayment notice"
          className="absolute top-2 right-2 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-card hover:text-foreground"
        >
          ✕
        </button>
      )}
    </div>
  );
}
