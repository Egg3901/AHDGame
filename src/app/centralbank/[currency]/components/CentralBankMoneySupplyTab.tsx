"use client";

import { useTranslations } from "next-intl";
import { currentMoneyGrowth } from "@/lib/moneySupply/rules/growthSignal";
import { MONEY_ACCOUNTING_VERSION } from "@/lib/moneySupply/calculate";
import { useRef, useState, type FormEvent } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { Button } from "@/components/ui";
import { formatNativeCurrency } from "./centralBankUtils";
import type { MoneySupplyView } from "./centralBankTypes";
import { CentralBankFigure, CentralBankRow, CentralBankSection } from "./CentralBankSection";

/** Monetary operation and committee decision names, in sentence case. */
const OPERATION_LABEL: Record<string, string> = {
  qe: "QE",
  qt: "QT",
  treasury_advance: "Treasury advance",
  liquidity_injection: "Liquidity injection",
};

function operationLabel(type: string): string {
  const known = OPERATION_LABEL[type];
  if (known) return known;
  const words = type.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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
  const t = useTranslations("centralBank");
  const growth = currentMoneyGrowth(data);
  const policyGrowth = currentMoneyGrowth(data.lastPolicyEvaluation);
  const [type, setType] = useState<"qe" | "qt" | "treasury_advance" | "liquidity_injection">("qe");
  const [bondId, setBondId] = useState(data.eligibleBonds[0]?._id ?? "");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingOperation = useRef<{ signature: string; operationId: string } | null>(null);
  const fmt = (amount: number) => formatNativeCurrency(amount, data.currencyCode);
  const isBondOperation = type === "qe" || type === "qt";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const numeric = Number(value);
    try {
      const signature = JSON.stringify({
        countryId,
        type,
        bondId: isBondOperation ? bondId : undefined,
        amount: numeric,
        reason: reason.trim(),
      });
      if (pendingOperation.current?.signature !== signature) {
        pendingOperation.current = { signature, operationId: crypto.randomUUID() };
      }
      const response = await fetch(`/api/country/${countryId}/central-bank/monetary-operation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          operationId: pendingOperation.current?.operationId,
          ...(isBondOperation ? { bondId, units: Math.floor(numeric) } : { amount: numeric }),
          reason: reason || undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        if ([400, 403, 409, 422].includes(response.status)) pendingOperation.current = null;
        throw new Error(json.error ?? "Monetary operation failed");
      }
      setMessage(`${operationLabel(type)} completed: ${fmt(json.operation.amount)}`);
      pendingOperation.current = null;
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
    [t("money.npcDeposits"), data.bankDeposits ?? 0],
    [t("money.bondCash"), data.bondPoolCash ?? 0],
    ["Bond settlement cash (outside M2)", data.excludedBondPoolCash ?? 0],
    [t("money.equityCash"), data.equityPoolCash ?? 0],
  ] as const;

  return (
    <div className="space-y-12 pb-16">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
        <CentralBankFigure label="M1 · spendable money" value={fmt(data.m1)} size="lg" />
        <CentralBankFigure
          label="M2 · spendable money plus savings"
          value={fmt(data.m2)}
          size="lg"
        />
        <CentralBankFigure
          label="Annualized M2 growth"
          value={
            growth == null
              ? t("money.collecting")
              : `${growth >= 0 ? "+" : ""}${growth.toFixed(2)}%`
          }
          size="lg"
        />
        <CentralBankFigure
          label="Credit outstanding"
          value={fmt(data.creditOutstanding)}
          size="lg"
        />
      </div>

      {growth == null && (
        <p className="-mt-6 max-w-3xl text-body text-muted">
          {t(
            data.accountingVersion === MONEY_ACCOUNTING_VERSION
              ? "money.transition"
              : "money.legacy"
          )}
        </p>
      )}

      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
        <CentralBankSection
          title={`Monetary stock · turn ${data.turn}`}
          meta={t("money.stockExplanation")}
        >
          <div>
            {components.map(([label, amount]) => (
              <Row key={label} label={label} value={fmt(amount)} />
            ))}
          </div>
          {(data.estimatedHouseholdLiquid != null || data.estimatedHouseholdSavings != null) && (
            <div className="mt-4 border-t border-card-border pt-2">
              <Row
                label={t("money.estimatedCash")}
                value={fmt(data.estimatedHouseholdLiquid ?? 0)}
              />
              <Row
                label={t("money.estimatedSavings")}
                value={fmt(data.estimatedHouseholdSavings ?? 0)}
              />
            </div>
          )}
        </CentralBankSection>

        <CentralBankSection title="Bonds, reserves and issuance">
          <div>
            <Row label="Sovereign bonds outstanding" value={fmt(data.sovereignBondsOutstanding)} />
            <Row label="Central-bank bond holdings" value={fmt(data.centralBankBondHoldings)} />
            <Row label="Lending reserves" value={fmt(data.bankReserves)} />
            <Row label="Net explicit money creation" value={fmt(data.netMoneyCreatedLifetime)} />
          </div>
          <p className="mt-4 text-body-sm text-muted">
            Selling bonds is how the government pays for itself. Buying government bonds back off
            the market creates new money. Selling them again destroys it. A direct advance to the
            Treasury creates spendable money straight away. Lending more to banks only becomes money
            in circulation once someone actually borrows it.
          </p>
        </CentralBankSection>
      </div>

      {data.lastPolicyEvaluation && (
        <CentralBankSection
          title={`Monetary committee assessment · turn ${data.lastPolicyEvaluation.turn}`}
          action={
            <span className="text-body font-semibold text-foreground">
              {operationLabel(data.lastPolicyEvaluation.decision)}
            </span>
          }
        >
          <p className="max-w-3xl text-body text-foreground">
            {data.lastPolicyEvaluation.rationale}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
            <CentralBankFigure
              label="Inflation / target"
              value={`${data.lastPolicyEvaluation.inflation.toFixed(2)}% / ${data.lastPolicyEvaluation.targetInflation.toFixed(2)}%`}
            />
            <CentralBankFigure
              label="Real GDP growth"
              value={`${data.lastPolicyEvaluation.gdpGrowth.toFixed(2)}%`}
            />
            <CentralBankFigure
              label={`Annualized M2 growth${data.lastPolicyEvaluation.moneyGrowthReliable ? "" : " · provisional"}`}
              value={
                policyGrowth == null || !data.lastPolicyEvaluation.moneyGrowthReliable
                  ? t("money.unavailable")
                  : `${policyGrowth.toFixed(2)}%`
              }
            />
            <CentralBankFigure
              label="Lending reserves"
              value={fmt(data.lastPolicyEvaluation.bankReserves)}
            />
          </div>
        </CentralBankSection>
      )}

      {canOperate && (
        <form onSubmit={submit}>
          <CentralBankSection title="Monetary operation">
            <div className="grid gap-3 md:grid-cols-4">
              <select
                value={type}
                onChange={(event) => setType(event.target.value as typeof type)}
                className="rounded-md border border-card-border bg-background px-3 py-2 text-body"
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
                  className="rounded-md border border-card-border bg-background px-3 py-2 text-body"
                >
                  {data.eligibleBonds.map((bond) => (
                    <option key={bond._id} value={bond._id}>
                      {bond.issuerName ?? "Sovereign"} · {bond.couponRate.toFixed(2)}% · turn{" "}
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
                className="rounded-md border border-card-border bg-background px-3 py-2 text-body"
              />
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Policy rationale"
                maxLength={240}
                className="rounded-md border border-card-border bg-background px-3 py-2 text-body"
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy || (isBondOperation && !bondId)}>
                {busy ? "Executing…" : "Execute operation"}
              </Button>
              {message && <p className="text-body-sm text-success">{message}</p>}
              {error && <p className="text-body-sm text-error">{error}</p>}
            </div>
          </CentralBankSection>
        </form>
      )}

      <CentralBankSection title="Recent policy operations">
        <div>
          {[...data.operations]
            .reverse()
            .slice(0, 12)
            .map((operation, index) => (
              <div
                key={`${operation.turn}:${operation.type}:${index}`}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border/60 py-2 text-body"
              >
                <span>
                  Turn {operation.turn} · {operationLabel(operation.type)} · {operation.actorName}
                </span>
                <span className="font-mono tabular-nums">{fmt(operation.amount)}</span>
                {operation.reason && (
                  <span className="w-full text-body-sm text-muted">{operation.reason}</span>
                )}
              </div>
            ))}
          {data.operations.length === 0 && (
            <p className="text-body text-muted">No operations yet.</p>
          )}
        </div>
      </CentralBankSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <CentralBankRow label={label} value={<span className="font-mono">{value}</span>} />;
}
