/**
 * Campaign audiences use the election's regional census and live ideology.
 * loadCampaignAudience exposes the same identity cells used to score ads.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState, State, StateDemographics, StateDemographicTurnout } from "@/lib/db/types";
import { resolveTurnout } from "@/lib/electionEngine/resolvedTurnout";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
import { eraYearContextFromGameState } from "@/lib/era/context";
import { CAMPAIGN_RULES_VERSION, turnoutForElection } from "./rules";

export async function loadCampaignAudience(
  db: Db,
  countryId: CountryId,
  stateId: string,
  turnout?: StateDemographicTurnout | null,
  turnoutRulesVersion = CAMPAIGN_RULES_VERSION
) {
  const [state, demographics, defaults, gameState, categories, turnoutData] = await Promise.all([
    db.collection<State>("states").findOne({ _id: stateId, countryId }),
    db.collection<StateDemographics>("stateDemographics").findOne({ _id: stateId, countryId }),
    db.collection<StateDemographics>("demographicDefaults").findOne({ _id: stateId, countryId }),
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          preset: 1,
          currentYear: 1,
          currentTurn: 1,
          startingYear: 1,
          eraSystemEnabled: 1,
        },
      }
    ),
    loadDemographicCategories(db),
    turnout === undefined
      ? db
          .collection<StateDemographicTurnout>("stateDemographicTurnout")
          .findOne({ _id: stateId, countryId })
      : Promise.resolve(turnout),
  ]);
  if (!state || !demographics) return null;
  const context = {
    countryId,
    stateId,
    preset: gameState?.preset,
    ...eraYearContextFromGameState(gameState),
    campaignRulesVersion: CAMPAIGN_RULES_VERSION,
    currentTurn: gameState?.currentTurn ?? 0,
    statePopulation: state.votingEligiblePopulation ?? state.population,
    stateEconomicLean: state.cachedEconomicLean,
    stateSocialLean: state.cachedSocialLean,
    votingSystem: state.votingSystem,
    demographics,
    categories,
    demographicDefaults: defaults,
    enriched: [],
  };
  const build = (doc: StateDemographicTurnout | null = turnoutData) => {
    const selected = turnoutForElection(doc, { campaignRulesVersion: turnoutRulesVersion });
    return buildGranularElectorateSubstrate({
      ...context,
      cache: "bypass",
      turnoutDoc: selected,
      liveTurnouts: resolveTurnout(
        context.statePopulation,
        demographics,
        categories,
        selected,
        context
      ).byGroup,
    });
  };
  const substrate = build(turnoutData);
  if (!substrate?.campaignCells?.length) return null;
  return { context, cells: substrate.campaignCells, build };
}

export type LoadedCampaignAudience = NonNullable<Awaited<ReturnType<typeof loadCampaignAudience>>>;

/** One batch for every region of a projection; no reads inside candidate loops. */
export async function loadCampaignProjectionContext(db: Db, regionIds: string[]) {
  const [turnout, defaults, gameState] = await Promise.all([
    db
      .collection<StateDemographicTurnout>("stateDemographicTurnout")
      .find({ _id: { $in: regionIds } })
      .toArray(),
    db
      .collection<StateDemographics>("demographicDefaults")
      .find({ _id: { $in: regionIds } })
      .toArray(),
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          preset: 1,
          currentYear: 1,
          currentTurn: 1,
          startingYear: 1,
          eraSystemEnabled: 1,
        },
      }
    ),
  ]);
  return {
    campaignRulesVersion: CAMPAIGN_RULES_VERSION,
    currentTurn: gameState?.currentTurn ?? 0,
    preset: gameState?.preset,
    ...eraYearContextFromGameState(gameState),
    turnoutByState: new Map(turnout.map((doc) => [doc._id, doc])),
    defaultsByState: new Map(defaults.map((doc) => [doc._id, doc])),
  };
}

export type CampaignProjectionContext = Awaited<ReturnType<typeof loadCampaignProjectionContext>>;

/** Resolution fallback loads all advertised regions together, then scores in memory. */
export async function loadRegionalCampaignCells(
  db: Db,
  states: State[],
  legacyRegions: ReadonlySet<string> = new Set()
) {
  const ids = states.map((state) => state._id);
  const [context, demographics, categories] = await Promise.all([
    loadCampaignProjectionContext(db, ids),
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: ids } })
      .toArray(),
    loadDemographicCategories(db),
  ]);
  const demographicMap = new Map(demographics.map((doc) => [doc._id, doc]));
  const result = new Map<string, import("./rules").CampaignCell[]>();
  for (const state of states) {
    const demographics = demographicMap.get(state._id);
    if (!demographics || demographics.countryId !== state.countryId) continue;
    const regionKey = `${state.countryId}:${state._id}`;
    for (const version of legacyRegions.has(regionKey) ||
    legacyRegions.has(`${state.countryId}:${state.countryId}`)
      ? [1, 0]
      : [1]) {
      const turnoutDoc = turnoutForElection(context.turnoutByState.get(state._id), {
        campaignRulesVersion: version,
      });
      const population = state.votingEligiblePopulation ?? state.population;
      const substrate = buildGranularElectorateSubstrate({
        ...context,
        countryId: state.countryId,
        stateId: state._id,
        statePopulation: population,
        demographics,
        categories,
        turnoutDoc,
        enriched: [],
        liveTurnouts: resolveTurnout(population, demographics, categories, turnoutDoc, context)
          .byGroup,
        demographicDefaults: context.defaultsByState.get(state._id),
      });
      if (substrate?.campaignCells)
        result.set(`${regionKey}${version === 0 ? ":0" : ""}`, substrate.campaignCells);
    }
  }
  for (const countryId of new Set(states.map((state) => state.countryId))) {
    const regions = states.filter(
      (state) => state.countryId === countryId && state._id !== countryId
    );
    const population = regions.reduce(
      (sum, state) => sum + (state.votingEligiblePopulation ?? state.population),
      0
    );
    if (!(population > 0)) continue;
    for (const suffix of ["", ":0"]) {
      const cells = regions.flatMap((state) =>
        (result.get(`${countryId}:${state._id}${suffix}`) ?? []).map((cell) => ({
          ...cell,
          id: `${state._id}:${cell.id}`,
          stateId: state._id,
          share: (cell.share * (state.votingEligiblePopulation ?? state.population)) / population,
        }))
      );
      if (cells.length) result.set(`${countryId}:${countryId}${suffix}`, cells);
    }
  }
  return result;
}

/** Detail-view fallback; list and turn callers load countries in batches. */
export async function loadNationalCampaignCells(
  db: Db,
  countryId: CountryId,
  version = CAMPAIGN_RULES_VERSION
) {
  const regions = await db
    .collection<State>("states")
    .find({ countryId, _id: { $ne: countryId } })
    .toArray();
  const cells = await loadRegionalCampaignCells(
    db,
    regions,
    version ? new Set() : new Set([`${countryId}:${countryId}`])
  );
  return cells.get(`${countryId}:${countryId}${version ? "" : ":0"}`);
}
