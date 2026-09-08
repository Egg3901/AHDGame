"use client";

import { useTranslations } from "next-intl";
import { useCurrency } from "@/contexts/CurrencyContext";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { forecastSectorInvestment } from "@/lib/corporations/investment/rules";
import type { PlantsData } from "../types";

export default function InvestmentForecast({
  plants,
  units,
}: {
  plants: PlantsData;
  units: number;
}) {
  const t = useTranslations("corporations.sectorInvestment");
  const { formatAmount } = useCurrency();
  const pnl = plants.pnl;
  const assumptions = plants.investment;
  const forecast = assumptions
    ? forecastSectorInvestment({
        units,
        constructionPerUnitAnchor: plants.buildQuote.perUnitAnchor,
        chargedPerUnitAnchor: plants.buildQuote.perUnitChargedAnchor,
        buildTurns: plants.buildTurns,
        depreciationPerTurn: plants.depreciationPerTurn,
        turnsPerDay: TURNS_PER_DAY,
        capacityUnits: plants.capacityUnits ?? 0,
        activeFraction: plants.mothballed ? 0 : (plants.activeCapacityPercent ?? 100) / 100,
        producedUnits: plants.producedUnits ?? 0,
        soldUnits: plants.soldUnits ?? 0,
        demandGapUnits: plants.demandGapUnits ?? 0,
        revenueDailyAnchor: Math.max(
          0,
          pnl.revenueAnchor - (assumptions.inventoryRevenueDailyAnchor ?? 0)
        ),
        operatingCostDailyAnchor:
          pnl.inputsAnchor +
          pnl.labourAnchor +
          pnl.complianceAnchor +
          pnl.otherOperatingAnchor +
          pnl.growthAndBuildAnchor -
          (pnl.policyAnchor ?? 0) +
          (assumptions.freightNetCostDailyAnchor ?? 0),
        overheadDailyAnchor: assumptions.overheadDailyAnchor,
        upkeepDailyAnchor: pnl.upkeepAnchor,
        taxRatePercent: assumptions.taxRatePercent,
      })
    : null;
  return (
    <div className="rounded-lg border border-card-border p-3">
      <h3 className="text-body-sm font-semibold text-foreground">{t("forecastTitle")}</h3>
      {!forecast ? (
        <p className="mt-2 text-body-sm text-muted">{t("noForecast")}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {forecast.map((point) => (
              <div key={point.turns} className="rounded bg-background/50 p-2">
                <p className="text-body-sm font-semibold">{t("horizon", { turns: point.turns })}</p>
                <p
                  className={`mt-1 text-heading-sm font-bold tabular-nums ${point.availableCashAnchor > 0 ? "text-success" : "text-warning"}`}
                >
                  {point.cashReturnPercent.toFixed(1)}%
                </p>
                <p className="text-body-xs text-muted">{t("cashReturn")}</p>
                <dl className="mt-2 space-y-2 text-body-xs">
                  <div>
                    <dt>{t("cashAvailable")}</dt>
                    <dd>{formatAmount(point.availableCashAnchor)}</dd>
                  </div>
                  <div>
                    <dt>{t("salesDaily")}</dt>
                    <dd>{Math.round(point.soldUnitsDaily).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>{t("paidBasis")}</dt>
                    <dd>{formatAmount(point.remainingPaidBasisAnchor)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <details className="mt-3 text-body-xs text-muted">
            <summary className="cursor-pointer">{t("forecastAssumptions")}</summary>
            <p className="mt-2">
              {t("assumptions", { tax: assumptions?.taxRatePercent.toFixed(1) ?? "0" })}
            </p>
            <p className="mt-2">
              {t("deductions96", {
                overhead: formatAmount(forecast[1].overheadAnchor),
                tax: formatAmount(forecast[1].taxAnchor),
                replacement: formatAmount(forecast[1].replacementReserveAnchor),
              })}
            </p>
          </details>
          {(plants.demandGapUnits ?? 0) <= 0 && (
            <p className="mt-2 text-body-sm text-warning">{t("noDemand")}</p>
          )}
        </>
      )}
    </div>
  );
}
