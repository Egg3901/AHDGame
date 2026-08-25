import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Guards the rule stated in corporationCapital.ts: "Use this for anything that
 * DISPLAYS or RANKS a value. Use loadFxRatesByCurrency for anything that
 * SETTLES one."
 *
 * The valuation map backfills an authored era rate for the six bloc currencies
 * that have no live `exchangeRates` row (PLZ, CSK, HUF, YUD, BGL, ROL — 102
 * corporations at turn 366). The settlement map deliberately leaves them
 * missing so a money-moving path fails closed instead of converting at 1.0.
 *
 * A file-level guard rather than a unit test because the defect is "this module
 * imported the wrong one of two identically-shaped functions", which no
 * behavioural test on a single module would catch.
 */
const DISPLAY_PATHS = [
  "src/lib/corporations/queries/corporationDetail.ts",
  "src/app/api/stock-exchange/wealth-list/route.ts",
  "src/lib/turn/investorWealthSnapshots.ts",
  "src/app/api/character/[id]/portfolio/route.ts",
  "src/lib/character/financialData.ts",
  "src/app/api/discord-bot/financials/route.ts",
  "src/app/api/discord-bot/corporation/route.ts",
  // Portfolio valuation must agree with the portfolio route above, including
  // the history series rendered on the same page.
  "src/lib/portfolio/loadCharacterPortfolio.ts",
  "src/lib/turn/portfolioSnapshot.ts",
  "src/app/api/corporations/[id]/portfolio/route.ts",
  "src/lib/world/legacyLeaderboard.ts",
];

/**
 * Where the line sits, because "this file performs no writes" is NOT the test.
 *
 * Use the VALUATION map when the surface values a holding for a human to read
 * or rank: portfolios, wealth lists, leaderboards, corp balance figures.
 *
 * Keep the SETTLEMENT map when the surface moves money OR when it exists to
 * mirror an engine computation. A market-share chart, a revenue base, an SOE
 * remittance or an inflation diagnostic must reproduce what the engine did, so
 * feeding it "better" rates would make it disagree with the thing it explains.
 * That is why `corpMarketShare`, `dailyGrossRevenue`, `publicEnterpriseRevenue`,
 * `soeRemittance` and `subsidyBudgetCosts` stay on the settlement map even
 * though several of them never write. The same reasoning keeps
 * `monetaryPolicy/queries/inflationDiagnostics` reading the stored `surplus`
 * cache rather than the derived value (it explains the engine's inflation math,
 * so it must use the engine's inputs); it takes no FX map, so it is not listed
 * below.
 */
const SETTLEMENT_PATHS = [
  "src/lib/banking/lending.ts",
  "src/lib/banking/propTrading.ts",
  "src/lib/corporations/cancelShareListing.ts",
  "src/lib/corporations/commands/takeovers/hostileTakeover.ts",
  "src/lib/budget/revenue.ts",
  // Engine mirrors: these must reproduce the engine's own numbers.
  "src/lib/corporations/corpMarketShare.ts",
  "src/lib/corporations/dailyGrossRevenue.ts",
  "src/lib/budget/publicEnterpriseRevenue.ts",
  "src/lib/nationalization/soeRemittance.ts",
];

describe("valuation vs settlement FX usage", () => {
  it.each(DISPLAY_PATHS)("%s uses the valuation map", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("loadValuationFxRates");
    expect(source).not.toContain("loadFxRatesByCurrency");
  });

  it.each(SETTLEMENT_PATHS)("%s keeps the settlement map", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("loadFxRatesByCurrency");
    expect(source).not.toContain("loadValuationFxRates");
  });
});
