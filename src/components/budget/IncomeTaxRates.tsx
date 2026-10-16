"use client";
import { useTranslations } from "next-intl";
import { INCOME_TIERS, INCOME_TAX_KEYS, incomeTaxRate } from "@/lib/budget/rules/incomeTaxTiers";
import {
  CAPITAL_GAINS_TAX_KEYS,
  capitalGainsTaxRate,
  type CapitalGainsTaxRates as Rates,
} from "@/lib/budget/rules/capitalGainsTax";

export function IncomeTaxRates({
  rates,
  pending,
}: {
  rates: Rates;
  pending?: Partial<Record<string, number>>;
}) {
  const t = useTranslations("profile.incomeTax");
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <h3 className="font-medium mb-3">{t("incomeTitle")}</h3>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        {INCOME_TIERS.map((tier) => {
          const effective = incomeTaxRate(rates, tier);
          const target = pending?.[INCOME_TAX_KEYS[tier]];
          return (
            <div key={tier}>
              <dt className="text-muted">{t("tiers." + tier)}</dt>
              <dd className="tabular-nums">
                {effective}%
                {target !== undefined && target !== effective && (
                  <span className="block text-xs text-muted">{t("target", { rate: target })}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {INCOME_TIERS.some((tier) => rates[CAPITAL_GAINS_TAX_KEYS[tier]] !== undefined) && (
        <>
          <h3 className="font-medium mt-4 mb-3">{t("capitalGains")}</h3>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {INCOME_TIERS.map((tier) => {
              const rate = capitalGainsTaxRate(rates, tier);
              const target = pending?.[CAPITAL_GAINS_TAX_KEYS[tier]];
              return (
                <div key={tier}>
                  <dt className="text-muted">{t("tiers." + tier)}</dt>
                  <dd className="tabular-nums">
                    {rate}%
                    {target !== undefined && target !== rate && (
                      <span className="block text-xs text-muted">
                        {t("target", { rate: target })}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      )}
    </div>
  );
}
