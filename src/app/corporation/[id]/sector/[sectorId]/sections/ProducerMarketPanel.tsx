"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import type { ProducerQuotePolicy } from "@/lib/market/producerMarket/rules";
import type { ProducerSectorView } from "@/lib/market/producerMarket/sectorViewRules";

const number = (value: number | null) =>
  value == null ? "Pending" : value.toLocaleString(undefined, { maximumFractionDigits: 3 });

interface ProducerMarketPanelProps {
  corporationId: string;
  sectorId: string;
  isCeo: boolean;
  market: ProducerSectorView;
}

export default function ProducerMarketPanel(props: ProducerMarketPanelProps) {
  const policyKey = JSON.stringify(
    Object.entries(props.market.quotePolicies ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );
  return (
    <ProducerMarketEditor
      key={`${props.corporationId}:${props.sectorId}:${policyKey}`}
      {...props}
    />
  );
}

function ProducerMarketEditor({
  corporationId,
  sectorId,
  isCeo,
  market,
}: ProducerMarketPanelProps) {
  const { formatAmount, formatPrice, toDisplay, toInternal, inputSymbol } = useCurrency();
  const [policies, setPolicies] = useState<Record<string, ProducerQuotePolicy>>(() =>
    Object.fromEntries([
      ...Object.entries(market.quotePolicies ?? {}).filter(
        (entry): entry is [string, ProducerQuotePolicy] => entry[1] !== undefined
      ),
      ...market.products.map((p) => [
        p.commodity,
        p.policy ?? { kind: "automatic", targetMarkup: 0 },
      ]),
    ])
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const change = (commodity: string, policy: ProducerQuotePolicy) =>
    setPolicies((prior) => ({ ...prior, [commodity]: policy }));
  const save = async () => {
    setSaving(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch(
        `/api/corporations/${corporationId}/sectors/${sectorId}/pricing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quotes: policies }),
        }
      );
      if (!response.ok) {
        setError(true);
        setMessage("Pricing was not saved. Your previous settings remain active.");
        return;
      }
      setMessage("Pricing saved for the next market settlement.");
    } catch {
      setError(true);
      setMessage("Could not reach the market. Your previous settings remain active.");
    } finally {
      setSaving(false);
    }
  };
  const money = (value: number | null) => (value == null ? "Pending" : formatPrice(value));
  const operations = isCeo ? market.operations : undefined;
  return (
    <section
      aria-label="Production and market"
      className="space-y-5 rounded-xl border border-card-border bg-card p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-foreground">Production and market</h2>
        <p className="text-xs text-muted">
          {market.turn == null
            ? "Awaiting the first market settlement."
            : `Settled turn ${market.turn}. Quantities and money below cover one turn.`}
        </p>
      </div>
      {market.products.map((product) => {
        const label = COMMODITY_LABELS[product.commodity as CommodityType] ?? product.commodity;
        const policy = policies[product.commodity] ??
          product.policy ?? { kind: "automatic", targetMarkup: 0 };
        return (
          <div key={product.commodity} className="space-y-3 border-t border-card-border pt-4">
            <h3 className="font-semibold text-foreground">{label}</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                ["Produced", number(product.producedUnits)],
                ["Offered", number(product.offeredUnits)],
                ["Sold", number(product.soldUnits)],
                ["Delivered", number(product.deliveredUnits)],
                ["Output lost", number(product.lostUnits)],
                ["Last asking price", money(product.askingUnitPrice)],
                ["Price received", money(product.realizedUnitPrice)],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt className="text-xs text-muted">{name}</dt>
                  <dd className="tabular-nums text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            {product.sellThrough != null && (
              <p className="text-xs text-muted">
                {Math.round(product.sellThrough * 100)}% of offered output sold. Internal
                deliveries: {number(product.internalDeliveredUnits)}. Internal deliveries create no
                sales revenue.
              </p>
            )}
            {isCeo && (
              <fieldset disabled={saving} className="space-y-2">
                <legend className="text-xs font-semibold text-muted">Next asking policy</legend>
                <div role="group" aria-label={`${label} pricing`} className="flex flex-wrap gap-2">
                  {(["automatic", "manual", "costPlus"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={policy.kind === kind}
                      onClick={() =>
                        change(
                          product.commodity,
                          kind === "manual"
                            ? { kind, unitPrice: product.askingUnitPrice ?? 0 }
                            : kind === "costPlus"
                              ? { kind, markup: 0.1 }
                              : { kind, targetMarkup: 0.1 }
                        )
                      }
                      className={`rounded-md border px-3 py-1.5 text-sm ${policy.kind === kind ? "border-primary bg-primary/10 text-foreground" : "border-card-border text-muted"}`}
                    >
                      {kind === "automatic"
                        ? "Automatic"
                        : kind === "manual"
                          ? "Fixed price"
                          : "Cost + markup"}
                    </button>
                  ))}
                </div>
                {policy.kind === "manual" ? (
                  <label className="block text-xs text-muted">
                    Asking price per unit ({inputSymbol})
                    <input
                      aria-label={`${label} asking price`}
                      type="number"
                      min="0"
                      step="any"
                      value={Number(toDisplay(policy.unitPrice).toPrecision(12))}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value >= 0)
                          change(product.commodity, {
                            kind: "manual",
                            unitPrice: toInternal(value),
                          });
                      }}
                      className="mt-1 block w-44 rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                ) : (
                  <label className="block text-xs text-muted">
                    {policy.kind === "costPlus"
                      ? "Markup above estimated cost (%)"
                      : "Target markup (%)"}
                    <input
                      aria-label={`${label} markup`}
                      type="number"
                      min="-100"
                      step="1"
                      value={
                        Math.round(
                          (policy.kind === "costPlus" ? policy.markup : policy.targetMarkup) * 10000
                        ) / 100
                      }
                      onChange={(event) => {
                        const value = Number(event.target.value) / 100;
                        if (Number.isFinite(value) && value >= -1)
                          change(
                            product.commodity,
                            policy.kind === "costPlus"
                              ? { kind: "costPlus", markup: value }
                              : { kind: "automatic", targetMarkup: value }
                          );
                      }}
                      className="mt-1 block w-44 rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
                    />
                  </label>
                )}
                <p className="text-xs text-muted">
                  {policy.kind === "automatic"
                    ? "Chooses an asking price using costs, competing offers and funded orders."
                    : policy.kind === "costPlus"
                      ? "Adds your markup to estimated input and site costs per offered unit."
                      : "Offers each unit at your chosen price."}{" "}
                  Buyers must still choose your offer. A higher price can leave output unsold.
                </p>
              </fieldset>
            )}
          </div>
        );
      })}
      {operations && (
        <div className="space-y-3 border-t border-card-border pt-4">
          <p className="text-sm text-muted">
            Produced {number(operations.producedUnits)} from {number(operations.activeUnits)} active
            capacity units ({number(operations.capacityUnits)} owned).
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              ["Revenue", operations.revenue],
              ["Inputs used", operations.inputsUsed],
              ["Stock written off", operations.inventoryWriteOff],
              ["Workforce cost", operations.labourCost],
              ["Site costs", operations.otherOperatingCost],
              ["Break-even revenue", operations.breakEvenRevenue],
              ["Operating profit", operations.profit],
              ["Operating cash flow", operations.cashFlow],
              ["Inputs purchased", operations.inputsPurchased],
              ["Old bills paid", operations.oldBillsPaid],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="tabular-nums text-foreground">{formatAmount(Number(value))}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">
            Input purchases move cash into stock. Using that stock is an expense; it is never
            charged to cash a second time.
          </p>
          {operations.unpaidBills > 0 && (
            <p className="text-xs text-warning">
              {formatAmount(operations.unpaidBills)} remains unpaid, including{" "}
              {formatAmount(operations.newUnpaidBills)} added this turn. Older bills were expensed
              in their original turn.
            </p>
          )}
        </div>
      )}
      {isCeo && market.products.length > 0 && (
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save pricing"}
        </button>
      )}
      {message && (
        <p
          role={error ? "alert" : "status"}
          className={`text-xs ${error ? "text-error" : "text-success"}`}
        >
          {message}
        </p>
      )}
    </section>
  );
}
