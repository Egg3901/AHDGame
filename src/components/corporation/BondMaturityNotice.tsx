"use client";

import { useEffect, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { bondMaturitySchedule } from "@/lib/bonds/bondMaturitySchedule";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondInfo } from "./CorporationPageTypes";

interface BondMaturityNoticeProps {
  bondInfo: BondInfo | null;
  /** Currency of `liquidCapital`. Bonds carry their own, which may differ. */
  liquidCurrencyCode?: string;
  /** Corp-local cash, compared against the repayment for the shortfall line. */
  liquidCapital: number;
  corporationName: string;
  /** Scopes the dismissal so one corp's notice never hides another's. */
  corporationId: string;
}

/** Dismissal hides the notice only while it is informational. Anything urgent
 * (due soon, due now, or short of cash) ignores the dismissal and shows
 * anyway, so dismissing now still reminds later when action is actually due. */
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
  const dueNow = next.turnsRemaining === 0;
  const shortOfCash = cashAnchor < next.amount;
  const urgent = dueNow || approaching || shortOfCash;

  // A dismissal is a snooze, not a waiver: once the repayment is due soon, due
  // now, or unaffordable, it shows again no matter what was dismissed before.
  if (dismissed && !urgent) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // private mode — dismissal just won't persist
    }
  };

  const tone = urgent ? "border-warning/40 bg-warning/10" : "border-info/30 bg-info/10";
  const status = dueNow
    ? "Action needed."
    : shortOfCash
      ? "Action needed: unaffordable at current cash."
      : approaching
        ? "Due soon."
        : "No action needed.";

  return (
    <div
      className={`relative rounded-xl border px-4 py-3 text-sm ${tone} ${!urgent ? "pr-10" : ""}`}
    >
      <p className="font-semibold text-foreground">
        {dueNow
          ? `Bond repayment due now: ${formatAmount(next.amount)}`
          : `Bond repayment of ${formatAmount(next.amount)} due on turn ${next.maturityTurn.toLocaleString("en-US")} (${next.turnsRemaining} ${next.turnsRemaining === 1 ? "turn" : "turns"})`}{" "}
        <span className="font-normal text-muted">{status}</span>
      </p>
      {urgent && (
        <p className="mt-0.5 text-muted">
          {shortOfCash ? (
            <>
              Liquid capital is {formatAmount(cashAnchor)} today, short of this repayment. Build
              cash, refinance, or plan asset sales before turn{" "}
              {next.maturityTurn.toLocaleString("en-US")}; a repayment that drives liquid capital
              below zero can default. Figures on Finance &gt; Credit.
            </>
          ) : (
            <>
              Covered by current liquid capital of {formatAmount(cashAnchor)}. Paid out of liquid
              capital in one payment
              {next.bondCount > 1 ? `, across ${next.bondCount} bonds maturing together` : ""}.
              Figures on Finance &gt; Credit.
            </>
          )}
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
      {!urgent && (
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
