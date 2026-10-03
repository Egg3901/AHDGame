"use client";

import { DenseSection, KVList, KVRow } from "../dense/DenseKit";

import { useCurrency } from "@/contexts/CurrencyContext";

interface MyHoldingsPanelProps {
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
}: MyHoldingsPanelProps) {
  const { formatAmount } = useCurrency();

  // Hidden when the user holds no shares
  if (myShares === 0) return null;

  return (
    <DenseSection title="Your holdings">
      <KVList>
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
    </DenseSection>
  );
}
