"use client";

import { useReducer } from "react";
import { Badge, Button, EmptyState, Input } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { assessCapital, type BankBorrowings } from "@/lib/banking/capitalAdequacy";
import type { ConsolePayload, OutlookPayload, ShowToast } from "../types";
import { mergeState } from "../lib/helpers";
import { Eyebrow } from "../components/BankSection";

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
  cashReserves,
  totalLoans,
  borrowings,
  propLeverage,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  positions: NonNullable<ConsolePayload["charter"]>["propBook"];
  markValue: number;
  cashReserves: number;
  totalLoans: number;
  borrowings: BankBorrowings;
  /** Leverage against the cap, from the same module that enforces it. */
  propLeverage: OutlookPayload["propLeverage"];
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [{ asset, ref, units, busy }, updatePropState] = useReducer(mergeState<PropBookState>, {
    asset: "equity",
    ref: "",
    units: "",
    busy: false,
  });

  // Capital impact of the book as it stands: every unit of current value sits
  // in risk assets beside the loan book (capitalAdequacy.assessCapital).
  const position = assessCapital({
    cashReserves,
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

  const open = async () => {
    const u = parseFloat(units);
    if (!ref.trim() || !(u > 0)) {
      showToast(`${REF_LABEL[asset]} and positive units are required`, "error");
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
        body: JSON.stringify({ asset, ref: ref.trim(), units: u }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        cost?: number;
        propBookMarkValue?: number;
      };
      if (!res.ok) {
        showToast(json.error ?? "Could not open position", "error");
        return;
      }
      showToast(
        json.cost != null
          ? `Opened ${u} ${ref.trim()}: ${formatBankMoney(json.cost, currency)} left vault cash and now counts toward the leverage cap.`
          : "Position opened: the purchase price left vault cash and now counts toward the leverage cap.",
        "success"
      );
      updatePropState({ ref: "", units: "" });
      await onChanged();
    } finally {
      updatePropState({ busy: false });
    }
  };

  const close = async (pos: (typeof positions)[number]) => {
    updatePropState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/prop/positions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: pos.asset, ref: pos.ref, units: pos.units }),
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

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="space-y-1">
          <Eyebrow kind="ceoControl" />
          <h3 className="text-base font-semibold text-foreground">
            The bank&apos;s own investments
          </h3>
          <p className="text-xs text-muted">
            Positions the bank holds for its own profit, marked to market every turn. Buying moves
            vault cash into the market; the current value counts in risk assets beside the loan
            book, so the capital ratio is {(position.capitalRatio * 100).toFixed(1)}% with this book
            on it.
          </p>
        </div>
        <p className="text-sm font-mono tabular-nums text-muted">
          Current value {formatBankMoney(markValue, currency)}
        </p>
      </div>
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
      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 grid gap-3 sm:grid-cols-4 max-w-3xl">
          <label className="block space-y-1 text-xs text-muted">
            Asset
            <select
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground"
              value={asset}
              onChange={(e) => updatePropState({ asset: e.target.value as PropAsset })}
              aria-label="Investment asset type"
            >
              <option value="equity">Equity</option>
              <option value="bond">Bond</option>
              <option value="indexUnit">Index unit</option>
              <option value="forex">Forex</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted sm:col-span-2">
            {REF_LABEL[asset]}
            <Input
              value={ref}
              onChange={(e) => updatePropState({ ref: e.target.value })}
              placeholder={REF_PLACEHOLDER[asset]}
              aria-label={`Investment position ${REF_LABEL[asset].toLowerCase()}`}
            />
          </label>
          <label className="block space-y-1 text-xs text-muted">
            Units
            <Input
              value={units}
              onChange={(e) => updatePropState({ units: e.target.value })}
              inputMode="decimal"
              aria-label="Investment position units"
            />
          </label>
          <div className="sm:col-span-4 space-y-1">
            <p className="text-[11px] text-muted">
              Opening quotes units x market price out of vault cash
              {leverage
                ? `, with ${formatBankMoney(Math.max(0, leverage.headroom), currency)} of leverage headroom`
                : ""}
              .
              {needsConfirm
                ? " The book is past two thirds of its cap, so opening asks first."
                : ""}
            </p>
            <Button type="button" onClick={() => void open()} disabled={busy}>
              {busy ? "Working..." : "Open position"}
            </Button>
          </div>
        </div>
      )}
      {positions.length === 0 ? (
        <EmptyState title="No investments" description="Open a position to start the book." />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">Asset</th>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold text-right">Units</th>
                <th className="px-4 py-3 font-semibold text-right">Cost</th>
                <th className="px-4 py-3 font-semibold text-right">Current value</th>
                <th className="px-4 py-3 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {positions.map((pos) => (
                <tr key={`${pos.asset}:${pos.ref}`}>
                  <td className="px-4 py-3">
                    <Badge color="default" variant="subtle">
                      {pos.asset}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{pos.ref}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {pos.units.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(pos.costBasis, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {pos.markValue != null ? formatBankMoney(pos.markValue, currency) : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canMutate && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void close(pos)}
                      >
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
