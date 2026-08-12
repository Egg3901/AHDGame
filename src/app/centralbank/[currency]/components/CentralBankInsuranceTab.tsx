"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";

type CurrencyPayload = {
  privateBankingEnabled: boolean;
  currency: CurrencyCode;
  insuranceFund: {
    balance: number;
    insuredCap: number;
    premiumsCollectedLifetime: number;
    payoutsLifetime: number;
    treasuryBackstopLifetime: number;
  };
};

interface Props {
  currency: CurrencyCode;
}

export function CentralBankInsuranceTab({ currency }: Props) {
  const [data, setData] = useState<CurrencyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/banking/currency/${currency.toLowerCase()}`);
      const json = (await res.json().catch(() => ({}))) as CurrencyPayload & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to load insurance fund");
        setData(null);
        return;
      }
      setError(null);
      setData(json);
    } catch {
      setError("Failed to load insurance fund");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  if (error || !data) {
    return <EmptyState title="Insurance fund unavailable" description={error ?? undefined} />;
  }

  const fund = data.insuranceFund;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Deposit insurance fund</h2>
        <p className="mt-1 text-sm text-muted">
          Premium-funded fund for {currency}. Balances above the insured cap can take a haircut on
          bank failure. A drained fund draws a Treasury backstop into the federal budget.
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y divide-card-border sm:divide-y-0 sm:divide-x">
          <FundCell label="Fund balance" value={formatBankMoney(fund.balance, currency)} />
          <FundCell label="Insured cap" value={formatBankMoney(fund.insuredCap, currency)} />
          <FundCell
            label="Premiums collected"
            value={formatBankMoney(fund.premiumsCollectedLifetime, currency)}
            sub="lifetime"
          />
          <FundCell
            label="Payouts"
            value={formatBankMoney(fund.payoutsLifetime, currency)}
            sub="lifetime"
          />
          <FundCell
            label="Treasury backstop"
            value={formatBankMoney(fund.treasuryBackstopLifetime, currency)}
            sub="lifetime"
          />
        </div>
      </div>
      {!data.privateBankingEnabled && (
        <p className="text-sm text-muted">
          Private banking is frozen. Fund figures remain visible but no new premiums accrue until
          banking is re-enabled.
        </p>
      )}
    </div>
  );
}

function FundCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-1 font-mono text-base font-bold tabular-nums text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}
