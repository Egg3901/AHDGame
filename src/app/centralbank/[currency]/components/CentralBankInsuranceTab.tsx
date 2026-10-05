"use client";

import { apiErrorText } from "@/lib/errors/catalog";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { CentralBankFigure, CentralBankSection } from "./CentralBankSection";

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
        setError(apiErrorText(json, "Failed to load insurance fund"));
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
    <CentralBankSection
      title="Deposit insurance fund"
      meta={`Premium-funded fund for ${currency}. Balances above the insured cap can take a haircut on bank failure. A drained fund draws a Treasury backstop into the federal budget.`}
    >
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        <CentralBankFigure
          label="Fund balance"
          value={formatBankMoney(fund.balance, currency)}
          size="lg"
        />
        <CentralBankFigure
          label="Insured cap"
          value={formatBankMoney(fund.insuredCap, currency)}
          size="lg"
        />
        <CentralBankFigure
          label="Premiums collected"
          value={formatBankMoney(fund.premiumsCollectedLifetime, currency)}
          hint="Lifetime"
          size="lg"
        />
        <CentralBankFigure
          label="Payouts"
          value={formatBankMoney(fund.payoutsLifetime, currency)}
          hint="Lifetime"
          size="lg"
        />
        <CentralBankFigure
          label="Treasury backstop"
          value={formatBankMoney(fund.treasuryBackstopLifetime, currency)}
          hint="Lifetime"
          size="lg"
        />
      </div>
      {!data.privateBankingEnabled && (
        <p className="mt-6 text-body text-muted">
          Private banking is frozen. Fund figures remain visible but no new premiums accrue until
          banking is re-enabled.
        </p>
      )}
    </CentralBankSection>
  );
}
