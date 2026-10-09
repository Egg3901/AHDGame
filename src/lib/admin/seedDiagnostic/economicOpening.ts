/**
 * Opening economy checks qualify the 1991 reset before corporations invest.
 * checkEconomicOpening reads fiscal, currency, capital and market documents.
 */
import type { Db } from "mongodb";
import { OPERATING_SECTOR_TYPES } from "@/lib/constants/corporations";
import {
  getOperatingSectorType,
  getStrategyForOperatingModel,
} from "@/lib/constants/sectorStrategies";
import { COMMODITY_BASE_PRICES, type ExtractableResource } from "@/lib/constants/commodities";
import { FOREX_ACTIVE_CURRENCIES, getSeedCurrencyCode } from "@/lib/constants/currencies";
import { getPresetMonetaryScope } from "@/lib/monetaryPolicy/presetMonetaryScope";
import { countriesByTier } from "@/lib/world/eraRoster";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { Corporation } from "@/lib/db/types/corporation";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { MacroCountryState } from "@/lib/world/macro/types";
import type { Bond } from "@/lib/db/types/bond";
import type { SeedDiagnosticCheck } from "./types";
import { check } from "./checkFactory";
import { nonFinitePaths, openingBalanceWithinEnvelope, reconciles } from "./rules/economicOpening";
import { OPENING_INFLATION_BOUNDS } from "@/lib/seeds/reference/openingInflation1991";
import { openingInflationProblem } from "@/lib/seeds/reference/rules/openingInflation";

export async function checkEconomicOpening(db: Db, preset: string): Promise<SeedDiagnosticCheck[]> {
  if (preset !== "1991-default") return [];
  const [fx, banks, budgets, corporations, sectors, resources, macro, bonds, funds] =
    await Promise.all([
      db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
      db.collection<{ countryId: string; primeRate: number }>("centralBanks").find({}).toArray(),
      db.collection<FederalBudget>("federalBudget").find({}).toArray(),
      db.collection<Corporation>("corporations").find({}).toArray(),
      db.collection("corporateSectors").find({}).toArray(),
      db.collection<StateResourceCapacity>("stateResourceCapacity").find({}).toArray(),
      db.collection<MacroCountryState>("macroCountries").find({}).toArray(),
      db.collection<Bond>("bonds").find({ issuerType: "sovereign", defaulted: false }).toArray(),
      db.collection("indexFunds").find({}).toArray(),
    ]);
  const checks: SeedDiagnosticCheck[] = [];
  const assert = (scope: string, metric: string, valid: boolean, note?: string) => {
    checks.push(
      check(
        `opening.${scope}.${metric}`,
        scope,
        metric,
        "valid",
        valid ? "valid" : "invalid",
        valid ? "ok" : "critical",
        note
      )
    );
  };
  const scope = getPresetMonetaryScope(preset);
  const bankCountries = new Set<string>(scope.centralBankCountries);
  for (const country of scope.forexCountries) {
    const rows = fx.filter((row) => row.countryId === country);
    const row = rows[0];
    assert(
      country,
      "currency",
      rows.length === 1 &&
        !!row &&
        row.currencyCode === getSeedCurrencyCode(country, preset) &&
        FOREX_ACTIVE_CURRENCIES.includes(row.currencyCode) &&
        [row.rate, row.baseRate, row.macroTarget].every((n) => Number.isFinite(n) && n > 0)
    );
  }
  for (const country of scope.centralBankCountries) {
    const rows = banks.filter((row) => row.countryId === country);
    assert(
      country,
      "borrowing-rate",
      rows.length === 1 && rows[0]!.primeRate >= 0 && rows[0]!.primeRate <= 5
    );
  }
  const playerCountries = countriesByTier("1991-default", "player");
  const players = new Set<string>(playerCountries);
  for (const budget of budgets) {
    const country = budget.countryId!;
    assert(
      country,
      "fiscal-accounting",
      nonFinitePaths(budget).length === 0 &&
        budget.gdp > 0 &&
        budget.debt.principal >= 0 &&
        reconciles(budget.debtToGdpRatio, budget.debt.principal / budget.gdp) &&
        reconciles(budget.surplus, budget.revenue.total - budget.spending.total) &&
        reconciles(
          budget.spending.total,
          Object.values(budget.spending.byCategory).reduce((a, b) => a + b, 0) +
            budget.spending.stateGrants +
            budget.spending.debtInterest
        )
    );
    const instruments = bonds.filter((bond) => bond.countryId === country);
    if (bankCountries.has(country) && budget.debt.principal > 0) {
      const face = instruments.reduce((sum, bond) => sum + bond.totalIssued, 0);
      const coupons = instruments.reduce(
        (sum, bond) => sum + (bond.totalIssued * bond.couponRate) / 100,
        0
      );
      assert(
        country,
        "debt-instruments",
        reconciles(face, budget.debt.principal) &&
          reconciles(coupons, budget.spending.debtInterest),
        `principal=${face}; annual coupons=${coupons}`
      );
    }
    if (players.has(country)) {
      assert(
        country,
        "opening-deficit",
        openingBalanceWithinEnvelope(budget.surplus, budget.gdp),
        `${((-100 * budget.surplus) / budget.gdp).toFixed(4)}% GDP`
      );
    }
  }
  for (const country of scope.centralBankCountries) {
    assert(
      country,
      "budget-presence",
      budgets.filter((budget) => budget.countryId === country).length === 1
    );
  }
  for (const country of playerCountries) {
    const local = corporations.filter(
      (corp) => corp.countryId === country && corp.ceoType === "npp"
    );
    assert(
      country,
      "competitor-names",
      new Set(local.map((corp) => corp.name.toLowerCase())).size === local.length
    );
    for (const type of OPERATING_SECTOR_TYPES) {
      const peers = local.filter(
        (corp) =>
          getOperatingSectorType(corp.type, corp.industryModel, corp.mediaDiscriminator) === type
      );
      assert(
        country,
        `competitors-${type}`,
        peers.some((corp) =>
          sectors.some(
            (sector) =>
              String(sector.corporationId) === String(corp._id) &&
              sector.revenue > 0 &&
              sector.capitalStock > 0
          )
        )
      );
    }
    const charters = local
      .map((corp) => corp.bankCharter)
      .filter((charter) => charter?.status === "active");
    assert(
      country,
      "credit-capital",
      charters.length >= 2 &&
        charters.every(
          (charter) =>
            charter!.postedCapital > 0 &&
            (charter!.cashReserves ?? 0) > 0 &&
            charter!.currency === getSeedCurrencyCode(country, preset)
        )
    );
    const deposits = resources.filter((row) => row.countryId === country);
    assert(
      country,
      "resource-capacity",
      deposits.length > 0 &&
        deposits.every(
          (row) =>
            nonFinitePaths(row.resources).length === 0 &&
            Object.values(row.resources).every((n) => n! >= 0)
        ) &&
        deposits.some((row) => Object.values(row.resources).some((n) => n! > 0))
    );
    const miners = sectors.filter(
      (sector) =>
        sector.sectorType === "extraction" &&
        local.some((corp) => String(corp._id) === String(sector.corporationId))
    );
    assert(
      country,
      "resource-entry-headroom",
      miners.length > 0 &&
        miners.every((sector) => {
          const deposit = deposits.find((row) => row.stateId === sector.stateId);
          const recipe = getStrategyForOperatingModel(
            "extraction",
            sector.strategyId ?? "standard"
          );
          const outputs = Object.entries(recipe.supply).filter(([, share]) => share! > 0);
          const yieldPerAnchor = outputs.reduce(
            (sum, [resource, share]) =>
              sum + share! / COMMODITY_BASE_PRICES[resource as ExtractableResource],
            0
          );
          return (
            !!deposit &&
            outputs.every(([resource, share]) => {
              const units =
                (sector.capitalStock * share!) /
                COMMODITY_BASE_PRICES[resource as ExtractableResource] /
                yieldPerAnchor;
              return (
                units > 0 &&
                units <= (deposit.resources[resource as ExtractableResource] ?? 0) * 0.250001
              );
            })
          );
        })
    );
  }
  const macroEntries = getWorldEntityPresetManifest(preset).entries.filter(
    (entry) =>
      entry.status === "sovereign" &&
      (entry.simulationTier === "background-macro" || entry.simulationTier === "sphere-macro")
  );
  for (const entry of macroEntries) {
    const rows = macro.filter((row) => row.entityId === entry.entityId);
    const row = rows[0];
    assert(
      entry.entityId,
      "aggregate-economy",
      rows.length === 1 &&
        !!row &&
        row.population > 0 &&
        nonFinitePaths(row).length === 0 &&
        row.dataQuality.missingFields.length === 0 &&
        row.dataQuality.fallbackFields.length === 0 &&
        Object.values(row.sectors).every(
          (sector) =>
            !!sector &&
            sector.capacity >= 0 &&
            sector.domesticDemand >= 0 &&
            sector.productivity > 0
        )
    );
  }
  assert(
    "world",
    "macro-roster",
    macro.every((row) => macroEntries.some((entry) => entry.entityId === row.entityId))
  );
  assert(
    "world",
    "finite-markets",
    sectors.every(
      (row) => nonFinitePaths(row).length === 0 && row.revenue >= 0 && (row.capitalStock ?? 0) >= 0
    )
  );
  assert(
    "world",
    "market-ownership",
    sectors.every((sector) =>
      corporations.some((corp) => String(corp._id) === String(sector.corporationId))
    )
  );
  assert(
    "world",
    "index-fund-capital",
    funds.length > 0 && funds.every((row) => nonFinitePaths(row).length === 0)
  );
  // #3317: opening CPI and wage growth must be supported gameplay values, not
  // historical hyperinflation the first recalculation would snap.
  for (const budget of budgets) {
    const problem = openingInflationProblem(
      budget.countryId!,
      budget.economicFactors,
      OPENING_INFLATION_BOUNDS
    );
    assert(budget.countryId!, "opening-inflation", problem === null, problem ?? undefined);
  }
  assert(
    "DD",
    "post-reunification-absence",
    !fx.some((row) => row.countryId === "DD") && !banks.some((row) => row.countryId === "DD")
  );
  return checks;
}
