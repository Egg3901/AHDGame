"use client";
import { useTranslations } from "next-intl";
import {
  INCOME_TIERS,
  INCOME_TAX_KEYS,
  incomeTaxRate,
  type IncomeTaxRates as Rates,
} from "@/lib/budget/rules/incomeTaxTiers";

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
      <h3 className="font-medium mb-3">{t("title")}</h3>
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
    </div>
  );
}
