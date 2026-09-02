/**
 * The Living Code at REGION scope: the region's own enactment timeline, the
 * current regional administration, and per-law provenance for its statute book.
 *
 * Two deltas from `loadPolicyRecordPayload`, both load-bearing:
 *
 * 1. COST. State laws store `budgetCost` / `costModelV2`, not the national
 *    `gdpCostFraction` / `annualCostPerCapita` / `annualCostUsd` /
 *    `gdpPerCapitaMultiplier`. `calculateEnactedLawAnnualCost` returns null on
 *    that shape, so reusing it would render EVERY state law as free. Cost goes
 *    through the new-generation cost engine against the region's own budget.
 * 2. ERA. `resolveCurrentEra` names a president or prime minister. A region is
 *    governed by its own executive, so the era line resolves that instead.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial, State } from "@/lib/db/types";
import type { EnactedLaw, StateBudget } from "@/lib/db/types/budget";
import {
  canonicalizeLegislationTypeId,
  getLegislationTypeById,
} from "@/lib/legislationTypeAliases";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import type { CostAnchorCountryId } from "@/lib/politicalLegislation/types";
import { buildAxisEvents, replayAxesTimeline } from "@/lib/policy/axesTimeline";
import { loadCountryLegislationTypes } from "@/lib/policy/nationalPolicyRecords";
import { resolveExecutiveOffice } from "@/lib/states/regionalExecutive";
import type { PolicyProvenance } from "@/lib/policy/policyRecordPayload";

/**
 * "<Surname> administration", from whichever office actually governs this
 * region. Null when the seat is vacant — an invented label would be worse than
 * no era line at all.
 */
async function resolveRegionalEra(
  db: Db,
  countryId: CountryId,
  regionId: string
): Promise<{ label: string; sinceDate: string | null; sinceTurn: number | null } | null> {
  const config = resolveExecutiveOffice(countryId, regionId);
  if (!config) return null;
  const official = await db
    .collection<ElectedOfficial>("electedOfficials")
    .findOne(
      { countryId, state: regionId.toUpperCase(), officeType: config.officeType },
      { sort: { electedAt: -1 } }
    );
  if (!official?.characterId) return null;
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: official.characterId }, { projection: { name: 1 } });
  if (!character) return null;
  const lastName = character.name.split(" ").slice(-1)[0];
  return {
    label: `${lastName} administration`,
    sinceDate: official.electedAt ? new Date(official.electedAt).toISOString() : null,
    sinceTurn: null,
  };
}

export async function loadRegionPolicyRecordPayload(
  countryId: CountryId,
  regionId: string,
  dbOverride?: Db
) {
  const db = dbOverride ?? (await getDb());

  const [types, laws, state, budget, era] = await Promise.all([
    loadCountryLegislationTypes(db, countryId),
    db
      .collection<EnactedLaw>("enactedLaws")
      .find({ scope: "state", stateId: regionId, repealedAt: { $exists: false } })
      .sort({ enactedAt: 1 })
      .toArray(),
    db
      .collection<State>("states")
      .findOne({ _id: regionId }, { projection: { population: 1, gdp: 1 } }),
    db.collection<StateBudget>("stateBudgets").findOne({ _id: regionId }),
    resolveRegionalEra(db, countryId, regionId),
  ]);

  const axisEvents = buildAxisEvents(laws, (id) =>
    getLegislationTypeById(types.legislationTypeMap, id)
  );
  const { points, events } = replayAxesTimeline(axisEvents);

  // The region's own fiscal base, not the country's: a state programme costs a
  // share of the STATE economy, and pricing it against national GDP would
  // understate every figure by orders of magnitude.
  // `stateGdp` and `State.gdp` are both stored in millions.
  const gdp = (budget?.stateGdp ?? state?.gdp ?? 0) * 1_000_000;
  const base = { gdp, population: state?.population ?? 0 };
  const anchorCountry = countryId as CostAnchorCountryId;

  const provenance: Record<string, PolicyProvenance> = {};
  for (const law of laws) {
    const canonicalId =
      canonicalizeLegislationTypeId(law.legislationTypeId) ?? law.legislationTypeId;
    let annualCost: number | null = null;
    if (law.costModelV2 && gdp > 0) {
      const { cost } = computeLawCost(
        { name: "", description: "", ...law.costModelV2 },
        base,
        anchorCountry,
        null
      );
      annualCost = cost;
    } else if (typeof law.budgetCost === "number" && law.budgetCost > 0 && budget?.spending) {
      // Legacy state laws priced as a percentage of the region's budget.
      annualCost = (law.budgetCost / 100) * (budget.spending.total ?? 0);
    }
    provenance[canonicalId] = {
      title: law.title,
      enactedAt: law.enactedAt.toISOString(),
      enactedYear: law.enactedYear,
      annualCost,
    };
  }

  return { points, events, era, provenance };
}

/** Whether this country has regions whose law book is worth a record view. */
export function regionRecordSupported(countryId: string): boolean {
  return Boolean(COUNTRY_CONFIGS[countryId as CountryId]);
}
