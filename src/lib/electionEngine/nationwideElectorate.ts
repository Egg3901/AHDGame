import type {
  State,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface NationwideElectoratePreload {
  state: State;
  demographics: StateDemographics;
  turnout: StateDemographicTurnout;
  partyOrgs: StatePartyOrg[];
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function latestDate(values: Array<Date | undefined>): Date | undefined {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps));
}

function earliestDate(values: Array<Date | undefined>): Date | undefined {
  const timestamps = values
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  if (timestamps.length === 0) return undefined;
  return new Date(Math.min(...timestamps));
}

function weightedAverage(
  rows: Array<{ value: number | undefined; weight: number }>
): number | undefined {
  const usable = rows.filter(
    (row): row is { value: number; weight: number } =>
      typeof row.value === "number" && Number.isFinite(row.value) && row.weight > 0
  );
  const totalWeight = usable.reduce((total, row) => total + row.weight, 0);
  if (totalWeight <= 0) return undefined;
  return usable.reduce((total, row) => total + row.value * row.weight, 0) / totalWeight;
}

/**
 * Build the synthetic constituency consumed by a nationwide direct election.
 * Regional seed rows remain authoritative; this adapter only folds them into
 * the country-code key used by the election document.
 */
export function buildNationwideElectoratePreload(
  countryId: CountryId,
  states: State[],
  demographics: StateDemographics[],
  turnoutDocs: StateDemographicTurnout[],
  partyOrgs: StatePartyOrg[]
): NationwideElectoratePreload | null {
  const countryStates = states.filter((state) => state.countryId === countryId);
  if (countryStates.length === 0) return null;

  const stateById = new Map(countryStates.map((state) => [state._id, state]));
  const totalPopulation = sum(countryStates.map((state) => state.population));
  if (totalPopulation <= 0) return null;

  const countryDemographics = demographics.filter(
    (row) => row.countryId === countryId && stateById.has(row._id)
  );
  if (countryDemographics.length === 0) return null;

  const categoryIds = new Set(
    countryDemographics.flatMap((row) => Object.keys(row.categoryWeights))
  );
  const categoryWeights: StateDemographics["categoryWeights"] = {};
  for (const categoryId of categoryIds) {
    categoryWeights[categoryId] =
      weightedAverage(
        countryDemographics.map((row) => ({
          value: row.categoryWeights[categoryId],
          weight: stateById.get(row._id)?.population ?? 0,
        }))
      ) ?? 0;
  }

  const groupIds = new Set(countryDemographics.flatMap((row) => Object.keys(row.groups)));
  const groups: StateDemographics["groups"] = {};
  for (const groupId of groupIds) {
    const rows = countryDemographics.flatMap((row) => {
      const group = row.groups[groupId];
      const statePopulation = stateById.get(row._id)?.population ?? 0;
      if (!group || statePopulation <= 0) return [];
      return [{ group, statePopulation, groupWeight: statePopulation * (group.population / 100) }];
    });
    const groupPopulation = rows.reduce((total, row) => total + row.groupWeight, 0);
    if (groupPopulation <= 0) continue;
    groups[groupId] = {
      population: (groupPopulation / totalPopulation) * 100,
      economicLean:
        weightedAverage(
          rows.map((row) => ({ value: row.group.economicLean, weight: row.groupWeight }))
        ) ?? 0,
      socialLean:
        weightedAverage(
          rows.map((row) => ({ value: row.group.socialLean, weight: row.groupWeight }))
        ) ?? 0,
      ...(weightedAverage(
        rows.map((row) => ({ value: row.group.turnout, weight: row.groupWeight }))
      ) != null
        ? {
            turnout: weightedAverage(
              rows.map((row) => ({ value: row.group.turnout, weight: row.groupWeight }))
            ),
          }
        : {}),
      ...(weightedAverage(
        rows.map((row) => ({ value: row.group.nameRecognition, weight: row.groupWeight }))
      ) != null
        ? {
            nameRecognition: weightedAverage(
              rows.map((row) => ({ value: row.group.nameRecognition, weight: row.groupWeight }))
            ),
          }
        : {}),
    };
  }

  const countryTurnout = turnoutDocs.filter(
    (row) => row.countryId === countryId && stateById.has(row._id)
  );
  const modifierCategories = new Set(countryTurnout.flatMap((row) => Object.keys(row.modifiers)));
  const modifiers: StateDemographicTurnout["modifiers"] = {};
  for (const categoryId of modifierCategories) {
    const modifierGroupIds = new Set(
      countryTurnout.flatMap((row) => Object.keys(row.modifiers[categoryId] ?? {}))
    );
    modifiers[categoryId] = {};
    for (const groupId of modifierGroupIds) {
      modifiers[categoryId][groupId] =
        weightedAverage(
          countryTurnout.map((row) => ({
            value: row.modifiers[categoryId]?.[groupId],
            weight: stateById.get(row._id)?.population ?? 0,
          }))
        ) ?? 0;
    }
  }

  const countryPartyOrgs = partyOrgs.filter(
    (row) => row.countryId === countryId && stateById.has(row.stateId)
  );
  const partyIds = new Set(countryPartyOrgs.map((row) => row.partyId));
  const nationalPartyOrgs: StatePartyOrg[] = [];
  for (const partyId of partyIds) {
    const rows = countryPartyOrgs.filter((row) => row.partyId === partyId);
    const first = rows[0];
    if (!first) continue;
    const weighted = (field: keyof StatePartyOrg) =>
      weightedAverage(
        rows.map((row) => ({
          value: typeof row[field] === "number" ? (row[field] as number) : undefined,
          weight: stateById.get(row.stateId)?.population ?? 0,
        }))
      );
    nationalPartyOrgs.push({
      ...first,
      _id: `${countryId}_${partyId}`,
      stateId: countryId,
      organization: weighted("organization") ?? 0,
      treasury: sum(rows.map((row) => row.treasury)),
      stateTaxRate: weighted("stateTaxRate") ?? 0,
      politicalStrength: weighted("politicalStrength") ?? 0,
      hasPresence: rows.some((row) => row.hasPresence),
      createdAt: earliestDate(rows.map((row) => row.createdAt)) ?? first.updatedAt,
      updatedAt: latestDate(rows.map((row) => row.updatedAt)) ?? first.updatedAt,
      ...(weighted("registration") != null ? { registration: weighted("registration") } : {}),
      ...(weighted("registrationShare") != null
        ? { registrationShare: weighted("registrationShare") }
        : {}),
      ...(weighted("primarySurge") != null ? { primarySurge: weighted("primarySurge") } : {}),
    });
  }

  const demographicUpdatedAt =
    latestDate(countryDemographics.map((row) => row.lastUpdated)) ?? new Date(0);
  const turnoutUpdatedAt =
    countryTurnout.length > 0
      ? (latestDate(countryTurnout.map((row) => row.lastUpdated)) ?? demographicUpdatedAt)
      : demographicUpdatedAt;
  const turnoutDecayAt =
    countryTurnout.length > 0
      ? (latestDate(countryTurnout.map((row) => row.lastDecayApplied)) ?? demographicUpdatedAt)
      : demographicUpdatedAt;

  return {
    state: {
      _id: countryId,
      countryId,
      regionType: "nation",
      name: `${countryId} national electorate`,
      population: totalPopulation,
      votingEligiblePopulation: sum(
        countryStates.map((state) => state.votingEligiblePopulation ?? state.population)
      ),
      workingAgePopulation: sum(countryStates.map((state) => state.workingAgePopulation)),
      militaryServicePopulation: sum(countryStates.map((state) => state.militaryServicePopulation)),
      gdp: sum(countryStates.map((state) => state.gdp)),
      capitalStock: sum(countryStates.map((state) => state.capitalStock)),
      houseDistricts: sum(countryStates.map((state) => state.houseDistricts)),
      stateSenateSeats: sum(countryStates.map((state) => state.stateSenateSeats)),
      region: "National",
      votingSystem: "fptp",
    },
    demographics: {
      _id: countryId,
      countryId,
      categoryWeights,
      groups,
      cachedEconomicLean: weightedAverage(
        countryDemographics.map((row) => ({
          value: row.cachedEconomicLean,
          weight: stateById.get(row._id)?.population ?? 0,
        }))
      ),
      cachedSocialLean: weightedAverage(
        countryDemographics.map((row) => ({
          value: row.cachedSocialLean,
          weight: stateById.get(row._id)?.population ?? 0,
        }))
      ),
      lastUpdated: demographicUpdatedAt,
    },
    turnout: {
      _id: countryId,
      countryId,
      modifiers,
      lastDecayApplied: turnoutDecayAt,
      lastUpdated: turnoutUpdatedAt,
    },
    partyOrgs: nationalPartyOrgs,
  };
}
