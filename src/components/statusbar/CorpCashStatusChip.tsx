// Corp treasury chip — reused in standard (cash only) and corp/full layouts of
// the StatusBar. Extracted from src/components/StatusBar.tsx.

import { type CurrencyCode } from "@/lib/constants/currencies";
import type { CorpStats } from "@/contexts/CharacterStatsContext";
import { InfoTooltip } from "@/components/InfoTooltip";
import { BreakdownRow } from "./BreakdownRow";
import { Sparkline } from "./Sparkline";
import { TooltipLink } from "./TooltipLink";

interface CorpCashStatusChipProps {
  corp: CorpStats;
  cashHistory: number[];
  toInternalFrom: (amount: number, from: CurrencyCode) => number;
  formatAmount: (internal: number, native?: CurrencyCode) => string;
  formatFull: (internal: number, native?: CurrencyCode) => string;
}

export function CorpCashStatusChip({
  corp,
  cashHistory,
  toInternalFrom,
  formatAmount,
  formatFull,
}: CorpCashStatusChipProps) {
  const corpCurrency = (corp.liquidCurrencyCode as CurrencyCode) ?? "USD";
  // liquidCapital is in corpCurrency (home currency post-migration). Normalize
  // to ₳ so both compact and full formatters honor the viewer's display
  // preference instead of forcing home currency.
  const anchorCash = toInternalFrom(corp.liquidCapital, corpCurrency);
  const cashDisplay = formatAmount(anchorCash, corpCurrency);
  const cashBreakdownValue = formatFull(anchorCash, corpCurrency);
  return (
    <InfoTooltip
      className="cursor-pointer"
      width={220}
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-bold text-sky-400 tabular-nums transition-colors hover:bg-sky-500/20 sm:gap-1.5 sm:px-2 sm:py-1 sm:text-xs"
          aria-label={`${corp.name} cash`}
        >
          <svg
            className="hidden sm:block h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3M9 7h1m-1 4h1m4-4h1m-1 4h1M9 15h6"
            />
          </svg>
          {cashDisplay}
        </button>
      }
    >
      <p className="font-semibold text-foreground mb-2">{corp.name}</p>
      <BreakdownRow label="Cash on hand" value={cashBreakdownValue} valueClass="text-sky-400" />
      {cashHistory.length >= 2 && (
        <div className="mt-2 mb-1">
          <p className="text-[10px] text-muted mb-1">Corp cash (last {cashHistory.length} turns)</p>
          <Sparkline data={cashHistory} color="#38bdf8" width={188} height={30} />
        </div>
      )}
      <TooltipLink href={`/corporation/${corp.sequentialId}`}>View Corporation</TooltipLink>
    </InfoTooltip>
  );
}
