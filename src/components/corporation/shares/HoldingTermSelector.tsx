"use client";
import { useTranslations } from "next-intl";
import {
  availableHoldingShares,
  SHORT_TERM_HOLDING_TURNS,
  type HoldingTerm,
  type ShareHoldingTerms,
} from "@/lib/corporations/rules/holdingTerms";
export function HoldingTermSelector({
  terms,
  term,
  onChange,
  turn,
}: {
  terms: ShareHoldingTerms;
  term: HoldingTerm;
  onChange: (term: HoldingTerm) => void;
  turn: number;
}) {
  const t = useTranslations("profile.stockHoldings");
  return (
    <fieldset className="space-y-2 rounded-lg border border-card-border p-3">
      <legend className="px-1 text-sm font-medium">{t("bucket")}</legend>
      <div className="grid grid-cols-2 gap-2">
        {(["short", "long"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={term === value}
            disabled={!availableHoldingShares(terms, value)}
            onClick={() => onChange(value)}
            className={`rounded-lg border p-2 text-left text-xs disabled:opacity-50 ${term === value ? "border-primary bg-primary/10" : "border-card-border"}`}
          >
            <span className="block font-medium">{t(value)}</span>
            {t("shares", { count: availableHoldingShares(terms, value) })}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{t(term === "short" ? "shortTax" : "longTax")}</p>
      {term === "short" && (
        <ul className="space-y-1 text-xs text-muted">
          {terms.shortTermLots.map((lot) => (
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
    </fieldset>
  );
}
export function HoldingTermSummary({ terms, turn }: { terms: ShareHoldingTerms; turn: number }) {
  const t = useTranslations("profile.stockHoldings");
  return (
    <div className="space-y-1 text-xs text-muted">
      {(["short", "long"] as const).map((term) => (
        <p key={term}>
          {t(term)}: {t("shares", { count: availableHoldingShares(terms, term) })}
        </p>
      ))}
      <ul>
        {terms.shortTermLots.map((lot) => (
          <li key={lot.acquiredTurn}>
            {t("purchaseTurn", {
              turn: lot.acquiredTurn,
              count: lot.shares,
              remaining: Math.max(0, SHORT_TERM_HOLDING_TURNS - (turn - lot.acquiredTurn)),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
