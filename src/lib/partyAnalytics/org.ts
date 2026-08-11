import type { Db } from "mongodb";
import type { PartyBudget, State, StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { regionPartyUrl } from "@/lib/urls";
import { ORG_DECAY_RATE } from "@/lib/turn/partyOrg/constants";
import type {
  PartyAnalyticsGrowthMetric,
  PartyAnalyticsOrgSection,
  PartyAnalyticsStateMetric,
} from "./types";

interface StateOrgBudgetSummary {
  stateId: string;
  orgBuildingPercent: number;
}

function buildStateMetric(
  statePartyOrg: StatePartyOrg,
  stateName: string,
  countryId: CountryId,
  growthPerTurn: number
): PartyAnalyticsStateMetric {
  return {
    stateId: statePartyOrg.stateId,
    stateName,
    organization: Math.round((statePartyOrg.organization ?? 0) * 10) / 10,
    growthPerTurn,
    href: regionPartyUrl(countryId, statePartyOrg.stateId, statePartyOrg.partyId),
  };
}

function buildGrowthMetric(metric: PartyAnalyticsStateMetric): PartyAnalyticsGrowthMetric {
  return {
    ...metric,
    trendLabel:
      metric.growthPerTurn > 0 ? "Growing" : metric.growthPerTurn < 0 ? "Shrinking" : "Flat",
  };
}

function roundToTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function calculateGrowthPerTurn(
  statePartyOrg: StatePartyOrg,
  _budget: Pick<PartyBudget, "orgBuildingPercent"> | null
): number {
  // Org growth no longer comes from a passive treasury budget — it's
  // PS-driven at request time. Per-turn analytics show the passive decay
  // baseline for parties with Org > 0; growth is event-driven and not
  // representable as a per-turn rate.
  return (statePartyOrg.organization ?? 0) > 0 ? roundToTenths(-ORG_DECAY_RATE) : 0;
}

export async function buildPartyOrgAnalytics(
  db: Db,
  countryId: CountryId,
  partyId: string
): Promise<PartyAnalyticsOrgSection> {
  const statePartyOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, partyId })
    .toArray();

  if (statePartyOrgs.length === 0) {
    return {
      totalStateOrgs: 0,
      positiveGrowthCount: 0,
      negativeGrowthCount: 0,
      growthLeaders: [],
      positiveGrowth: [],
      negativeGrowth: [],
    };
  }

  const stateIds = statePartyOrgs.map((org) => org.stateId);
  const [states, budgets] = await Promise.all([
    db
      .collection<State>("states")
      .find({ _id: { $in: stateIds }, countryId })
      .toArray(),
    db
      .collection<PartyBudget>("partyBudget")
      .find({ countryId, partyId, scope: "state", stateId: { $in: stateIds } })
      .toArray(),
  ]);

  const stateById = new Map(states.map((state) => [state._id, state]));
  const budgetByStateId = new Map(
    budgets
      .filter((budget): budget is PartyBudget & StateOrgBudgetSummary => "stateId" in budget)
      .map((budget) => [budget.stateId, budget])
  );

  const metrics = statePartyOrgs.map((statePartyOrg) => {
    const state = stateById.get(statePartyOrg.stateId) ?? null;
    const growthPerTurn = calculateGrowthPerTurn(
      statePartyOrg,
      budgetByStateId.get(statePartyOrg.stateId) ?? null
    );
    return buildStateMetric(
      statePartyOrg,
      state?.name ?? statePartyOrg.stateId,
      countryId,
      growthPerTurn
    );
  });

  return {
    totalStateOrgs: metrics.length,
    positiveGrowthCount: metrics.filter((metric) => metric.growthPerTurn > 0).length,
    negativeGrowthCount: metrics.filter((metric) => metric.growthPerTurn < 0).length,
    growthLeaders: [...metrics]
      .sort((a, b) => b.growthPerTurn - a.growthPerTurn || b.organization - a.organization)
      .slice(0, 5),
    positiveGrowth: metrics
      .filter((metric) => metric.growthPerTurn > 0)
      .sort((a, b) => b.growthPerTurn - a.growthPerTurn || b.organization - a.organization)
      .slice(0, 5)
      .map(buildGrowthMetric),
    negativeGrowth: metrics
      .filter((metric) => metric.growthPerTurn < 0)
      .sort((a, b) => a.growthPerTurn - b.growthPerTurn || a.organization - b.organization)
      .slice(0, 5)
      .map(buildGrowthMetric),
  };
}

export async function buildStatePartyOrgAnalytics(
  db: Db,
  countryId: CountryId,
  partyId: string,
  stateId: string
): Promise<PartyAnalyticsStateMetric | null> {
  const statePartyOrg = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .findOne({ countryId, partyId, stateId });
  if (!statePartyOrg) return null;

  const [state, budget] = await Promise.all([
    db.collection<State>("states").findOne({ _id: stateId, countryId }),
    db.collection<PartyBudget>("partyBudget").findOne({
      countryId,
      partyId,
      scope: "state",
      stateId,
    }),
  ]);

  const growthPerTurn = calculateGrowthPerTurn(statePartyOrg, budget);

  return buildStateMetric(statePartyOrg, state?.name ?? stateId, countryId, growthPerTurn);
}
