"use client";
import { FundPagination, FUND_PAGE_SIZE } from "./FundPagination";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FundBondHoldingRow } from "./types";

export function BondHoldingsPanel({
  holdings,
  formatAmount,
  ccy,
}: {
  holdings: FundBondHoldingRow[];
  formatAmount: (n: number, c?: CurrencyCode) => string;
  ccy: CurrencyCode;
}) {
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(holdings.length / FUND_PAGE_SIZE)));
  const t = useTranslations("corporations");
  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card shadow-sm">
      <h2 className="border-b border-card-border px-5 py-4 text-sm font-semibold">
        {t("fundBondHoldings.title")}
      </h2>
      {holdings.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">{t("fundBondHoldings.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="px-5 py-3">{t("fundBondHoldings.issuer")}</th>
                <th className="px-5 py-3">{t("fundBondHoldings.units")}</th>
                <th className="px-5 py-3">{t("fundBondHoldings.coupon")}</th>
                <th className="px-5 py-3">{t("fundBondHoldings.maturity")}</th>
                <th className="px-5 py-3 text-right">{t("fundBondHoldings.value")}</th>
              </tr>
            </thead>
            <tbody>
              {holdings
                .slice((currentPage - 1) * FUND_PAGE_SIZE, currentPage * FUND_PAGE_SIZE)
                .map((holding) => (
                  <tr key={holding.bondId} className="border-t border-card-border">
                    <td className="px-5 py-3">
                      {holding.sequentialId != null ? (
                        <a
                          className="text-primary hover:underline"
                          href={`/corporation/${holding.sequentialId}`}
                        >
                          {holding.issuerName}
                        </a>
                      ) : (
                        holding.issuerName
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono">{holding.units.toLocaleString()}</td>
                    <td className="px-5 py-3 font-mono">{holding.couponRate.toFixed(2)}%</td>
                    <td className="px-5 py-3 font-mono">{holding.maturityTurn}</td>
                    <td className="px-5 py-3 text-right font-mono">
                      {formatAmount(holding.valueAnchor, ccy)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <FundPagination page={currentPage} total={holdings.length} onChange={setPage} />
    </section>
  );
}
