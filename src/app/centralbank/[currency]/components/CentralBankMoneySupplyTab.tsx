"use client";

import { useState, type FormEvent } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { Button } from "@/components/ui";
import { formatNativeCurrency } from "./centralBankUtils";
import type { MoneySupplyView } from "./centralBankTypes";

export function CentralBankMoneySupplyTab({
  countryId,
  data,
  canOperate,
  onChanged,
}: {
  countryId: CountryId;
  data: MoneySupplyView;
  canOperate: boolean;
  onChanged: () => void;
}) {
  const [type, setType] = useState<"qe" | "qt" | "treasury_advance" | "liquidity_injection">("qe");
  const [bondId, setBondId] = useState(data.eligibleBonds[0]?._id ?? "");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = (amount: number) => formatNativeCurrency(amount, data.currencyCode);
  const isBondOperation = type === "qe" || type === "qt";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const numeric = Number(value);
    try {
      const response = await fetch(`/api/country/${countryId}/central-bank/monetary-operation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          ...(isBondOperation ? { bondId, units: Math.floor(numeric) } : { amount: numeric }),
          reason: reason || undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Monetary operation failed");
      setMessage(
        `${type.replaceAll("_", " ").toUpperCase()} completed: ${fmt(json.operation.amount)}`
      );
      setValue("");
      setReason("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Monetary operation failed");
    } finally {
      setBusy(false);
    }
  }

  const components = [
    ["Household cash", data.householdLiquid],
    ["Campaign balances", data.campaignLiquid],
    ["NPP balances", data.nppLiquid],
    ["Corporate cash", data.corporateLiquid],
    ["Government deposits", data.governmentLiquid],
    ["Party and fund cash", data.partyLiquid + data.fundLiquid],
    ["International organization cash", data.organizationLiquid],
    ["Savings deposits", data.householdSavings],
    ["Rest-of-economy deposits", data.externalBroadMoney],
  ] as const;

  return (
    <div className="space-y-6 pb-16">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="M1 · spendable money" value={fmt(data.m1)} />
        <Stat label="M2 · spendable money plus savings" value={fmt(data.m2)} />
        <Stat
          label="Annualized M2 growth"
          value={`${data.annualizedM2GrowthPct >= 0 ? "+" : ""}${data.annualizedM2GrowthPct.toFixed(2)}%`}
        />
        <Stat label="Credit outstanding" value={fmt(data.creditOutstanding)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Monetary stock · turn {data.turn}
          </h2>
          <p className="mt-2 text-xs text-muted">
            M1 is money that can be spent right now, across the whole economy. M2 adds savings, plus
            an estimate of the deposits held by households and firms that players do not control.
          </p>
          <div className="mt-4 divide-y divide-card-border">
            {components.map(([label, amount]) => (
              <div key={label} className="flex justify-between gap-4 py-2 text-sm">
                <span className="text-muted">{label}</span>
                <span className="font-mono tabular-nums">{fmt(amount)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Bonds, reserves and issuance
          </h2>
          <div className="mt-4 divide-y divide-card-border">
            <Row label="Sovereign bonds outstanding" value={fmt(data.sovereignBondsOutstanding)} />
            <Row label="Central-bank bond holdings" value={fmt(data.centralBankBondHoldings)} />
            <Row label="Lending reserves" value={fmt(data.bankReserves)} />
            <Row label="Net explicit money creation" value={fmt(data.netMoneyCreatedLifetime)} />
          </div>
          <p className="mt-4 text-xs text-muted">
            Selling bonds is how the government pays for itself. Buying government bonds back off
            the market creates new money. Selling them again destroys it. A direct advance to the
            Treasury creates spendable money straight away. Lending more to banks only becomes money
            in circulation once someone actually borrows it.
          </p>
        </section>
      </div>

      {data.lastPolicyEvaluation && (
        <section className="rounded-xl border border-card-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
              Monetary committee assessment · turn {data.lastPolicyEvaluation.turn}
            </h2>
            <span className="rounded-full border border-card-border px-2 py-1 text-xs font-semibold uppercase">
              {data.lastPolicyEvaluation.decision.replaceAll("_", " ")}
            </span>
          </div>
          <p className="mt-3 text-sm">{data.lastPolicyEvaluation.rationale}</p>
          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <Assessment
              label="Inflation / target"
              value={`${data.lastPolicyEvaluation.inflation.toFixed(2)}% / ${data.lastPolicyEvaluation.targetInflation.toFixed(2)}%`}
            />
            <Assessment
              label="Real GDP growth"
              value={`${data.lastPolicyEvaluation.gdpGrowth.toFixed(2)}%`}
            />
            <Assessment
              label={`Annualized M2 growth${data.lastPolicyEvaluation.moneyGrowthReliable ? "" : " · provisional"}`}
              value={`${data.lastPolicyEvaluation.annualizedM2GrowthPct.toFixed(2)}%`}
            />
            <Assessment
              label="Lending reserves"
              value={fmt(data.lastPolicyEvaluation.bankReserves)}
            />
          </div>
        </section>
      )}

      {canOperate && (
        <form onSubmit={submit} className="rounded-xl border border-primary/30 bg-card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-primary">
            Monetary operation
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <select
              value={type}
              onChange={(event) => setType(event.target.value as typeof type)}
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm"
            >
              <option value="qe">Buy government bonds (QE)</option>
              <option value="qt">Sell government bonds (QT)</option>
              <option value="treasury_advance">Lend directly to the Treasury</option>
              <option value="liquidity_injection">Lend more to banks</option>
            </select>
            {isBondOperation && (
              <select
                value={bondId}
                onChange={(event) => setBondId(event.target.value)}
                className="rounded-md border border-card-border bg-background px-3 py-2 text-sm"
              >
                {data.eligibleBonds.map((bond) => (
                  <option key={bond._id} value={bond._id}>
                    {bond.issuerName ?? "Sovereign"} · {bond.couponRate.toFixed(2)}% · T
                    {bond.maturityTurn}
                  </option>
                ))}
              </select>
            )}
            <input
              type="number"
              min="1"
              step="1"
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={isBondOperation ? "Bond units" : `Amount (${data.currencyCode})`}
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Policy rationale"
              maxLength={240}
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" disabled={busy || (isBondOperation && !bondId)}>
              {busy ? "Executing…" : "Execute operation"}
            </Button>
            {message && <p className="text-xs text-success">{message}</p>}
            {error && <p className="text-xs text-error">{error}</p>}
          </div>
        </form>
      )}

      <section className="rounded-xl border border-card-border bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Recent policy operations
        </h2>
        <div className="mt-3 space-y-2">
          {[...data.operations]
            .reverse()
            .slice(0, 12)
            .map((operation, index) => (
              <div
                key={`${operation.turn}:${operation.type}:${index}`}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border py-2 text-sm"
              >
                <span>
                  T{operation.turn} · {operation.type.replaceAll("_", " ").toUpperCase()} ·{" "}
                  {operation.actorName}
                </span>
                <span className="font-mono">{fmt(operation.amount)}</span>
                {operation.reason && (
                  <span className="w-full text-xs text-muted">{operation.reason}</span>
                )}
              </div>
            ))}
          {data.operations.length === 0 && <p className="text-sm text-muted">No operations yet.</p>}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function Assessment({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background p-3">
      <p className="uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-mono font-semibold">{value}</p>
    </div>
  );
}
