"use client";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { GroupManagementView } from "./useGroupManagement";
export function GroupSupplyForecast({ data }: { data: GroupManagementView }) {
  const t = useTranslations("corporations.group"),
    { formatAmount } = useCurrency();
  const forecast = data.forecast;
  if (!forecast) return <p className="text-sm text-muted">{t("forecastPending")}</p>;
  const coordinated = data.settings.supplyPolicy === "members";
  const policyName = t("policies." + data.settings.supplyPolicy);
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
      <h4 className="font-semibold">{t("selectedEstimate", { policy: policyName })}</h4>
      <p className="text-xs text-muted">{t("selectedEstimateNote")}</p>
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          aria-label={t("selectedEstimate", { policy: policyName })}
        >
          <thead>
            <tr>
              {["member", "selectedSales", "selectedProfitImpact", "receivingValue"].map((k) => (
                <th key={k} className="text-left p-2">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2">{r.name}</td>
                <td>{formatAmount(coordinated ? r.coordinatedRevenue : r.independentRevenue)}</td>
                <td>{formatAmount(coordinated ? r.operatingProfitDifference : 0)}</td>
                <td>{formatAmount(coordinated ? r.receivingValue : 0)}</td>
              </tr>
            ))}
          </tbody>
          {forecast.total && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="p-2">{t("groupTotal")}</td>
                <td>
                  {formatAmount(
                    coordinated
                      ? forecast.total.coordinatedRevenue
                      : forecast.total.independentRevenue
                  )}
                </td>
                <td>{formatAmount(coordinated ? forecast.total.operatingProfitDifference : 0)}</td>
                <td>{formatAmount(coordinated ? forecast.total.internalTradingValue : 0)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm underline">{t("comparePolicies")}</summary>
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
      </details>
      <p className="text-xs text-muted">{t("combinedForecastNote")}</p>
    </section>
  );
}
