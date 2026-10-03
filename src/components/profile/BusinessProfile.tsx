"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { BusinessProfileView } from "@/lib/character/businessProfileView";
import { SectionHeader } from "@/app/profile/components/ProfileMeters";
import { PROFILE_LINK_CLASS } from "@/app/profile/components/profileStyles";
export function BusinessProfile({ data }: { data: BusinessProfileView }) {
  const t = useTranslations("profile.views");
  const money = (n: number) => `₳${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return (
    <section className="space-y-5">
      <SectionHeader>{t("businessTitle")}</SectionHeader>
      {data.corporation && (
        <div>
          <p className="text-body-sm text-muted">{t("ceo")}</p>
          <h3 className="text-body-lg font-semibold text-foreground">{data.corporation.name}</h3>
          {data.corporation.id && (
            <Link
              className={`text-body-sm ${PROFILE_LINK_CLASS}`}
              href={`/corporation/${data.corporation.id}`}
            >
              {t("corporation")}
            </Link>
          )}
        </div>
      )}
      {data.isInvestor && <p className="text-body font-medium text-foreground">{t("investor")}</p>}
      {data.finances ? (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              [t("equityValue"), data.finances.portfolioValue],
              [t("dividends"), data.finances.dividendIncomePerTurn],
              [t("coupons"), data.finances.bondIncomePerTurn],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-body-sm text-muted">{label}</dt>
                <dd className="text-heading-sm font-semibold tabular-nums text-foreground">
                  {money(Number(value))}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-body text-muted">
            <span>{t("stocks", { count: data.finances.equityHoldingCount })}</span>
            <span>{t("bonds", { count: data.finances.bondHoldingCount })}</span>
            {data.finances.hasFundHoldings && <span>{t("funds")}</span>}
          </div>
          <Link
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-body font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            href="/portfolio"
          >
            {t("portfolio")}
          </Link>
        </>
      ) : (
        <p className="text-body text-muted">{t("private")}</p>
      )}
    </section>
  );
}
