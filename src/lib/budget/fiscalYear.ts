import type { Db } from "mongodb";
import type {
  FederalBudget,
  StateBudget,
  EconomicGrowthFactors,
  FederalBudgetSnapshot,
  EnactedLaw,
} from "@/lib/db/types/budget";
import type { State } from "@/lib/db/types/state";
import {
  calculateFederalRevenue,
  calculateStateRevenue,
  normalizeFederalTaxRates,
  normalizeStateTaxRates,
} from "./revenue";
import { calculateFederalSpending, calculateStateSpending } from "./spending";
import { applyLegacyTrustDelta } from "@/lib/sovereignDefault/sideEffects/trustHit";
import { processAnnualDebt, triggerDebtCeilingCrisis, getDebtThreshold } from "./debt";
import { processFormulaGrants, updateStateGrantRevenue } from "./grants";
import { calculateCountryInflation } from "./inflation";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { getNationalDocId, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { smoothNationalGdp } from "@/lib/metricEngine/gdpLevel";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  getSharedFiscalYearStartTurnInYear,
  getTurnInYear,
} from "@/lib/countrySystems/fiscalCalendar";
import { evaluateSovereignAuctionForCountry } from "@/lib/sovereignDefault/crisisDetection";
import { applyAusterityCap } from "@/lib/sovereignDefault/austerity";

// The current turn engine still processes fiscal-year rollover as one shared phase.
// Pulling the anchor from country-systems makes the rule source explicit now, while
// preserving existing behavior until a later wave teaches the engine divergent calendars.
export const FISCAL_YEAR_START_TURN_IN_YEAR = getSharedFiscalYearStartTurnInYear();

/** EMA weight on the prior national GDP when smoothing for debt-to-GDP (design §5.4). */
const GDP_SMOOTHING_INERTIA = 0.7;

/**
 * Check if the current turn marks the end of a fiscal year.
 * Fiscal year ends at turn 39 (September) and new fiscal year starts at turn 40 (October).
 */
export function isFiscalYearEnd(currentTurn: number): boolean {
  return getTurnInYear(currentTurn) === FISCAL_YEAR_START_TURN_IN_YEAR;
}

/**
 * Calculate the fiscal year for a given calendar year and turn.
 * Federal fiscal year 2021 runs from October 2020 to September 2021.
 * So in October 2020 (turn 40), we're in FY2021.
 */
export function calculateFiscalYear(currentYear: number, currentTurn: number): number {
  const turnInYear = getTurnInYear(currentTurn);
  // If we're at or past the fiscal year start turn (October), fiscal year is currentYear + 1
  return turnInYear >= FISCAL_YEAR_START_TURN_IN_YEAR ? currentYear + 1 : currentYear;
}

function resolveBudgetCountryId(budget: Pick<FederalBudget, "_id" | "countryId">): CountryId {
  if (budget.countryId && budget.countryId in COUNTRY_CONFIGS) {
    return budget.countryId as CountryId;
  }
  if (budget._id === "federal") {
    return COUNTRY_CONFIGS.US.id;
  }
  if (String(budget._id) in COUNTRY_CONFIGS) {
    return String(budget._id) as CountryId;
  }
  return COUNTRY_CONFIGS.US.id;
}

/**
 * Process the annual fiscal year transition.
 * This recalculates all revenue, spending, debt, and grants for the new fiscal year.
 * Tax bases grow annually based on economic factors (GDP growth, wage growth, etc.)
 */
export async function processFiscalYear(
  db: Db,
  newFiscalYear: number,
  currentTurn: number
): Promise<void> {
  const federalBudgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
  if (federalBudgets.length === 0) {
    console.log("[FiscalYear] No federal budget found, skipping fiscal year processing");
    return;
  }

  const [states, allStateMetrics] = await Promise.all([
    db.collection<State>("states").find({}).toArray(),
    db.collection<StateMetrics>("macroMetrics").find({}).toArray(),
  ]);
  const stateGdpGrowthMap = new Map(
    allStateMetrics
      .filter((m) => typeof m.economic?.gdpGrowth?.value === "number")
      .map((m) => [String(m._id), m.economic.gdpGrowth.value])
  );
  const processedBudgetIds = new Set<string>();

  for (const federalBudget of federalBudgets) {
    const budgetId = String(federalBudget._id);
    const countryId = resolveBudgetCountryId(federalBudget);
    const normalizedTaxRates = normalizeFederalTaxRates(federalBudget.taxRates);
    // The fiscal-year phase iterates every country's budget in one shared turn
    // step, so one malformed document must not abort rollover for the
    // rest of the world. Skip and surface the bad budget instead.
    if (!normalizedTaxRates || !federalBudget.debt) {
      console.warn(
        `[FiscalYear] Skipping ${countryId} budget ${budgetId} because required fiscal fields are missing`
      );
      continue;
    }
    const nationalDocId = getNationalDocId(countryId);
    const nationalMetrics = nationalDocId
      ? (allStateMetrics.find((metric) => String(metric._id) === nationalDocId) ?? null)
      : null;
    const pipelineGdpGrowth = nationalMetrics?.economic?.gdpGrowth?.value ?? 2.5;

    const economicFactors = federalBudget.economicFactors || {
      gdpGrowth: pipelineGdpGrowth,
      wageGrowth: 3.0,
      inflationRate: 2.5,
      tradeGrowth: 2.0,
      lastUpdated: new Date(),
    };
    economicFactors.gdpGrowth = pipelineGdpGrowth;

    const newInflation = await calculateCountryInflation(db, countryId, federalBudget);
    economicFactors.inflationRate = newInflation;

    const newTaxBases = federalBudget.taxBases;
    let newGdp = federalBudget.gdp || 27_000_000_000_000;
    // EMA-smoothed national GDP for the debt-to-GDP ratio (design §5.4) — dampens
    // year-over-year GDP swings so they can't trip a sovereign-default threshold.
    let newGdpSmoothed = smoothNationalGdp(
      federalBudget.gdpSmoothed,
      newGdp,
      GDP_SMOOTHING_INERTIA
    );
    if (federalBudget.taxBases) {
      // Base growth moved to the per-turn `fiscalBaseGrowth` phase (the annual
      // jump became a 1/TURNS_PER_YEAR slice each turn). fiscalYear keeps the
      // annual GDP derivation, inflation snapshot, grants, debt, and revenue
      // recompute — off the now per-turn-grown bases — but no longer grows them
      // (that would double-count). `newTaxBases` stays the current bases.
      // A1 SSOT (design §5.4): federalBudget.gdp DERIVES from Σ regional state.gdp
      // (the engine grew each region's level per turn) rather than compounding
      // independently. Fall back to annual compounding only for countries whose
      // states carry no SSOT gdp yet (pre-reconciliation safety).
      const countryStateGdpMillions = states
        .filter((s) => s.countryId === countryId && !NATIONAL_SCOPE_IDS.has(String(s._id)))
        .reduce((sum, s) => sum + (s.gdp || 0), 0);
      newGdp =
        countryStateGdpMillions > 0
          ? countryStateGdpMillions * 1_000_000
          : newGdp * (1 + economicFactors.gdpGrowth / 100);
      newGdpSmoothed = smoothNationalGdp(federalBudget.gdpSmoothed, newGdp, GDP_SMOOTHING_INERTIA);

      await db.collection<FederalBudget>("federalBudget").updateOne(
        { _id: federalBudget._id },
        {
          $set: {
            taxBases: newTaxBases,
            gdp: newGdp,
            gdpSmoothed: newGdpSmoothed,
            "economicFactors.gdpGrowth": pipelineGdpGrowth,
            "economicFactors.inflationRate": newInflation,
            "economicFactors.lastUpdated": new Date(),
          },
        }
      );

      console.log(
        `[FiscalYear] ${countryId} annual reconciliation: GDP ${economicFactors.gdpGrowth}%, ` +
          `inflation ${economicFactors.inflationRate}% (tax bases grow per-turn via fiscalBaseGrowth)`
      );
    }

    const federalRevenue = await calculateFederalRevenue(db, normalizedTaxRates, budgetId);

    // Formula-grant programs (Medicaid, Highway Trust Fund, Education Block,
    // SNAP) are US-only — running them for UK/JP/DE wedges 27% of national
    // revenue into a phantom "Westminster Funding"/"Local Allocation Tax"
    // line that doesn't actually reach the country's regional pools. Other
    // countries route central-to-regional grants through their own enacted
    // legislation (uk_local_government_funding, jp_local_allocation_tax),
    // which is folded into spending.stateGrants by calculateFederalSpending
    // via the isGrant flag on enacted laws.
    const isUS = countryId === COUNTRY_CONFIGS.US.id;
    const grantDistribution = isUS
      ? await processFormulaGrants(db, federalRevenue.total, countryId)
      : {};

    if (isUS) {
      for (const [stateId, grantAmount] of Object.entries(grantDistribution)) {
        await updateStateGrantRevenue(db, stateId, countryId, grantAmount);
      }
    }

    // Debt-to-GDP uses the SMOOTHED national GDP (not the raw Σ) — default-stability guard.
    const debtResult = await processAnnualDebt(db, federalBudget, newGdpSmoothed);
    const federalSpending = await calculateFederalSpending(
      db,
      {
        ...federalBudget,
        revenue: federalRevenue,
        gdp: newGdp,
      },
      debtResult.interestPayment
    );

    if (isUS) {
      // US still uses the formulaGrants pool for state grants and overrides
      // the enacted-law-derived total. Non-US countries already populated
      // stateGrants from isGrant=true enacted laws inside calculateFederalSpending.
      const totalStateGrants = Object.values(grantDistribution).reduce((a, b) => a + b, 0);
      federalSpending.stateGrants = totalStateGrants;
      federalSpending.total += totalStateGrants;
    }

    const surplus = federalRevenue.total - federalSpending.total;

    let finalSpending = federalSpending;
    let finalSurplus = surplus;
    if (federalBudget.imfSovereignBailoutActive) {
      const austerity = applyAusterityCap(
        {
          byCategory: federalSpending.byCategory ?? {},
          stateGrants: federalSpending.stateGrants ?? 0,
          debtInterest: federalSpending.debtInterest ?? 0,
          total: federalSpending.total,
        },
        federalRevenue.total
      );
      finalSpending = {
        byCategory: austerity.scaledByCategory,
        stateGrants: austerity.scaledStateGrants,
        debtInterest: austerity.scaledDebtInterest,
        total: austerity.scaledTotal,
      };
      finalSurplus = federalRevenue.total - austerity.scaledTotal;
      if (austerity.scaleFactor < 1) {
        console.log(
          `[FiscalYear] ${countryId} austerity cap applied: factor ${austerity.scaleFactor.toFixed(3)} ` +
            `(spending $${(federalSpending.total / 1e9).toFixed(1)}B → $${(austerity.scaledTotal / 1e9).toFixed(1)}B)`
        );
      }
    }

    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: federalBudget._id },
      {
        $set: {
          fiscalYear: newFiscalYear,
          taxRates: normalizedTaxRates,
          revenue: federalRevenue,
          spending: finalSpending,
          "debt.principal": debtResult.newPrincipal,
          "debt.interestRate": debtResult.interestRate,
          debtToGdpRatio: debtResult.debtToGdpRatio,
          creditRating: debtResult.creditRating,
          surplus: finalSurplus,
          updatedAt: new Date(),
        },
      }
    );

    console.log(
      `[FiscalYear] ${countryId} FY${newFiscalYear} processed: Revenue $${(federalRevenue.total / 1e9).toFixed(1)}B, ` +
        `Spending $${(finalSpending.total / 1e9).toFixed(1)}B, ` +
        `${finalSurplus >= 0 ? "Surplus" : "Deficit"} $${(Math.abs(finalSurplus) / 1e9).toFixed(1)}B, ` +
        `Debt/GDP ${(debtResult.debtToGdpRatio * 100).toFixed(1)}% (${debtResult.creditRating})`
    );

    if (countryId === COUNTRY_CONFIGS.US.id && debtResult.ceilingExceeded) {
      await triggerDebtCeilingCrisis(db, newFiscalYear);
      console.log(`[FiscalYear] DEBT CEILING EXCEEDED - Crisis triggered for FY${newFiscalYear}`);
    }

    const countryStates = states.filter((state) => state.countryId === countryId);
    for (const state of countryStates) {
      const stateId = String(state._id);
      const stateGrantAmount = grantDistribution[stateId] || 0;
      const stateGdpGrowth = stateGdpGrowthMap.get(stateId) ?? economicFactors.gdpGrowth;
      const stateFactors = { ...economicFactors, gdpGrowth: stateGdpGrowth };
      await processStateFiscalYear(
        db,
        stateId,
        countryId,
        newFiscalYear,
        stateGrantAmount,
        stateFactors,
        state.gdp
      );
    }

    const threshold = getDebtThreshold(
      debtResult.debtToGdpRatio,
      federalBudget.sovereignRiskAnchor
    );
    if (threshold.gdpPenalty > 0 || threshold.trustPenalty > 0) {
      await applyDebtPenalties(db, countryId, threshold.gdpPenalty, threshold.trustPenalty);
      if (threshold.gdpPenalty > 0) {
        console.log(
          `[FiscalYear] ${countryId} applied GDP penalty: -${threshold.gdpPenalty}% growth`
        );
      }
      if (threshold.trustPenalty > 0) {
        console.log(
          `[FiscalYear] ${countryId} applied public trust penalty: -${threshold.trustPenalty}`
        );
      }
    }

    processedBudgetIds.add(budgetId);
  }

  try {
    const allBudgets = await db.collection<FederalBudget>("federalBudget").find({}).toArray();
    for (const budget of allBudgets) {
      if (!processedBudgetIds.has(String(budget._id))) continue;
      const countryId = resolveBudgetCountryId(budget);
      await saveFiscalYearSnapshot(db, countryId, String(budget._id), newFiscalYear);
    }
  } catch (e) {
    console.error(`[FiscalYear] Failed to save budget snapshots for FY${newFiscalYear}:`, e);
  }

  // Sovereign auction outcome detection — runs once per processed country at
  // fiscal-year close. A single failure must not abort the rest of the loop.
  const realtimeMs = Date.now();
  for (const budgetIdProcessed of processedBudgetIds) {
    const matchingBudget = federalBudgets.find((b) => String(b._id) === budgetIdProcessed);
    if (!matchingBudget) continue;
    const countryId = resolveBudgetCountryId(matchingBudget);
    try {
      await evaluateSovereignAuctionForCountry(db, countryId, currentTurn, realtimeMs);
    } catch (err) {
      console.error(`[FiscalYear] Sovereign auction evaluation failed for ${countryId}:`, err);
    }
  }
}

/**
 * Process fiscal year for an individual state.
 * Applies economic growth to state tax bases before recalculating revenue.
 * GDP growth comes from the per-state realized-output pipeline.
 */
async function processStateFiscalYear(
  db: Db,
  stateId: string,
  countryId: CountryId,
  fiscalYear: number,
  federalGrants: number,
  stateEconomicFactors?: EconomicGrowthFactors,
  /** The region's current `state.gdp` in millions (the SSOT level the engine grew). */
  stateGdpMillions?: number
): Promise<void> {
  const stateBudget = await db
    .collection<StateBudget>("stateBudgets")
    .findOne({ _id: stateId, countryId });
  if (!stateBudget) {
    // State budget doesn't exist yet, skip
    return;
  }

  const normalizedTaxRates = normalizeStateTaxRates(stateBudget.taxRates);
  // State budgets can briefly exist before their tax-rate payload is fully
  // seeded; skipping keeps one broken state from aborting the national
  // fiscal-year pass while still leaving a clear breadcrumb in the logs.
  if (!normalizedTaxRates) {
    console.warn(`[FiscalYear] Skipping state ${stateId} because taxRates are missing`);
    return;
  }

  // Apply economic growth to state tax bases (using per-state GDP growth)
  const economicFactors = stateEconomicFactors || {
    gdpGrowth: 2.5,
    wageGrowth: 3.0,
    inflationRate: 2.5,
    tradeGrowth: 2.0,
    lastUpdated: new Date(),
  };

  const newTaxBases = stateBudget.taxBases;
  let newStateGdp = stateBudget.stateGdp || 0;
  if (stateBudget.taxBases) {
    // Base growth moved to the per-turn `fiscalBaseGrowth` phase (grows each
    // state's bases by that state's own factors). fiscalYear no longer grows
    // them (double-count); it reconciles stateGdp + state revenue annually off
    // the per-turn-grown bases (`newTaxBases` stays the current bases).
    // A1 SSOT: stateGdp is a snapshot of `state.gdp × 1M` (the engine grew the
    // region's level per turn). Fall back to annual compounding only when the
    // region carries no SSOT gdp yet (pre-reconciliation safety).
    newStateGdp =
      stateGdpMillions && stateGdpMillions > 0
        ? stateGdpMillions * 1_000_000
        : newStateGdp * (1 + economicFactors.gdpGrowth / 100);

    // Update tax bases in DB before revenue calculation
    await db.collection<StateBudget>("stateBudgets").updateOne(
      { _id: stateId, countryId },
      {
        $set: {
          taxBases: newTaxBases,
          stateGdp: newStateGdp,
        },
      }
    );
  }

  // Calculate state revenue including federal grants (now using grown bases)
  const revenue = await calculateStateRevenue(
    db,
    stateId,
    countryId,
    normalizedTaxRates,
    federalGrants
  );

  // Calculate state spending based on enacted laws
  const spending = await calculateStateSpending(db, stateId, countryId, {
    ...stateBudget,
    revenue,
    stateGdp: newStateGdp,
  });

  // Calculate surplus/deficit
  const surplus = revenue.total - spending.total;

  // Update balance (accumulated surplus/deficit over time)
  const newBalance = (stateBudget.balance ?? 0) + surplus;

  await db.collection<StateBudget>("stateBudgets").updateOne(
    { _id: stateId, countryId },
    {
      $set: {
        fiscalYear,
        taxRates: normalizedTaxRates,
        revenue,
        spending,
        surplus,
        balance: newBalance,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Apply economic penalties due to high debt levels.
 *
 * GDP growth is NOT directly mutated here — debt already reduces sector
 * profitability via the debtToGdpMod margin modifier in sectorCalculations.ts,
 * which naturally lowers revenue growth and thus GDP growth through the
 * realized-output pipeline. Directly $inc-ing gdpGrowth was double-counting.
 *
 * Public trust is still directly penalized as it has no indirect mechanism.
 */
async function applyDebtPenalties(
  db: Db,
  countryId: CountryId,
  gdpPenalty: number,
  trustPenalty: number
): Promise<void> {
  if (gdpPenalty > 0) {
    console.log(
      `[FiscalYear] Debt GDP penalty: ${gdpPenalty}% (applied via sector margin modifier, not direct metric mutation)`
    );
  }

  if (trustPenalty > 0) {
    // Debt→trust now lands on the political BOARD, via the same events channel
    // as the sovereign-default hit. It previously $inc'd a legacy path that no
    // country has any more, so the penalty had silently stopped applying.
    await applyLegacyTrustDelta(db, countryId, -trustPenalty);
  }
}

/**
 * Create a frozen snapshot of a country's federal budget at a fiscal year boundary.
 * Captures the complete budget state, state grants, and active enacted laws.
 * Uses upsert so cron retries overwrite rather than duplicate.
 */
export async function saveFiscalYearSnapshot(
  db: Db,
  countryId: string,
  budgetDocId: string,
  fiscalYear: number,
  preloaded?: { budget?: FederalBudget | null; currentTurn?: number }
): Promise<void> {
  // `preloaded` exists for callers that already hold these — the bootstrap
  // snapshot loop reads every budget in one find and the turn is the same
  // singleton for all of them, so both reads below were pure repetition there.
  // Omitted by the fiscal-year rollover caller, which fetches as before.
  const budget =
    preloaded?.budget ??
    (await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetDocId }));
  if (!budget) return;

  let turn = preloaded?.currentTurn;
  if (turn === undefined) {
    const gameState = await db
      .collection("gameState")
      .findOne({ _id: "current" } as Record<string, unknown>, { projection: { currentTurn: 1 } });
    turn = (gameState as { currentTurn?: number } | null)?.currentTurn ?? 0;
  }

  // Active national-scope enacted laws (not repealed)
  const lawQuery: Record<string, unknown> = {
    scope: "national",
    repealedAt: { $exists: false },
  };
  if (countryId === COUNTRY_CONFIGS.US.id) {
    lawQuery.$or = [{ countryId }, { countryId: { $exists: false } }];
  } else {
    lawQuery.countryId = countryId;
  }
  const laws = await db.collection<EnactedLaw>("enactedLaws").find(lawQuery).toArray();

  // State grants breakdown
  const [states, stateBudgets] = await Promise.all([
    db
      .collection<State>("states")
      .find({ countryId } as Record<string, unknown>)
      .toArray(),
    // Scope the budget fetch to the same country so a cross-country state-ID
    // collision (e.g. CN HB / DE HB) can't surface the wrong budget below.
    db
      .collection<StateBudget>("stateBudgets")
      .find({ countryId } as Record<string, unknown>)
      .toArray(),
  ]);
  const stateGrants = states
    .map((s) => {
      const sb = stateBudgets.find((b) => b.stateId === String(s._id));
      return {
        stateId: String(s._id),
        stateName: s.name,
        amount: sb?.revenue?.federalGrants ?? 0,
      };
    })
    .filter((g) => g.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const formatCostModel = (law: EnactedLaw): string => {
    if (law.gdpPerCapitaMultiplier !== undefined)
      return `${(law.gdpPerCapitaMultiplier * 100).toFixed(2)}% of GDP`;
    if (law.annualCostPerCapita !== undefined)
      return `$${law.annualCostPerCapita.toLocaleString()}/person`;
    if (law.annualCostUsd !== undefined) {
      const abs = Math.abs(law.annualCostUsd);
      if (abs >= 1_000_000_000) return `$${(abs / 1_000_000_000).toFixed(2)}B`;
      if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
      return `$${abs.toLocaleString()}`;
    }
    if (law.budgetCost !== 0) return `${law.budgetCost.toFixed(1)}% of budget`;
    return "No direct fiscal cost";
  };

  const snapshot: FederalBudgetSnapshot = {
    _id: `${countryId}:FY${fiscalYear}`,
    countryId,
    fiscalYear,
    turn,
    budget: {
      revenue: budget.revenue,
      taxRates: budget.taxRates,
      taxBases: budget.taxBases,
      spending: budget.spending,
      debt: budget.debt,
      economicFactors: budget.economicFactors,
      surplus: budget.surplus,
      gdp: budget.gdp,
      debtToGdpRatio: budget.debtToGdpRatio,
      creditRating: budget.creditRating,
      // Freeze currency at snapshot time — every money field in `budget` is
      // denominated in this code (v0.2.6). Historical viewers pair each
      // snapshot with its own code rather than relying on live country config.
      currencyCode: budget.currencyCode,
    },
    stateGrants,
    enactedLaws: laws.map((law) => ({
      title: law.title,
      budgetCategory: law.budgetCategory,
      costModel: formatCostModel(law),
      enactedYear: law.enactedYear,
    })),
    createdAt: new Date(),
  };

  await db
    .collection<FederalBudgetSnapshot>("federalBudgetSnapshots")
    .replaceOne({ _id: snapshot._id }, snapshot, { upsert: true });

  console.log(`[FiscalYear] Snapshot saved: ${snapshot._id}`);
}
