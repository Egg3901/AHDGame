/**
 * Gated domestic sovereign-bond coverage shell (#1001).
 *
 * When gameConfig.domesticSovereignBondCoverageEnabled is exactly true,
 * ensures one home-sovereign bond fund per uncovered sovereign issuer (see
 * ./rules for the plan). The funds themselves are seeded with the standing
 * fund-creation economics (initial NAV, reserve units, seed cash); every
 * bond they ever hold is bought afterwards by the existing fund-cron deploy
 * pass through purchaseBondUnitsForFund, which debits real fund cash at
 * market quotes under the holder cap. This step mints no per-purchase cash,
 * guarantees no subscription, touches no other fund, and changes nothing
 * when the flag is absent or false (it returns before any read or write).
 */

import { ObjectId, type Db } from "mongodb";
import type { Bond, GameConfig, IndexFund, IndexFundPosition } from "@/lib/db/types";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { resolveFundBondCountryId } from "@/lib/indexFunds/fundBondReserve";
import {
  INDEX_FUND_INITIAL_NAV,
  INDEX_FUND_SEED_CASH_ANCHOR,
  INDEX_FUND_SEED_RESERVE_UNITS,
} from "@/lib/indexFunds/unitAccounting";
import {
  buildDomesticSovereignBondFundSeed,
  planDomesticSovereignCoverage,
} from "@/lib/indexFunds/domesticSovereignCoverage/rules";

export interface EnsureDomesticCoverageResult {
  /** Sorted country ids ensured this pass (inserted now, not merely planned). */
  ensured: string[];
}

export async function ensureDomesticSovereignBondFunds(
  db: Db,
  options: { enabled: boolean }
): Promise<EnsureDomesticCoverageResult> {
  if (options.enabled !== true) return { ensured: [] };

  const registered = await getRegisteredCountryIds(db);
  const budgets = await db
    .collection<{ _id: string }>("federalBudget")
    .find(
      { _id: { $in: registered.map((countryId) => getNationalBudgetId(countryId)) } },
      { projection: { _id: 1 } }
    )
    .toArray();
  const budgetedCountryIds = budgets.map((doc) => (doc._id === "federal" ? "US" : String(doc._id)));
  const liveIssuerCountryIds = (
    await db.collection<Bond>("bonds").distinct("countryId", {
      issuerType: "sovereign",
      matured: false,
      defaulted: { $ne: true },
    })
  ).flatMap((value) => (typeof value === "string" && value.length > 0 ? [value] : []));
  const serviceableFunds = await db
    .collection<IndexFund>("indexFunds")
    .find(
      { $or: [{ status: "active" }, { status: "paused", pauseReason: "backing_ratio" }] },
      { projection: { countryId: 1, anchorCurrencyCode: 1, scope: 1 } }
    )
    .toArray();
  const coveredHomeCountryIds = serviceableFunds
    .map((fund) => resolveFundBondCountryId(fund))
    .filter((value): value is NonNullable<typeof value> => value !== undefined);

  const planned = planDomesticSovereignCoverage({
    enabled: true,
    registeredCountryIds: registered,
    budgetedCountryIds,
    liveSovereignIssuerCountryIds: liveIssuerCountryIds,
    coveredHomeCountryIds,
    anchorCurrencyByCountryId: COUNTRY_CURRENCY_MAP as unknown as Record<string, string>,
  });
  if (planned.length === 0) return { ensured: [] };

  // Insert-missing by slug: a fund seeded by the bond-fund migration (or a
  // previous pass) is left alone, never rewritten.
  const seeds = planned.map((countryId) =>
    buildDomesticSovereignBondFundSeed(
      countryId,
      COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] as string
    )
  );
  const existingSlugs = new Set(
    (
      await db
        .collection<IndexFund>("indexFunds")
        .find({ slug: { $in: seeds.map((seed) => seed.slug) } }, { projection: { slug: 1 } })
        .toArray()
    ).map((fund) => fund.slug)
  );
  const missing = seeds.filter((seed) => !existingSlugs.has(seed.slug));
  if (missing.length === 0) return { ensured: [] };

  const now = new Date();
  const ensured: string[] = [];
  const funds = db.collection<IndexFund>("indexFunds");
  const positions = db.collection<IndexFundPosition>("indexFundPositions");
  for (const seed of missing) {
    const fundId = new ObjectId();
    await funds.insertOne({
      _id: fundId,
      slug: seed.slug,
      name: seed.name,
      tickerSymbol: seed.ticker,
      scope: seed.scope,
      kind: seed.kind,
      countryId: seed.countryId,
      anchorCurrencyCode: seed.anchorCurrencyCode,
      status: "active",
      quotedNav: INDEX_FUND_INITIAL_NAV,
      unitSupply: INDEX_FUND_SEED_RESERVE_UNITS,
      reserveUnits: INDEX_FUND_SEED_RESERVE_UNITS,
      cashAnchor: INDEX_FUND_SEED_CASH_ANCHOR,
      targetConstituents: [],
      holdings: [],
      createdAt: now,
      updatedAt: now,
    } as IndexFund);
    await positions.updateOne(
      { fundId, holderKind: "fund_reserve" },
      {
        $setOnInsert: { fundId, holderKind: "fund_reserve", createdAt: now },
        $set: {
          units: INDEX_FUND_SEED_RESERVE_UNITS,
          avgNavAnchor: INDEX_FUND_INITIAL_NAV,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
    ensured.push(seed.countryId);
  }
  return { ensured: ensured.sort() };
}

/** Projected gameConfig read for the gate; null/undefined counts as off. */
export function domesticCoverageEnabled(
  config: Pick<GameConfig, "domesticSovereignBondCoverageEnabled"> | null | undefined
): boolean {
  return config?.domesticSovereignBondCoverageEnabled === true;
}
