import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character, ElectedOfficial, State } from "@/lib/db/types";
import type { EnactedLaw, FederalBudget } from "@/lib/db/types/budget";
import {
  getLegislationTypeById,
  canonicalizeLegislationTypeId,
} from "@/lib/legislationTypeAliases";
import { calculateEnactedLawAnnualCost } from "@/lib/budget/costs";
import { resolveNationalMedianIncome } from "@/lib/budget/spending";
import { getEraContext } from "@/lib/era/context";
import { buildAxisEvents, replayAxesTimeline } from "@/lib/policy/axesTimeline";
import {
  loadCountryLegislationTypes,
  nationalLawCountryQuery,
} from "@/lib/policy/nationalPolicyRecords";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";

/** Per-law provenance for the statute book's mono sublines + fiscal chips. */
export interface PolicyProvenance {
  title: string;
  enactedAt: string;
  enactedYear: number;
  /** Annual budget cost (local currency, same context as the budget page); null when not seeded. */
  annualCost: number | null;
}

async function resolveCurrentEra(
  db: Awaited<ReturnType<typeof getDb>>,
  countryId: CountryId
): Promise<{ label: string; sinceDate: string | null; sinceTurn: number | null } | null> {
  const config = COUNTRY_CONFIGS[countryId];
  if (config.governmentType === "presidential") {
    const presidentOfficial = await db
      .collection<ElectedOfficial>("electedOfficials")
      .findOne({ countryId, officeType: "president" });
    if (!presidentOfficial?.characterId) return null;
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: presidentOfficial.characterId }, { projection: { name: 1 } });
    if (!character) return null;
    const lastName = character.name.split(" ").slice(-1)[0];
    return {
      label: `${lastName} administration`,
      sinceDate: presidentOfficial.electedAt?.toISOString() ?? null,
      sinceTurn: null,
    };
  }
  const formation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!formation || formation.status !== "formed" || !formation.pmName) return null;
  return {
    label: `${formation.pmName} government`,
    sinceDate: null,
    sinceTurn: formation.formedTurn ?? null,
  };
}

/**
 * Build the policy "record" payload (axes timeline + provenance) for a country.
 * Shared by the GET route and server components (the policy page) so the page can
 * seed initial data with a direct DB call instead of a client self-fetch.
 */
export async function loadPolicyRecordPayload(countryId: CountryId) {
  const db = await getDb();

  const [types, laws, budget, states, era, eraCtx, nationalMedianIncome] = await Promise.all([
    loadCountryLegislationTypes(db, countryId),
    db
      .collection<EnactedLaw>("enactedLaws")
      .find({
        scope: "national",
        ...nationalLawCountryQuery(countryId),
        repealedAt: { $exists: false },
      })
      .sort({ enactedAt: 1 })
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId }),
    db
      .collection<State>("states")
      .find({ countryId }, { projection: { population: 1 } })
      .toArray(),
    resolveCurrentEra(db, countryId),
    // Era context + game income so the fiscal chips use the same era cost forms
    // the budget page does (flag-off ⇒ year null ⇒ legacy costs, unchanged).
    getEraContext(db),
    resolveNationalMedianIncome(db, countryId),
  ]);

  const axisEvents = buildAxisEvents(laws, (id) =>
    getLegislationTypeById(types.legislationTypeMap, id)
  );
  const { points, events } = replayAxesTimeline(axisEvents);

  // Latest law per canonical type → statute-book provenance. Costs use the
  // budget page's exact context so the fiscal chips agree with the budget.
  const population = states.reduce((sum, state) => sum + (state.population ?? 0), 0);
  const costContext = budget
    ? {
        budgetCapacity: budget.revenue?.total ?? 0,
        gdp: budget.gdp ?? 0,
        population,
        countryId,
        nationalGdpPerCapita: population > 0 && budget.gdp ? budget.gdp / population : undefined,
        nationalMedianIncome,
        year: eraCtx.year,
      }
    : null;
  const provenance: Record<string, PolicyProvenance> = {};
  for (const law of laws) {
    const canonicalId =
      canonicalizeLegislationTypeId(law.legislationTypeId) ?? law.legislationTypeId;
    const hasCostData =
      law.gdpPerCapitaMultiplier !== undefined ||
      law.annualCostPerCapita !== undefined ||
      law.annualCostUsd !== undefined ||
      // Era-native spending laws carry the class-driven fractions; a law with
      // only these (no legacy field) still has a real cost when the flag is on.
      law.gdpCostFraction !== undefined ||
      law.incomeCostFraction !== undefined;
    provenance[canonicalId] = {
      title: law.title,
      enactedAt: law.enactedAt.toISOString(),
      enactedYear: law.enactedYear,
      annualCost:
        costContext && hasCostData ? calculateEnactedLawAnnualCost(law, costContext) : null,
    };
  }

  return { points, events, era, provenance };
}
