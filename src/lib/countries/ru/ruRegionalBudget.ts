/**
 * RU regional-budget turn phase (political-legislation spec §5.2 — built with
 * the legislation rebuild; no RU pipeline existed before).
 *
 * Command-economy variant of the UK pattern: each region's budget is a
 * population-proportional share of the union's stateGrants pool (the
 * ruling-#15 seed allocates ≈₽60B there) rather than local taxation. Enacted
 * regional political laws are priced through the new cost engine on the
 * region's own fiscal base; the same deficit-constraint mechanics apply —
 * more than one consecutive turn over budget downgrades the most expensive
 * programme one level.
 */

import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";

const GDP_MILLIONS = 1_000_000;

export interface RuGrantInput {
  grantsPool: number;
  regionPopulation: number;
  nationalPopulation: number;
}

/** Population-proportional share of the union grants pool. */
export function calculateRuRegionalGrant(input: RuGrantInput): number {
  if (input.nationalPopulation <= 0) return 0;
  return (input.grantsPool * input.regionPopulation) / input.nationalPopulation;
}

interface RegionalLawCost {
  policy: StatePolicy;
  cost: number;
  level: number;
  lawId: string;
}

function enactedRegionalLawCosts(policies: StatePolicy[], region: State): RegionalLawCost[] {
  const base = { gdp: (region.gdp ?? 0) * GDP_MILLIONS, population: region.population ?? 0 };
  const out: RegionalLawCost[] = [];
  for (const policy of policies) {
    const law = getLaw(policy.legislationTypeId);
    if (!law || law.kind === "tax" || !law.levels) continue;
    const level = Math.max(0, Math.min(4, policy.policyOptionIndex ?? 0));
    // NET burden (spec §5.2 — a regional law's revenue accrues to the same
    // payer): revenue-bearing laws charge cost − revenue.
    const fiscal = computeLawCost(law.levels[level], base, "RU", null);
    out.push({ policy, cost: fiscal.cost - fiscal.revenue, level, lawId: law.id });
  }
  return out;
}

export async function processRURegionalBudgets(
  db: Db,
  turnNumber: number
): Promise<{ regionsProcessed: number }> {
  const regions = await db.collection<State>("states").find({ countryId: "RU" }).toArray();
  if (regions.length === 0) return { regionsProcessed: 0 };

  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne(
      { _id: getNationalBudgetId("RU") },
      { projection: { spending: 1, baselineStateGrants: 1 } }
    );
  if (!budget) return { regionsProcessed: 0 };
  // `stateGrants` is normally the live pool, but a negative value is an invalid
  // allocation, not a valid negative regional grant. Treat it like a missing
  // value and retain the seeded pool instead. Otherwise every region becomes
  // permanently over budget and forced austerity unwinds enacted laws to L0.
  const liveGrantsPool = budget.spending?.stateGrants;
  const grantsPool =
    typeof liveGrantsPool === "number" && liveGrantsPool > 0
      ? liveGrantsPool
      : Math.max(0, budget.baselineStateGrants ?? 0);

  const nationalPopulation = regions.reduce((sum, r) => sum + (r.population ?? 0), 0);

  const regionIds = regions.map((r) => r._id as string);
  const allRegionalPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: { $in: regionIds }, scope: "state" })
    .toArray();
  const policiesByRegion = new Map<string, StatePolicy[]>();
  for (const policy of allRegionalPolicies) {
    const existing = policiesByRegion.get(policy.stateId) ?? [];
    existing.push(policy);
    policiesByRegion.set(policy.stateId, existing);
  }

  const existingBudgets = await db
    .collection<RegionalBudget>("regionalBudgets")
    .find({ _id: { $in: regionIds } })
    .toArray();
  const budgetMap = new Map(existingBudgets.map((b) => [b._id, b]));

  const statePolicyOps: AnyBulkWriteOperation<StatePolicy>[] = [];
  const regionalBudgetOps: AnyBulkWriteOperation<RegionalBudget>[] = [];
  let regionsProcessed = 0;

  for (const region of regions) {
    const regionId = region._id as string;
    const existing = budgetMap.get(regionId);

    const unionGrant = calculateRuRegionalGrant({
      grantsPool,
      regionPopulation: region.population ?? 0,
      nationalPopulation,
    });

    const lawCosts = enactedRegionalLawCosts(policiesByRegion.get(regionId) ?? [], region);
    const enactedBillCosts = lawCosts.reduce((sum, entry) => sum + entry.cost, 0);

    const surplus = unionGrant - enactedBillCosts;
    const isOverBudget = surplus < 0;
    const turnsOverBudget = isOverBudget ? (existing?.turnsOverBudget ?? 0) + 1 : 0;

    // Forced austerity: over budget for more than one turn → the most
    // expensive programme drops one level (mirrors the UK pipeline).
    if (turnsOverBudget > 1 && lawCosts.length > 0) {
      const mostExpensive = [...lawCosts].sort((a, b) => b.cost - a.cost)[0];
      if (mostExpensive.cost > 0 && mostExpensive.level > 0) {
        const law = getLaw(mostExpensive.lawId)!;
        const doc = projectLawToLegislationType(law);
        const newLevel = mostExpensive.level - 1;
        const option = doc.policyOptions![newLevel];
        statePolicyOps.push({
          updateOne: {
            filter: { stateId: regionId, legislationTypeId: mostExpensive.lawId },
            update: {
              $set: {
                policyOptionId: option.id,
                policyOptionIndex: newLevel,
                economic: option.economic,
                social: option.social,
                effectDirection: option.effectDirection,
              },
            },
          },
        });
      }
    }

    const budgetDoc: RegionalBudget = {
      _id: regionId,
      countryId: "RU",
      turn: turnNumber,
      // UK-required fields, zeroed (same convention as the JP/DE/CN variants).
      councilTaxRevenue: 0,
      businessRatesRevenue: 0,
      westminsterGrant: 0,
      unionGrant,
      totalBudget: unionGrant,
      enactedBillCosts,
      surplus,
      isOverBudget,
      turnsOverBudget,
      // Zeroed value bases — no local taxation to drift (same convention as
      // the JP/DE/CN variants zeroing the UK-required fields).
      propertyValuePerCapita: 0,
      commercialValuePerCapita: 0,
      propertyValueBaseline: 0,
      commercialValueBaseline: 0,
      chancellorAllocation: null,
      updatedAt: new Date(),
    };
    regionalBudgetOps.push({
      updateOne: { filter: { _id: regionId }, update: { $set: budgetDoc }, upsert: true },
    });
    regionsProcessed++;
  }

  if (statePolicyOps.length > 0) {
    await db.collection<StatePolicy>("statePolicies").bulkWrite(statePolicyOps);
  }
  if (regionalBudgetOps.length > 0) {
    await db.collection<RegionalBudget>("regionalBudgets").bulkWrite(regionalBudgetOps);
  }

  return { regionsProcessed };
}
