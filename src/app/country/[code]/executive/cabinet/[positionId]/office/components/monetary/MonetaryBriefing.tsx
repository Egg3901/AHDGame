import { RateCards } from "./RateCards";
import { FxReserveCard } from "./FxReserveCard";
import { DebtCoverageCard } from "./DebtCoverageCard";
import { DebtOperationPanel } from "./DebtOperationPanel";
import type { MonetaryView } from "../../useCabinetOffice";

export function MonetaryBriefing({
  countryCode,
  positionId,
  canAct,
  sym,
  currentTurn,
  m,
  debtPrincipal,
  sovereignBondsOutstanding,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  canAct: boolean;
  sym: string;
  currentTurn: number;
  m: MonetaryView;
  debtPrincipal: number;
  sovereignBondsOutstanding: number;
  onUpdate: () => void;
}) {
  return (
    <div className="space-y-4">
      <RateCards m={m} />
      <DebtOperationPanel
        countryCode={countryCode}
        positionId={positionId}
        canAct={canAct}
        currentTurn={currentTurn}
        m={m}
        onUpdate={onUpdate}
      />
      <FxReserveCard m={m} sym={sym} />
      <DebtCoverageCard
        debtPrincipal={debtPrincipal}
        sovereignBondsOutstanding={sovereignBondsOutstanding}
        sym={sym}
      />
    </div>
  );
}
