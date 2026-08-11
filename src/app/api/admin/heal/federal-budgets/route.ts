import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import {
  calculateFederalRevenue,
  calculateStateRevenue,
  normalizeFederalTaxRates,
  normalizeStateTaxRates,
} from "@/lib/budget/revenue";
import {
  calculateFederalSpending,
  calculateStateSpending,
  resolveNationalMedianIncome,
} from "@/lib/budget/spending";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import { getEraContext } from "@/lib/era/context";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import type { FederalBudget, EnactedLaw, StateBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalTaxRates } from "@/lib/db/types/budget";

const FEDERAL_TAX_RATE_KEYS: ReadonlySet<keyof FederalTaxRates> = new Set([
  "incomeTax",
  "domesticCorporateTax",
  "foreignCorporateTax",
  "payrollTax",
  "tariffs",
  "salesTax",
]);

function isFederalTaxRateKey(value: string): value is keyof FederalTaxRates {
  return FEDERAL_TAX_RATE_KEYS.has(value as keyof FederalTaxRates);
}

/**
 * GET /api/admin/heal/federal-budgets
 * Diagnose: compare stored revenue/spending vs recalculated values for both
 * national and regional/state budgets across all countries.
 *
 * **Currency (v0.2.6):** Every diagnostic pairs stored vs recalculated values
 * within the same country, so `revenueDrift` / `spendingDrift` comparisons are
 * same-currency. `totalRevenueDrift` / `totalSpendingDrift` are accumulated
 * per-country (keyed by `countryId`), never summed across countries, so no FX
 * is required. The same invariant holds for the POST (heal) path below.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // ── National budget diagnostics ──────────────────────────────────────
    const nationalBudgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
    const nationalDiagnostics = [];
    // Era year gates which cost forms the per-law breakdown uses, so it matches
    // `recalcSpending` (calculateFederalSpending). Null (flag off) ⇒ legacy costs.
    const { year: eraYear } = await getEraContext(db);

    for (const budget of nationalBudgets) {
      const normalizedTaxRates = normalizeFederalTaxRates(budget.taxRates);
      // Skip budgets missing taxRates or debt (incompletely seeded countries)
      if (!normalizedTaxRates || !budget.debt) continue;

      const budgetCountryId = (budget.countryId ||
        (budget._id === "federal" ? "US" : budget._id)) as CountryId;

      const recalcRevenue = await calculateFederalRevenue(db, normalizedTaxRates, budget._id);
      const debtInterest = budget.debt.principal * budget.debt.interestRate;
      const recalcSpending = await calculateFederalSpending(db, budget, debtInterest);

      const states = await db
        .collection<State>("states")
        .find({ countryId: budgetCountryId })
        .toArray();
      const population = states.reduce((sum, s) => sum + (s.population ?? 0), 0);
      const nationalMedianIncome = await resolveNationalMedianIncome(db, budgetCountryId);

      const enactedLaws = await db
        .collection<EnactedLaw>("enactedLaws")
        .find({
          scope: "national",
          ...(budgetCountryId === "US"
            ? { $or: [{ countryId: "US" }, { countryId: { $exists: false } }] }
            : { countryId: budgetCountryId }),
          repealedAt: { $exists: false },
        })
        .toArray();

      const lawBreakdown = enactedLaws.map((law) => {
        // Match calculateFederalSpending exactly: era-inactive laws are phantom-
        // gated (contribute 0), and active laws use the era cost forms via the
        // same year + game-income context. Flag off (eraYear null) ⇒ every law
        // active + legacy costs, byte-identical to before.
        const eraActive = isLegislationTypeActive(law.legislationTypeId, eraYear);
        const cost = calculateEnactedLawAnnualCost(law, {
          budgetCapacity: budget.revenue.total,
          gdp: budget.gdp,
          population,
          countryId: budgetCountryId,
          nationalGdpPerCapita: population > 0 ? budget.gdp / population : undefined,
          nationalMedianIncome,
          year: eraYear,
        });
        return {
          legislationTypeId: law.legislationTypeId,
          title: law.title,
          budgetCategory: law.budgetCategory,
          costMethod:
            law.gdpPerCapitaMultiplier !== undefined
              ? "gdpMultiplier"
              : law.annualCostPerCapita !== undefined
                ? "perCapita"
                : law.annualCostUsd !== undefined
                  ? "fixedUsd"
                  : "budgetPct",
          eraActive,
          // Contribution to spending: a phantom-gated law adds 0 to recalcSpending
          // even though its cost formula is non-zero, so the breakdown reconciles.
          computedCost: eraActive ? cost : 0,
        };
      });

      const revenueDrift = Math.abs(recalcRevenue.total - budget.revenue.total);
      const spendingDrift = Math.abs(recalcSpending.total - budget.spending.total);
      const revenueNeedsFix =
        budget.revenue.total > 0
          ? revenueDrift / budget.revenue.total > 0.01
          : recalcRevenue.total > 0;
      const spendingNeedsFix =
        budget.spending.total > 0
          ? spendingDrift / budget.spending.total > 0.01
          : recalcSpending.total > 0;

      nationalDiagnostics.push({
        budgetId: budget._id,
        countryId: budget.countryId,
        scope: "national" as const,
        gdp: budget.gdp,
        population,
        currentRevenue: budget.revenue.total,
        recalcRevenue: recalcRevenue.total,
        currentSpending: budget.spending.total,
        recalcSpending: recalcSpending.total,
        currentSurplus: budget.surplus,
        recalcSurplus: recalcRevenue.total - recalcSpending.total,
        revenueNeedsFix,
        spendingNeedsFix,
        needsFix: revenueNeedsFix || spendingNeedsFix,
        enactedLawCount: enactedLaws.length,
        lawBreakdown,
      });
    }

    // ── Regional/state budget diagnostics ────────────────────────────────
    const stateBudgets = await db.collection<StateBudget>("stateBudgets").find({}).toArray();
    const allStates = await db.collection<State>("states").find({}).toArray();
    const stateMap = new Map(allStates.map((s) => [s._id, s]));

    // Build a map of countryId → national budget for federal grant calculation
    const nationalBudgetByCountry = new Map<string, FederalBudget>();
    for (const nb of nationalBudgets) {
      const cid = nb.countryId || (nb._id === "federal" ? "US" : nb._id);
      nationalBudgetByCountry.set(cid, nb);
    }

    let regionalNeedsFix = 0;
    const regionalSummaryByCountry: Record<
      string,
      { total: number; needsFix: number; totalRevenueDrift: number; totalSpendingDrift: number }
    > = {};

    for (const sb of stateBudgets) {
      const state = stateMap.get(sb.stateId);
      const countryId = state?.countryId ?? "US";

      if (!regionalSummaryByCountry[countryId]) {
        regionalSummaryByCountry[countryId] = {
          total: 0,
          needsFix: 0,
          totalRevenueDrift: 0,
          totalSpendingDrift: 0,
        };
      }
      regionalSummaryByCountry[countryId].total++;

      const normalizedTaxRates = normalizeStateTaxRates(sb.taxRates);
      // Skip budgets missing taxRates or revenue (incompletely seeded states)
      if (!normalizedTaxRates || !sb.revenue) continue;

      // Recalculate revenue from tax bases × rates
      const recalcRevenue = await calculateStateRevenue(
        db,
        sb.stateId,
        countryId,
        normalizedTaxRates,
        sb.revenue.federalGrants ?? 0
      );

      // Recalculate spending from enacted state-scope laws
      const recalcSpending = await calculateStateSpending(db, sb.stateId, countryId, sb);

      const revenueDrift = Math.abs(recalcRevenue.total - sb.revenue.total);
      const spendingDrift = Math.abs(recalcSpending.total - sb.spending.total);
      const revNeedsFix =
        sb.revenue.total > 0 ? revenueDrift / sb.revenue.total > 0.01 : recalcRevenue.total > 0;
      // For spending, only flag if enacted laws exist — otherwise baseline spending is expected
      const spNeedsFix =
        recalcSpending.total > 0 &&
        sb.spending.total > 0 &&
        spendingDrift / sb.spending.total > 0.05;

      if (revNeedsFix || spNeedsFix) {
        regionalNeedsFix++;
        regionalSummaryByCountry[countryId].needsFix++;
      }
      regionalSummaryByCountry[countryId].totalRevenueDrift += revenueDrift;
      regionalSummaryByCountry[countryId].totalSpendingDrift += spendingDrift;
    }

    return NextResponse.json({
      national: {
        total: nationalBudgets.length,
        needsFix: nationalDiagnostics.filter((d) => d.needsFix).length,
        budgets: nationalDiagnostics,
      },
      regional: {
        total: stateBudgets.length,
        needsFix: regionalNeedsFix,
        byCountry: regionalSummaryByCountry,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/federal-budgets
 * Recalculate revenue and spending for all national AND regional budgets
 * based on current enacted laws, tax rates, and tax bases.
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();

    // ── Step 1: Re-seed enacted laws from current legislation type definitions ──
    // Fixes stale cost fields left by previous seeds
    const { generateDefaultEnactedLaws } = await import("@/lib/seeds/reference/budgets");
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1, startingYear: 1 } });
    const preset =
      gameState?.preset ??
      ((gameState?.startingYear ?? 2019) <= 1991 ? "1991-default" : "2019-default");
    const defaultLaws = generateDefaultEnactedLaws(preset);
    let lawsUpdated = 0;
    for (const law of defaultLaws) {
      const { _id, ...lawWithoutId } = law;

      const unsetFields: Record<string, ""> = {};
      if (law.gdpPerCapitaMultiplier === undefined) unsetFields.gdpPerCapitaMultiplier = "";
      if (law.annualCostPerCapita === undefined) unsetFields.annualCostPerCapita = "";
      if (law.annualCostUsd === undefined) unsetFields.annualCostUsd = "";

      const update: Record<string, unknown> = {
        $set: lawWithoutId,
        $setOnInsert: { _id },
      };
      if (Object.keys(unsetFields).length > 0) {
        update.$unset = unsetFields;
      }

      const result = await db.collection<EnactedLaw>("enactedLaws").updateOne(
        {
          legislationTypeId: law.legislationTypeId,
          scope: law.scope,
          countryId: law.countryId,
          repealedAt: { $exists: false },
        },
        update,
        { upsert: true }
      );
      if (result.modifiedCount > 0 || result.upsertedCount > 0) lawsUpdated++;
    }

    // Fix enacted laws NOT covered by the seed — look up each law's legislation type
    // and correct cost fields from the matching policy option
    const { legislationTypes } = await import("@/lib/seeds/reference/legislationTypes");
    const ltMap = new Map(legislationTypes.map((lt: { _id: string }) => [lt._id, lt]));

    const allEnactedLaws = await db
      .collection<EnactedLaw>("enactedLaws")
      .find({ repealedAt: { $exists: false } })
      .toArray();

    const seededLtIds = new Set(
      defaultLaws.map((l: { legislationTypeId: string }) => l.legislationTypeId)
    );

    for (const law of allEnactedLaws) {
      if (seededLtIds.has(law.legislationTypeId)) continue;

      const lt = ltMap.get(law.legislationTypeId) as
        | {
            policyOptions?: Array<{
              annualCostPerCapita?: number;
              gdpPerCapitaMultiplier?: number;
              annualCostUsd?: number;
              economic?: number;
              social?: number;
            }>;
          }
        | undefined;
      if (!lt?.policyOptions?.length) continue;

      const centerIdx = Math.floor(lt.policyOptions.length / 2);
      const option = lt.policyOptions[centerIdx];
      if (!option) continue;

      const setFields: Record<string, unknown> = {};
      const unsetFields: Record<string, ""> = {};

      if (option.annualCostPerCapita !== undefined) {
        setFields.annualCostPerCapita = option.annualCostPerCapita;
        unsetFields.gdpPerCapitaMultiplier = "";
        unsetFields.annualCostUsd = "";
      } else if (option.gdpPerCapitaMultiplier !== undefined) {
        setFields.gdpPerCapitaMultiplier = option.gdpPerCapitaMultiplier;
        unsetFields.annualCostPerCapita = "";
        unsetFields.annualCostUsd = "";
      }

      if (Object.keys(setFields).length > 0) {
        const update: Record<string, unknown> = { $set: setFields };
        if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;
        const result = await db
          .collection<EnactedLaw>("enactedLaws")
          .updateOne({ _id: law._id }, update);
        if (result.modifiedCount > 0) lawsUpdated++;
      }
    }

    // ── Step 2: Heal national budgets ────────────────────────────────────
    const nationalBudgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
    let nationalHealed = 0;

    // Pre-fetch all legislation types with taxRateChange for rate sync
    const taxLegTypes = await db
      .collection<import("@/lib/db/types").LegislationType>("legislationTypes")
      .find({ taxRateChange: { $exists: true } })
      .toArray();
    const taxTypeByLegId = new Map(taxLegTypes.map((lt) => [lt._id, lt.taxRateChange!.taxType]));

    for (const budget of nationalBudgets) {
      const normalizedTaxRates = normalizeFederalTaxRates(budget.taxRates);
      // Skip budgets missing taxRates or debt (incompletely seeded countries)
      if (!normalizedTaxRates || !budget.debt) continue;

      // Sync tax rates from enacted laws — the authoritative source for active rates.
      // Each enacted law with a `rate` field overrides the corresponding budget taxRate.
      const budgetCountryId = (budget.countryId ||
        (budget._id === "federal" ? "US" : budget._id)) as CountryId;
      const taxEnactedLaws = await db
        .collection<EnactedLaw>("enactedLaws")
        .find({
          scope: "national",
          countryId: budgetCountryId,
          rate: { $exists: true },
          repealedAt: { $exists: false },
        })
        .toArray();

      for (const law of taxEnactedLaws) {
        const taxType = taxTypeByLegId.get(law.legislationTypeId);
        if (taxType && law.rate !== undefined && isFederalTaxRateKey(taxType)) {
          normalizedTaxRates[taxType] = law.rate;
        }
      }

      const revenue = await calculateFederalRevenue(db, normalizedTaxRates, budget._id);
      const debtInterest = budget.debt.principal * budget.debt.interestRate;
      const spending = await calculateFederalSpending(db, { ...budget, revenue }, debtInterest);

      // If no enacted laws produced spending, preserve existing baseline spending
      // but with corrected debt interest
      const finalSpending =
        spending.total > 0
          ? spending
          : {
              ...budget.spending,
              debtInterest,
              total:
                Object.values(budget.spending.byCategory).reduce((a, b) => a + b, 0) +
                (budget.spending.stateGrants ?? 0) +
                debtInterest,
            };

      const surplus = revenue.total - finalSpending.total;

      await db.collection<FederalBudget>("federalBudget").updateOne(
        { _id: budget._id },
        {
          $set: {
            taxRates: normalizedTaxRates,
            revenue,
            spending: finalSpending,
            surplus,
            updatedAt: now,
          },
        }
      );
      nationalHealed++;
    }

    // ── Step 3: Heal regional/state budgets ──────────────────────────────
    const stateBudgets = await db.collection<StateBudget>("stateBudgets").find({}).toArray();
    const allStates = await db.collection<State>("states").find({}).toArray();
    const stateMap = new Map(allStates.map((s) => [s._id, s]));
    let regionalHealed = 0;

    for (const sb of stateBudgets) {
      const normalizedTaxRates = normalizeStateTaxRates(sb.taxRates);
      // Skip budgets missing taxRates or revenue (incompletely seeded states)
      if (!normalizedTaxRates || !sb.revenue) continue;
      const sbCountryId = (stateMap.get(sb.stateId)?.countryId ?? "US") as CountryId;

      // Recalculate revenue from stored tax bases × current rates
      const revenue = await calculateStateRevenue(
        db,
        sb.stateId,
        sbCountryId,
        normalizedTaxRates,
        sb.revenue.federalGrants ?? 0
      );

      // Recalculate spending from enacted state-scope laws
      const recalcSpending = await calculateStateSpending(db, sb.stateId, sbCountryId, {
        ...sb,
        revenue,
      });

      // If no state-scope enacted laws exist, preserve baseline spending proportions
      // but update the total to match current revenue (balanced budget assumption)
      const finalSpending =
        recalcSpending.total > 0
          ? recalcSpending
          : {
              ...sb.spending,
              total: Object.values(sb.spending.byCategory).reduce((a, b) => a + b, 0),
            };

      const surplus = revenue.total - finalSpending.total;

      await db.collection<StateBudget>("stateBudgets").updateOne(
        { _id: sb._id },
        {
          $set: {
            taxRates: normalizedTaxRates,
            revenue,
            spending: finalSpending,
            surplus,
            balance: surplus,
            updatedAt: now,
          },
        }
      );
      regionalHealed++;
    }

    return NextResponse.json({
      message: `Healed ${nationalHealed} national + ${regionalHealed} regional budget(s). ${lawsUpdated} enacted law(s) updated.`,
      nationalHealed,
      regionalHealed,
      lawsUpdated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
