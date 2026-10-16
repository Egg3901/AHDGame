"use client";

import { DenseSection, KVList, KVRow } from "../dense/DenseKit";

import { useCurrency } from "@/contexts/CurrencyContext";
import { useTranslations } from "next-intl";
import {
  availableHoldingShares,
  SHORT_TERM_HOLDING_TURNS,
  type ShareHoldingTerms,
} from "@/lib/corporations/rules/holdingTerms";

interface MyHoldingsPanelProps {
  holdingTerms?: ShareHoldingTerms;
  turn?: number;
  myShares: number;
  myShareValue: number;
  myOwnershipPct: number;
  myCashOnHand: number;
  myEscrowedTotal: number;
}

export default function MyHoldingsPanel({
  myShares,
  myShareValue,
  myOwnershipPct,
  myCashOnHand,
  myEscrowedTotal,
  holdingTerms,
  turn = 0,
}: MyHoldingsPanelProps) {
  const { formatAmount } = useCurrency();
  const t = useTranslations("profile.stockHoldings");

  // Hidden when the user holds no shares
  if (myShares === 0) return null;

  return (
    <DenseSection title="Your holdings">
      <KVList>
        {holdingTerms && (
          <>
            {(["short", "long"] as const).map((term) => (
              <KVRow
                key={term}
                label={t(term)}
                value={t("shares", { count: availableHoldingShares(holdingTerms, term) })}
              />
            ))}
          </>
        )}
        <KVRow
          label="Shares"
          value={myShares.toLocaleString("en-US")}
          hint={`${myOwnershipPct.toFixed(2)}%`}
        />
        <KVRow label="Market value" value={formatAmount(myShareValue)} />
        <KVRow label="Cash on hand" value={formatAmount(myCashOnHand)} />
        {myEscrowedTotal > 0 && (
          <KVRow
            label="Reserved in buy orders"
            value={
              <span className="text-warning">{formatAmount(Math.round(myEscrowedTotal))}</span>
            }
          />
        )}
      </KVList>
      {holdingTerms && (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {holdingTerms.shortTermLots.map((lot) => (
            <li key={lot.acquiredTurn}>
              {t("purchaseTurn", {
                turn: lot.acquiredTurn,
                count: lot.shares,
                remaining: Math.max(0, SHORT_TERM_HOLDING_TURNS - (turn - lot.acquiredTurn)),
              })}
            </li>
          ))}
        </ul>
      )}
    </DenseSection>
  );
}
