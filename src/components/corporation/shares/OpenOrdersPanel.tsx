"use client";

import Link from "next/link";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { MarketOrder } from "../CorporationPageTypes";
import { DenseSection, Segmented, SmallButton, Td } from "../dense/DenseKit";

interface OpenOrdersPanelProps {
  marketOrders: MarketOrder[];
  myCharacterId: string | null;
  /** Target corp's currencyCode — order.pricePerShare is stored in this currency (Option B). */
  corpCurrencyCode?: CurrencyCode;
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
  } | null;
  fillAmounts: Record<string, number>;
  setFillAmounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  fillAskAsCorp: boolean;
  setFillAskAsCorp: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;
  handleFillOrder: (orderId: string, orderType: "buy" | "sell", shares?: number) => Promise<void>;
  handleCancelOrder: (orderId: string) => Promise<void>;
}

export default function OpenOrdersPanel({
  marketOrders,
  myCharacterId,
  corpCurrencyCode,
  myCorporation,
  fillAmounts,
  setFillAmounts,
  fillAskAsCorp,
  setFillAskAsCorp,
  loading,
  handleFillOrder,
  handleCancelOrder,
}: OpenOrdersPanelProps) {
  const { formatPriceOrder, formatAmount, toInternalFrom } = useCurrency();
  // Share prices on dev are currently LOCAL under Option B (pre-forex-v2 behavior
  // once merged). Route through `corpCurrencyCode` normalization so wallet-pref
  // display renders correctly for non-USD target corps.
  const displayPrice = (local: number) =>
    corpCurrencyCode
      ? formatPriceOrder(toInternalFrom(local, corpCurrencyCode), corpCurrencyCode)
      : formatPriceOrder(local);
  const buyOrders = marketOrders.filter((o) => o.type === "buy");
  const sellOrders = marketOrders.filter((o) => o.type === "sell");
  const myCorpLiquidCurrency = (myCorporation?.liquidCurrencyCode ?? "USD") as CurrencyCode;
  const myCorpLiquidInternal = myCorporation
    ? toInternalFrom(myCorporation.liquidCapital, myCorpLiquidCurrency)
    : 0;

  // A render helper, not a component: a component declared in this body would
  // get a new identity every render and remount, dropping input focus.
  function renderSide(side: "buy" | "sell", orders: MarketOrder[]) {
    // A bid is someone buying: you fill it by selling. An ask is the reverse.
    const actionLabel = side === "buy" ? "Sell" : "Buy";
    return (
      <div className="min-w-0">
        <h3 className="flex items-baseline justify-between border-b border-card-border pb-1 text-xs font-medium text-muted">
          <span>{side === "buy" ? "Bids (buy orders)" : "Asks (sell orders)"}</span>
          <span className="tabular-nums">{orders.length}</span>
        </h3>
        {orders.length === 0 ? (
          <p className="py-2 text-xs text-muted">None open.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sr-only">
              <tr>
                <th>Shares</th>
                <th>Price</th>
                <th>Placed by</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order._id} className={order.isMine ? "bg-card-elevated/40" : undefined}>
                  <Td align="right">{order.sharesRemaining.toLocaleString("en-US")}</Td>
                  <Td align="right">{displayPrice(order.pricePerShare)}</Td>
                  <Td className="max-w-[9rem] truncate text-xs text-muted">
                    {order.characterSequentialId ? (
                      <Link
                        href={`/character/${order.characterSequentialId}`}
                        className="hover:text-foreground hover:underline"
                      >
                        {order.characterName}
                      </Link>
                    ) : (
                      order.characterName
                    )}
                    {order.isMine && <span className="ml-1 text-foreground">you</span>}
                  </Td>
                  <Td align="right" numeric={false}>
                    {order.isMine ? (
                      <SmallButton
                        tone="danger"
                        onClick={() => handleCancelOrder(order._id)}
                        disabled={loading}
                      >
                        Cancel
                      </SmallButton>
                    ) : myCharacterId ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          value={fillAmounts[order._id] || ""}
                          onChange={(e) =>
                            setFillAmounts((prev) => ({
                              ...prev,
                              [order._id]: Math.min(
                                order.sharesRemaining,
                                Math.max(1, Math.floor(Number(e.target.value)))
                              ),
                            }))
                          }
                          placeholder="Shares"
                          aria-label={`Shares to ${actionLabel.toLowerCase()}`}
                          min={1}
                          max={order.sharesRemaining}
                          className="h-6 w-20 rounded border border-card-border bg-background px-1.5 text-right text-xs tabular-nums text-foreground focus:border-foreground focus:outline-none"
                        />
                        <SmallButton
                          tone="primary"
                          onClick={() => handleFillOrder(order._id, side, fillAmounts[order._id])}
                          disabled={loading || !fillAmounts[order._id]}
                        >
                          {actionLabel}
                        </SmallButton>
                      </span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <DenseSection title="Order book" meta="open limit orders from other holders">
      {myCorporation && sellOrders.some((o) => !o.isMine) && (
        <div className="flex flex-wrap items-center gap-2 py-1.5 text-xs text-muted">
          Buy asks with
          <Segmented
            ariaLabel="Pay for asks with"
            options={[
              { value: "personal", label: "Personal cash" },
              {
                value: "corporate",
                label: `${myCorporation.name} (${formatAmount(myCorpLiquidInternal, myCorpLiquidCurrency)})`,
              },
            ]}
            value={fillAskAsCorp ? "corporate" : "personal"}
            onChange={(v) => setFillAskAsCorp(v === "corporate")}
          />
        </div>
      )}
      <div className="grid gap-x-8 gap-y-4 pt-1 md:grid-cols-2">
        {renderSide("buy", buyOrders)}
        {renderSide("sell", sellOrders)}
      </div>
    </DenseSection>
  );
}
