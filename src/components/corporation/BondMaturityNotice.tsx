"use client";

import { useCurrency } from "@/contexts/CurrencyContext";
import { bondMaturitySchedule } from "@/lib/bonds/bondMaturitySchedule";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondInfo } from "./CorporationPageTypes";

interface BondMaturityNoticeProps {
  bondInfo: BondInfo | null;
  /** Currency of `totalIssued` and `liquidCapital`; both are corp-local. */
  liquidCurrencyCode?: string;
  /** Corp-local cash, used only for the CEO shortfall line. */
  liquidCapital: number;
  corporationName: string;
}

/**
 * Standing notice of what this corporation still owes its bondholders.
 *
 * Page-level rather than inside the Bonds tab on purpose: the repayment is a
 * surprise precisely because nobody visits that tab between issuing a bond and
 * the turn the face value leaves liquid capital. Players read the coupon as the
 * whole cost of borrowing, so the number they never saw was the principal.
 */
export default function BondMaturityNotice({
  bondInfo,
  liquidCurrencyCode,
  liquidCapital,
  corporationName,
}: BondMaturityNoticeProps) {
  const { formatAmount, toInternalFrom } = useCurrency();

  if (!bondInfo) return null;

  const { next, approaching, totalPrincipalDue } = bondMaturitySchedule(
    bondInfo.bonds,
    bondInfo.currentTurn
  );
  if (!next) return null;

  // Bond amounts and liquidCapital are both in the corp's own currency; ₳ is
  // the anchor the wallet preference formats from.
  const code = (liquidCurrencyCode as CurrencyCode | undefined) ?? undefined;
  const fmtMoney = (val: number) => formatAmount(code ? toInternalFrom(val, code) : val, code);

  const isCeo = bondInfo.isCeo;
  const shortOfCash = isCeo && liquidCapital < next.amount;
  const tone = approaching ? "border-warning/40 bg-warning/10" : "border-info/30 bg-info/10";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-semibold text-foreground">
        {next.turnsRemaining === 0
          ? `Bond principal of ${fmtMoney(next.amount)} is due now`
          : `Bond principal of ${fmtMoney(next.amount)} is due in ${next.turnsRemaining} ${
              next.turnsRemaining === 1 ? "turn" : "turns"
            }`}
      </p>
      <p className="mt-0.5 text-muted">
        {corporationName} repays that face value out of liquid capital in one payment on turn{" "}
        {next.maturityTurn.toLocaleString("en-US")}
        {next.bondCount > 1 ? `, across ${next.bondCount} bonds maturing together` : ""}. Coupons
        are only the running cost of the debt; the amount borrowed comes back out in full at
        maturity.
        {totalPrincipalDue > next.amount && (
          <> Principal outstanding across every live bond is {fmtMoney(totalPrincipalDue)}.</>
        )}
        {isCeo && (
          <>
            {" "}
            If that payment drives liquid capital below zero and this corporation cannot cover its
            debt from what it could realize by selling up, the bond defaults.
          </>
        )}
        {shortOfCash && (
          <span className="text-warning">
            {" "}
            Liquid capital is {fmtMoney(liquidCapital)} today, short of the repayment.
          </span>
        )}
      </p>
    </div>
  );
}
