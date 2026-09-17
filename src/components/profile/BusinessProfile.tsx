"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { BusinessProfileView } from "@/lib/character/businessProfileView";
export function BusinessProfile({ data }: { data: BusinessProfileView }) {
  const t = useTranslations("profile.views");
  const money = (n: number) => `₳${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return (
    <section className="space-y-5 rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("businessTitle")}</h2>
      {data.corporation && (
        <div>
          <p className="text-xs text-muted">{t("ceo")}</p>
          <h3 className="font-semibold">{data.corporation.name}</h3>
          {data.corporation.id && (
            <Link className="text-primary" href={`/corporation/${data.corporation.id}`}>
              {t("corporation")}
            </Link>
          )}
        </div>
      )}
      {data.isInvestor && <p className="font-medium">{t("investor")}</p>}
      {data.finances ? (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              [t("equityValue"), data.finances.portfolioValue],
              [t("dividends"), data.finances.dividendIncomePerTurn],
              [t("coupons"), data.finances.bondIncomePerTurn],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-lg font-semibold">{money(Number(value))}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-3 text-sm">
            <span>{t("stocks", { count: data.finances.equityHoldingCount })}</span>
            <span>{t("bonds", { count: data.finances.bondHoldingCount })}</span>
            {data.finances.hasFundHoldings && <span>{t("funds")}</span>}
          </div>
          <Link className="inline-block rounded bg-primary px-4 py-2 text-white" href="/portfolio">
            {t("portfolio")}
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted">{t("private")}</p>
      )}
    </section>
  );
}
