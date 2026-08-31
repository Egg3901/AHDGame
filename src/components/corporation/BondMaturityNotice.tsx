"use client";

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
}: BondMaturityNoticeProps) {
  const { formatAmount, toInternalFrom } = useCurrency();

  if (!bondInfo?.isCeo) return null;

  const { next, approaching, totalPrincipalDue } = bondMaturitySchedule(
    // `totalIssuedAnchor` is absent only on a response from an older deploy,
    // where falling back to the raw local is what every other bond figure on
    // the page already does.
    bondInfo.bonds?.map((bond) => ({
      principalAnchor: bond.totalIssuedAnchor ?? bond.totalIssued,
      maturityTurn: bond.maturityTurn,
      matured: bond.matured,
      defaulted: bond.defaulted,
    })),
    bondInfo.currentTurn
  );
  if (!next) return null;

  const code = (liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const cashAnchor = code ? toInternalFrom(liquidCapital, code) : liquidCapital;
  const shortOfCash = cashAnchor < next.amount;
  const tone = approaching ? "border-warning/40 bg-warning/10" : "border-info/30 bg-info/10";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-semibold text-foreground">
        {next.turnsRemaining === 0
          ? `Bond principal of ${formatAmount(next.amount)} is due now`
          : `Bond principal of ${formatAmount(next.amount)} is due in ${next.turnsRemaining} ${
              next.turnsRemaining === 1 ? "turn" : "turns"
            }`}
      </p>
      <p className="mt-0.5 text-muted">
        {corporationName} repays that face value out of liquid capital in one payment on turn{" "}
        {next.maturityTurn.toLocaleString("en-US")}
        {next.bondCount > 1 ? `, across ${next.bondCount} bonds maturing together` : ""}. Coupons
        are only the running cost of the debt; the amount borrowed comes back out in full at
        maturity. If that payment drives liquid capital below zero and this corporation cannot cover
        its debt from what it could realize by selling up, the bond defaults.
        {totalPrincipalDue > next.amount && (
          <> Principal outstanding across every live bond is {formatAmount(totalPrincipalDue)}.</>
        )}
        {shortOfCash && (
          <span className="text-warning">
            {" "}
            Liquid capital is {formatAmount(cashAnchor)} today, short of the repayment.
          </span>
        )}
      </p>
    </div>
  );
}
