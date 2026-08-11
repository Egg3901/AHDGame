/**
 * Re-seed a live `1991-default` world's enacted laws + policy positions to the
 * 1991 defaults and correct each country's expenditure — WITHOUT rewinding the
 * fiscal clock or discarding evolved revenue/GDP.
 *
 * Context (confirmed via dry-run 2026-06-03): the live world is already on the
 * `1991-default` preset and has simulated forward to fiscal year 1993, but
 * Ireland and China were seeded with no spending laws (IE ~€0.2B, CN ~¥149B —
 * basically debt service only). US/UK/JP/DE are healthy. This branch's
 * legislation fix adds the missing IE/CN spending programs; this script applies
 * the corrected defaults to the live world.
 *
 * Scope decision (2026-06-03): re-seed laws + policies + tax rates to the 1991
 * defaults for all countries (full reset of those surfaces — overwrites player
 * policy/tax changes), but PRESERVE each budget's evolved fiscalYear / taxBases /
 * gdp / debt / economicFactors. Revenue and spending are RECOMPUTED from the
 * re-seeded rates/laws against the live, evolved tax bases + GDP + population, so
 * they track the current simulation state while reflecting calibration fixes
 * (e.g. the corrected 1991 US income-tax rate).
 *
 * What it touches (and ONLY these):
 *   1. gameState.preset        -> "1991-default" (no-op if already set)
 *   2. enactedLaws (national)  -> wiped + re-seeded with the 1991 default set
 *                                 (adds the missing IE/CN spending laws)
 *   3. federalBudget           -> taxRates reset to 1991 defaults; debt principal
 *                                 ZEROED for all countries (one-time recompense —
 *                                 the live debt had spiralled to implausible
 *                                 levels, e.g. UK 282% of GDP, from running 2 FYs
 *                                 on miscalibrated budgets); revenue recomputed
 *                                 (live tax bases × new rates); spending
 *                                 recomputed (re-seeded laws × live gdp/pop, debt
 *                                 interest -> 0); surplus + baselineSpending*
 *                                 refreshed. fiscalYear/gdp/economicFactors/
 *                                 taxBases left untouched.
 *   4. statePolicies           -> wiped + re-seeded with 1991 base policies
 *                                 (resets policy positions for ALL countries).
 *
 * Explicitly PRESERVED: fiscalYear, taxBases, gdp, economicFactors,
 * stateBudgets, federalBudgetSnapshots, and all player state (characters,
 * parties, elections, corporations, campaigns, votes).
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-06-03-promote-live-world-to-1991.ts          # dry-run (default)
 *   npx tsx scripts/migrations/2026-06-03-promote-live-world-to-1991.ts --apply  # write
 *
 * Connects to MONGODB_URI_LIVE if set, else MONGODB_URI (from .env.local).
 */
import { MongoClient, ObjectId, type Db } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import type { FederalBudget, EnactedLaw } from "@/lib/db/types/budget";
import type { State } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  generateDefaultEnactedLaws,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { getBasePolicies } from "@/lib/seeds/reference/basePolicies";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import { calculateFederalRevenue } from "@/lib/budget/revenue";
import { normalizeFederalSpending } from "@/lib/budget/spending";
import { resolveMongoDbName } from "@/lib/mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const PRESET = "1991-default";
const GAME_STATE_ID = "current";

type BasePolicy = Awaited<ReturnType<typeof getBasePolicies>>[number];
type TargetLaw = ReturnType<typeof generateDefaultEnactedLaws>[number];
/** Permissive doc schema so writes accept string ids + arbitrary $set/insert. */
type LooseDoc = { _id?: string | ObjectId; [key: string]: unknown };

function resolveUri(): { uri: string; which: string } {
  const live = process.env.MONGODB_URI_LIVE;
  if (live) return { uri: live, which: "MONGODB_URI_LIVE" };
  const fallback = process.env.MONGODB_URI;
  if (fallback) return { uri: fallback, which: "MONGODB_URI" };
  throw new Error("Neither MONGODB_URI_LIVE nor MONGODB_URI is set in .env.local");
}

/** National-law query that also catches legacy US laws stored with no countryId. */
function nationalLawQuery(countryId: string): Record<string, unknown> {
  const usId = COUNTRY_CONFIGS.US.id;
  if (countryId === usId) {
    return { scope: "national", $or: [{ countryId: usId }, { countryId: { $exists: false } }] };
  }
  return { scope: "national", countryId };
}

/**
 * Recompute federal spending from a set of (national) enacted laws against a
 * live budget — mirrors `calculateFederalSpending` (src/lib/budget/spending.ts)
 * but operates on the in-memory target laws and live gdp/population so it can run
 * in dry-run without writing the laws first.
 */
function computeSpendingFromLaws(
  laws: TargetLaw[],
  liveBudget: FederalBudget,
  population: number,
  debt: FederalBudget["debt"]
): FederalBudget["spending"] {
  const byCategory: Record<string, number> = {};
  let stateGrants = 0;
  for (const law of laws) {
    const cost = calculateEnactedLawAnnualCost(law as unknown as EnactedLaw, {
      budgetCapacity: liveBudget.revenue?.total ?? 0,
      gdp: liveBudget.gdp,
      population,
    });
    if (!Number.isFinite(cost) || cost === 0) continue;
    if (law.isGrant) {
      stateGrants += cost;
    } else {
      const category = law.budgetCategory || "other";
      byCategory[category] = (byCategory[category] || 0) + cost;
    }
  }
  const debtInterest = (debt?.principal ?? 0) * (debt?.interestRate ?? 0);
  return normalizeFederalSpending({ byCategory, stateGrants, debtInterest, total: 0 });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { uri, which } = resolveUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  try {
    const db: Db = client.db(resolveMongoDbName(process.env as Record<string, string | undefined>));
    // Permissive collection handle for writes: string _id + arbitrary $set/insert.
    const loose = (name: string) => db.collection<LooseDoc>(name);

    // ── Targets (computed from the 1991-default preset seed) ──────────────────
    const targetLaws = generateDefaultEnactedLaws(PRESET);
    const targetPolicies = await getBasePolicies(PRESET);
    const seedBudgets = getInitialNationalBudgetsForPreset(PRESET);
    const seedTaxRatesByCountry = new Map(
      seedBudgets.map((b) => [b.countryId, b.taxRates] as const)
    );
    const seedDebtByCountry = new Map(seedBudgets.map((b) => [b.countryId, b.debt] as const));

    // ── Current live state ────────────────────────────────────────────────────
    const gameState = await db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: GAME_STATE_ID });
    const liveBudgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();

    const perCountry: Record<string, unknown> = {};
    const summary: Record<string, unknown> = {
      mode: apply ? "APPLY" : "dry-run",
      connection: which,
      preset: { before: gameState?.preset ?? "(none)", after: PRESET },
      note: "Resets laws + tax rates to 1991 defaults; ZEROES debt principal (one-time recompense); recomputes revenue & spending against live tax bases/GDP. Preserves fiscalYear/gdp/economicFactors/taxBases.",
      perCountry,
      statePolicies: {},
    };

    // ── 1. gameState.preset (no-op if already 1991-default) ───────────────────
    if (apply) {
      await loose("gameState").updateOne(
        { _id: GAME_STATE_ID },
        { $set: { preset: PRESET, updatedAt: new Date() } },
        { upsert: true }
      );
    }

    // ── 2. enactedLaws + 3. federalBudget.spending (per country) ──────────────
    for (const live of liveBudgets) {
      const countryId = live.countryId;
      const targetCountryLaws = targetLaws.filter((l) => l.countryId === countryId);

      // Countries with no seeded legislation (e.g. the BR stub) keep their
      // laws/revenue/spending untouched, but the debt jubilee still applies —
      // "all countries". Zero the principal and drop the debt-interest line.
      if (targetCountryLaws.length === 0) {
        const oldDebtInterest = live.spending?.debtInterest ?? 0;
        const zeroedSpending = live.spending
          ? {
              ...live.spending,
              debtInterest: 0,
              total: Math.max(0, (live.spending.total ?? 0) - oldDebtInterest),
            }
          : live.spending;
        perCountry[countryId] = {
          skipped: "no seeded legislation; debt zeroed only",
          debtPrincipal: { before: live.debt?.principal ?? null, after: 0 },
        };
        if (apply) {
          await loose("federalBudget").updateOne(
            { _id: live._id },
            {
              $set: {
                debt: { ...(live.debt ?? {}), principal: 0 },
                ...(zeroedSpending ? { spending: zeroedSpending } : {}),
                surplus: (live.revenue?.total ?? 0) - (zeroedSpending?.total ?? 0),
                updatedAt: new Date(),
              },
            }
          );
        }
        continue;
      }

      const lawQuery = nationalLawQuery(countryId);
      const liveLawCount = await loose("enactedLaws").countDocuments(lawQuery);

      const population = (
        await db
          .collection<State>("states")
          .find({ countryId: countryId as State["countryId"] })
          .toArray()
      ).reduce((sum, s) => sum + (s.population ?? 0), 0);

      // Debt: ZERO the principal for every country — a one-time recompense /
      // debt jubilee. The live world ran two fiscal years on miscalibrated
      // budgets, so deficits compounded into an implausible debt spiral (e.g. UK
      // 282% of GDP) whose interest dominated spending. Rather than reset to the
      // era-correct seed level, wipe the principal entirely (keeping the seed's
      // rate/ceiling so future borrowing behaves normally). Debt interest -> 0.
      const baseDebt = seedDebtByCountry.get(countryId) ?? live.debt;
      const targetDebt = { ...baseDebt, principal: 0 } as FederalBudget["debt"];
      const targetSpending = computeSpendingFromLaws(
        targetCountryLaws,
        live,
        population,
        targetDebt
      );

      // Tax rates: reset to the corrected 1991 defaults (consistent with the
      // full law reset), then recompute revenue against the live (evolved) tax
      // bases — this is what lands calibration changes like the US income-tax
      // index on the running world.
      const targetTaxRates = seedTaxRatesByCountry.get(countryId) ?? live.taxRates;
      const targetRevenue = await calculateFederalRevenue(db, targetTaxRates, String(live._id));
      const targetSurplus = targetRevenue.total - targetSpending.total;

      perCountry[countryId] = {
        fiscalYear: { preserved: live.fiscalYear },
        nationalLaws: { before: liveLawCount, after: targetCountryLaws.length },
        debtPrincipal: {
          before: live.debt?.principal ?? null,
          after: targetDebt?.principal ?? null,
        },
        revenueTotal: { before: live.revenue?.total ?? null, after: targetRevenue.total },
        spendingTotal: { before: live.spending?.total ?? null, after: targetSpending.total },
        surplus: { before: live.surplus ?? null, after: targetSurplus },
        population,
      };

      if (!apply) continue;

      // 2. enactedLaws — full reset of national laws, then insert 1991 defaults.
      await loose("enactedLaws").deleteMany(lawQuery);
      await loose("enactedLaws").insertMany(
        targetCountryLaws as unknown as Record<string, unknown>[]
      );

      // 3. federalBudget — sync tax rates + revenue + spending + debt; preserve
      //    fiscalYear / gdp / economicFactors / taxBases.
      await loose("federalBudget").updateOne(
        { _id: live._id },
        {
          $set: {
            taxRates: targetTaxRates,
            revenue: targetRevenue,
            spending: targetSpending,
            surplus: targetSurplus,
            debt: targetDebt,
            baselineSpendingByCategory: targetSpending.byCategory,
            baselineStateGrants: targetSpending.stateGrants,
            updatedAt: new Date(),
          },
        }
      );
    }

    // ── 4. statePolicies — full reset to 1991 base policies (ALL countries) ───
    const liveStatePolicyCount = await db.collection("statePolicies").countDocuments({});
    summary.statePolicies = {
      before: liveStatePolicyCount,
      after: targetPolicies.length,
      note: "Resets policy positions for ALL countries to 1991 defaults (discards drift).",
    };
    if (apply) {
      await loose("statePolicies").deleteMany({});
      if (targetPolicies.length > 0) {
        await loose("statePolicies").insertMany(targetPolicies.map(toStatePolicyDoc));
      }
    }

    console.log(JSON.stringify(summary, null, 2));
    if (!apply) {
      console.log("\nDry-run only. Re-run with --apply to write these changes.");
    }
  } finally {
    await client.close();
  }
}

function toStatePolicyDoc(r: BasePolicy): Record<string, unknown> {
  return {
    scope: r.scope,
    ...(r.stateId != null && { stateId: r.stateId }),
    legislationTypeId: r.legislationTypeId,
    economic: r.economic,
    social: r.social,
    ...(r.policyOptionId != null && { policyOptionId: r.policyOptionId }),
    ...(r.policyOptionIndex != null && { policyOptionIndex: r.policyOptionIndex }),
    effectDirection: r.effectDirection,
    updatedAt: r.updatedAt,
  };
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
