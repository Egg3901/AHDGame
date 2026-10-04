"use client";

import { useReducer } from "react";
import { useTranslations } from "next-intl";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { assessCapital, type BankBorrowings } from "@/lib/banking/capitalAdequacy";
import type { ConsolePayload, OutlookPayload, ShowToast } from "../types";
import { mergeState } from "../lib/helpers";
import { SmallButton, TableScroll, Td, Th } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

type PropAsset = "equity" | "bond" | "indexUnit" | "forex";

/** Plain-language reference label per asset type: never a bare "Ref". */
const REF_LABEL: Record<PropAsset, string> = {
  equity: "Ticker",
  bond: "Bond ID",
  indexUnit: "Fund",
  forex: "Currency",
};

const REF_PLACEHOLDER: Record<PropAsset, string> = {
  equity: "company ticker, e.g. OST",
  bond: "bond ID",
  indexUnit: "fund name",
  forex: "currency code, e.g. EUR",
};

/**
 * The open-position form and its in-flight flag move as one group: a successful
 * open clears the ref and the units together, and both buttons read the same
 * busy flag.
 */
type PropBookState = {
  asset: PropAsset;
  ref: string;
  units: string;
  busy: boolean;
  quote: { fee: number; cost: number; proceeds: number } | null;
};

/**
 * A book already past two thirds of its leverage cap asks first: near the cap
 * a new position risks forced liquidation on the next down mark, which feeds
 * the confidence score. The charter-switch dialog is the model.
 */
const CONFIRM_LEVERAGE_FRACTION = 2 / 3;

export function PropBookPanel({
  corporationId,
  currency,
  positions,
  markValue,
  sovereignTreasuryMarkValue,
  cashReserves,
  totalLoans,
  borrowings,
  propLeverage,
  canMutate,
  forexFeesEnabled = false,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  positions: NonNullable<ConsolePayload["charter"]>["propBook"];
  markValue: number;
  sovereignTreasuryMarkValue: number;
  cashReserves: number;
  totalLoans: number;
  borrowings: BankBorrowings;
  /** Leverage against the cap, from the same module that enforces it. */
  propLeverage: OutlookPayload["propLeverage"];
  canMutate: boolean;
  forexFeesEnabled?: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const t = useTranslations("corporations.propForexFees");
  const [{ asset, ref, units, busy, quote }, updatePropState] = useReducer(
    mergeState<PropBookState>,
    {
      asset: "equity",
      ref: "",
      units: "",
      busy: false,
      quote: null,
    }
  );

  // Capital impact of the book as it stands: every unit of current value sits
  // in risk assets beside the loan book (capitalAdequacy.assessCapital).
  const position = assessCapital({
    cashReserves,
    sovereignTreasuryMarkValue,
    totalLoans,
    borrowings,
    propBookMarkValue: markValue,
  });
  const leverage = propLeverage;
  const leverageUsed =
    leverage && leverage.equityBase > 0
      ? leverage.markValue / (leverage.multiple * leverage.equityBase)
      : null;
  const needsConfirm = leverageUsed != null && leverageUsed >= CONFIRM_LEVERAGE_FRACTION;

  const requestQuote = async (position: { asset: PropAsset; ref: string; units: number }) => {
    const response = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...position, quoteOnly: true }),
    });
    const result = (await response.json()) as {
      error?: string;
      fee: number;
      cost: number;
      proceeds: number;
    };
    if (!response.ok) {
      showToast(result.error ?? t("unavailable"), "error");
      return null;
    }
    return result;
  };

  const open = async () => {
    const u = parseFloat(units);
    if (!ref.trim() || !(u > 0)) {
      showToast(`${REF_LABEL[asset]} and positive units are required`, "error");
      return;
    }
    if (forexFeesEnabled && asset === "forex" && !quote) {
      updatePropState({ busy: true });
      try {
        updatePropState({ quote: await requestQuote({ asset, ref: ref.trim(), units: u }) });
      } finally {
        updatePropState({ busy: false });
      }
      return;
    }
    if (needsConfirm) {
      const ok = window.confirm(
        `The bank's own investments already use ${leverageUsed != null ? Math.round(leverageUsed * 100) : "?"}% of their leverage cap. Opening more risks forced liquidation on the next down mark, which lowers depositor confidence. Continue?`
      );
      if (!ok) return;
    }
    updatePropState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset,
          ref: ref.trim(),
          units: u,
          ...(forexFeesEnabled && asset === "forex" && quote ? { maxCost: quote.cost } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        cost?: number;
        fee?: number;
        propBookMarkValue?: number;
      };
      if (!res.ok) {
        updatePropState({ quote: null });
        showToast(json.error ?? "Could not open position", "error");
        return;
      }
      showToast(
        json.fee != null && json.cost != null
          ? t("opened", {
              cost: formatBankMoney(json.cost, currency),
              fee: formatBankMoney(json.fee, currency),
            })
          : json.cost != null
            ? `Opened ${u} ${ref.trim()}: ${formatBankMoney(json.cost, currency)} left vault cash and now counts toward the leverage cap.`
            : "Position opened: the purchase price left vault cash and now counts toward the leverage cap.",
        "success"
      );
      updatePropState({ ref: "", units: "", quote: null });
      await onChanged();
    } finally {
      updatePropState({ busy: false });
    }
  };

  const close = async (pos: (typeof positions)[number]) => {
    updatePropState({ busy: true });
    try {
      let minimumProceeds: number | undefined;
      if (forexFeesEnabled && pos.asset === "forex") {
        const preview = await requestQuote({ asset: pos.asset, ref: pos.ref, units: pos.units });
        if (!preview) return;
        if (
          !window.confirm(
            t("closeQuote", {
              proceeds: formatBankMoney(preview.proceeds, currency),
              fee: formatBankMoney(preview.fee, currency),
            })
          )
        )
          return;
        minimumProceeds = preview.proceeds;
      }
      const res = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: pos.asset,
          ref: pos.ref,
          units: pos.units,
          ...(minimumProceeds !== undefined ? { minProceeds: minimumProceeds } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        proceeds?: number;
        realizedPnl?: number;
      };
      if (!res.ok) {
        showToast(json.error ?? "Could not close position", "error");
        return;
      }
      showToast(
        json.proceeds != null
          ? `Closed ${pos.ref}: ${formatBankMoney(json.proceeds, currency)} returned to vault cash${json.realizedPnl != null ? ` (${json.realizedPnl >= 0 ? "+" : ""}${formatBankMoney(json.realizedPnl, currency)} profit)` : ""}.`
          : "Position closed: the current value returned to vault cash.",
        "success"
      );
      await onChanged();
    } finally {
      updatePropState({ busy: false });
    }
  };

  const inputClass =
    "h-8 w-full rounded-md border border-card-border bg-background px-2 text-[13px] text-foreground placeholder:text-muted focus:border-foreground focus:outline-none";

  return (
    <BankPanel
      kind="ceoControl"
      title="The bank's own investments"
      actions={
        <span className="text-xs text-muted">
          Current value{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatBankMoney(markValue, currency)}
          </span>
        </span>
      }
    >
      <div className="space-y-1 py-1.5">
        <p className="text-xs text-muted">
          Positions the bank holds for its own profit, marked to market every turn. Buying moves
          vault cash into the market; the current value counts in risk assets beside the loan book,
          so the capital ratio is{" "}
          <span className="font-mono text-foreground">
            {(position.capitalRatio * 100).toFixed(1)}%
          </span>{" "}
          with this book on it.
        </p>
        {leverage && (
          <p className="text-xs text-muted">
            Leverage{" "}
            {leverage.markValue > 0 && leverage.equityBase > 0
              ? `${((leverage.markValue / Math.max(1, leverage.equityBase)) * 100).toFixed(0)}% of equity`
              : "unused"}{" "}
            against a cap of {leverage.multiple}x equity (
            {formatBankMoney(leverage.headroom, currency)} of headroom). Past the cap the bank is
            force-liquidated, which lowers confidence.
          </p>
        )}
      </div>
      {canMutate && (
        <div className="space-y-1 pb-3 pt-1">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex w-32 flex-col gap-1 text-xs text-muted">
              Asset
              <select
                className={inputClass}
                value={asset}
                onChange={(e) =>
                  updatePropState({ asset: e.target.value as PropAsset, quote: null })
                }
                aria-label="Investment asset type"
              >
                <option value="equity">Equity</option>
                <option value="bond">Bond</option>
                <option value="indexUnit">Index unit</option>
                <option value="forex">Forex</option>
              </select>
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
              {REF_LABEL[asset]}
              <input
                value={ref}
                onChange={(e) => updatePropState({ ref: e.target.value, quote: null })}
                placeholder={REF_PLACEHOLDER[asset]}
                aria-label={`Investment position ${REF_LABEL[asset].toLowerCase()}`}
                className={inputClass}
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-xs text-muted">
              Units
              <input
                value={units}
                onChange={(e) => updatePropState({ units: e.target.value, quote: null })}
                inputMode="decimal"
                aria-label="Investment position units"
                className={`${inputClass} font-mono`}
              />
            </label>
            <SmallButton tone="primary" onClick={() => void open()} disabled={busy}>
              {busy
                ? "Working..."
                : forexFeesEnabled && asset === "forex"
                  ? quote
                    ? t("buy")
                    : t("quote")
                  : "Open position"}
            </SmallButton>
          </div>
          {forexFeesEnabled && asset === "forex" && (
            <p className="text-xs text-muted">
              {quote
                ? t("preview", {
                    cost: formatBankMoney(quote.cost, currency),
                    fee: formatBankMoney(quote.fee, currency),
                  })
                : t("explanation")}
            </p>
          )}
          <p className="text-[11px] text-muted">
            Opening quotes units x market price out of vault cash
            {leverage
              ? `, with ${formatBankMoney(Math.max(0, leverage.headroom), currency)} of leverage headroom`
              : ""}
            .{needsConfirm ? " The book is past two thirds of its cap, so opening asks first." : ""}
          </p>
        </div>
      )}
      {positions.length === 0 ? (
        <p className="py-1 text-xs text-muted">
          No investments. Open a position to start the book.
        </p>
      ) : (
        <TableScroll>
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th>Reference</Th>
                <Th align="right">Units</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Current value</Th>
                <Th align="right">
                  <span className="sr-only">Close</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={`${pos.asset}:${pos.ref}`}>
                  <Td className="text-muted">{pos.asset}</Td>
                  <Td className="font-mono text-xs text-foreground">{pos.ref}</Td>
                  <Td align="right">{pos.units.toLocaleString("en-US")}</Td>
                  <Td align="right">{formatBankMoney(pos.costBasis, currency)}</Td>
                  <Td align="right">
                    {pos.markValue != null ? formatBankMoney(pos.markValue, currency) : "n/a"}
                  </Td>
                  <Td align="right" numeric={false}>
                    {canMutate && (
                      <SmallButton disabled={busy} onClick={() => void close(pos)}>
                        Close
                      </SmallButton>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </BankPanel>
  );
}
