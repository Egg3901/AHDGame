"use client";
import { supplyEstimateCsv } from "@/lib/corporations/groups/rules/supplyPresentation";
import type { GroupSupplyPolicy } from "@/lib/corporations/groups/managementTypes";
import styles from "./GroupPage.module.css";
import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { GroupManagementView } from "./useGroupManagement";
export function GroupSupplyForecast({
  data,
  policy = data.settings.supplyPolicy,
}: {
  data: GroupManagementView;
  policy?: GroupSupplyPolicy;
}) {
  const t = useTranslations("corporations.group"),
    { formatAmount } = useCurrency();
  const forecast = data.forecast;
  if (!forecast) return <p className="text-sm text-muted">{t("forecastPending")}</p>;
  const coordinated = policy === "members";
  const policyName = t("policies." + policy);
  const rows = forecast.corporations.map((r) => ({
    ...r,
    name: data.members.find((m) => m.id === r.id)?.name ?? r.id,
  }));
  const summary = forecast.total ?? (rows.length === 1 ? rows[0] : null);
  const signed = (value: number) => (value > 0 ? "+" : "") + formatAmount(value);
  function exportEstimates() {
    const exportRows = rows.map((r) => ({ ...r, name: r.name }));
    if (forecast?.total)
      exportRows.push({
        ...forecast.total,
        id: "group-total",
        name: t("groupTotal"),
        receivingValue: forecast.total.internalTradingValue,
        supplyingValue: forecast.total.internalTradingValue,
      });
    const csv = supplyEstimateCsv(
      exportRows,
      [
        [t("supplyUI.basisTurn"), forecast!.basisTurn],
        [t("supplyUI.effectiveTurn"), forecast!.appliesTurn],
        [t("supplyUI.policy"), policyName],
        [t("supplyUI.discount"), (data.settings.supplyDiscount ?? 0) * 100],
        [t("supplyUI.currency"), t("supplyUI.anchor")],
        [t("supplyUI.exportNote")],
      ],
      [
        t("member"),
        t("independentSales"),
        t("groupSales"),
        t("revenueDifference"),
        t("profitDifference"),
        t("receivingValue"),
        t("supplyUI.supplying"),
      ]
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
      a = document.createElement("a");
    a.href = url;
    a.download = "subsidiary-group-supply-anchor.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className={`${styles.page} rounded-xl border border-card-border bg-card p-5 space-y-3`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="font-semibold">{t("estimates")}</h3>
        <button
          type="button"
          className="rounded-lg border border-card-border px-3 py-2 text-sm disabled:opacity-50 hover:bg-card-elevated"
          disabled={!rows.length}
          onClick={exportEstimates}
        >
          {t("supplyUI.export")}
        </button>
      </div>
      <p className="text-xs text-muted">{t("supplyUI.counterfactual")}</p>
      {summary && (
        <div className="grid gap-4 rounded-lg bg-background p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">{t("supplyUI.sales")}</p>
            <strong className="mt-2 block text-xl">
              {formatAmount(coordinated ? summary.coordinatedRevenue : summary.independentRevenue)}
            </strong>
            <p className="mt-1 text-xs text-muted">
              {signed(coordinated ? summary.revenueDifference : 0)} {t("supplyUI.vsIndependence")}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("supplyUI.profit")}</p>
            <strong
              className={
                (coordinated && summary.operatingProfitDifference < 0
                  ? "text-error"
                  : "text-foreground") + " mt-2 block text-xl"
              }
            >
              {signed(coordinated ? summary.operatingProfitDifference : 0)}
            </strong>
            <p className="mt-1 text-xs text-muted">{t("supplyUI.vsIndependence")}</p>
          </div>
          <div>
            <p className="text-xs text-muted">{t("supplyUI.internal")}</p>
            <strong className="mt-2 block text-xl">
              {formatAmount(
                coordinated
                  ? "internalTradingValue" in summary
                    ? summary.internalTradingValue
                    : summary.receivingValue
                  : 0
              )}
            </strong>
            <p className="mt-1 text-xs text-muted">
              {forecast.total ? t("groupTotal") : t("supplyUI.privateSummary")}
            </p>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        {t("forecastBasis", { turn: forecast.basisTurn, effective: forecast.appliesTurn })}
      </p>

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
              <tr key={r.id} className="border-t border-card-border">
                <td className="p-2">{r.name}</td>
                <td>{formatAmount(coordinated ? r.coordinatedRevenue : r.independentRevenue)}</td>
                <td>{formatAmount(coordinated ? r.operatingProfitDifference : 0)}</td>
                <td>{formatAmount(coordinated ? r.receivingValue : 0)}</td>
              </tr>
            ))}
          </tbody>
          {forecast.total && (
            <tfoot>
              <tr className="border-t border-card-border font-semibold">
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
          <table className="w-full text-sm" aria-label={t("comparePolicies")}>
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
                <tr className="border-t border-card-border" key={r.id}>
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
                <tr className="border-t border-card-border font-semibold">
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
      <p className="text-xs text-muted">{t("supplyUI.exportNote")}</p>
    </section>
  );
}
