"use client";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { GroupManagementView } from "./useGroupManagement";
export function GroupSupplyForecast({ data }: { data: GroupManagementView }) {
  const t = useTranslations("corporations.group"),
    { formatAmount } = useCurrency();
  const forecast = data.forecast;
  if (!forecast) return <p className="text-sm text-muted">{t("forecastPending")}</p>;
  const rows = forecast.corporations.map((r) => ({
    ...r,
    name: data.members.find((m) => m.id === r.id)?.name ?? r.id,
  }));
  return (
    <section className="rounded border border-border p-4 space-y-3">
      <h3 className="font-semibold">{t("estimates")}</h3>
      <p className="text-xs text-muted">
        {t("forecastBasis", { turn: forecast.basisTurn, effective: forecast.appliesTurn })}
      </p>
      <p className="text-sm text-muted">{t("forecastAssumptions")}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                "member",
                "independentSales",
                "groupSales",
                "revenueDifference",
                "profitDifference",
                "receivingValue",
              ].map((k) => (
                <th className="text-left p-2" key={k}>
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr className="border-t border-border" key={r.id}>
                <td className="p-2">{r.name}</td>
                <td>{formatAmount(r.independentRevenue)}</td>
                <td>{formatAmount(r.coordinatedRevenue)}</td>
                <td>{formatAmount(r.revenueDifference)}</td>
                <td>{formatAmount(r.operatingProfitDifference)}</td>
                <td>{formatAmount(r.receivingValue)}</td>
              </tr>
            ))}
          </tbody>
          {forecast.total && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="p-2">{t("groupTotal")}</td>
                <td>{formatAmount(forecast.total.independentRevenue)}</td>
                <td>{formatAmount(forecast.total.coordinatedRevenue)}</td>
                <td>{formatAmount(forecast.total.revenueDifference)}</td>
                <td>{formatAmount(forecast.total.operatingProfitDifference)}</td>
                <td>{formatAmount(forecast.total.internalTradingValue)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-muted">{t("combinedForecastNote")}</p>
    </section>
  );
}
