import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";
import {
  ALLOWED_FEATURE_FLAGS,
  METRIC_DEFINITION_VERSION,
} from "@/lib/clientStatistics";

const ELECTION_STATUS_FIELDS = {
  upcoming: "electionCountUpcoming",
  active: "electionCountActive",
  completed: "electionCountCompleted",
  resolved: "electionCountResolved",
  cancelled: "electionCountCancelled",
} as const;

const AUTOCRACY_TYPES = new Set(["onePartyState"]);

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function setMetric(
  metrics: Record<string, number>,
  key: string,
  value: number | null,
  integer = false
): void {
  if (value === null) return;
  const next = integer ? Math.round(value) : value;
  if (!Number.isFinite(next)) return;
  metrics[key] = next;
}

function weightedMean(rows: Array<{ weight: number; value: number }>): number | null {
  let total = 0;
  let weight = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.value) || !Number.isFinite(row.weight) || row.weight <= 0) continue;
    total += row.value * row.weight;
    weight += row.weight;
  }
  return weight > 0 ? total / weight : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface LocalStatisticsPayload {
  setup: {
    era: string | undefined;
    mode: string;
    difficulty: string;
    autonomy: string;
    featureFlags: Record<string, boolean>;
  };
  metrics: Record<string, number>;
  turn: number | undefined;
  metricDefinitionVersion: typeof METRIC_DEFINITION_VERSION;
}

/** Local aggregates only. No names, identifiers, or save documents leave this helper. */
export async function collectLocalStatistics(db: Db): Promise<LocalStatisticsPayload | null> {
  const [
    state,
    partyCount,
    corporationCount,
    nppCount,
    employment,
    officeCounts,
    vital,
    regions,
    macro,
    countryStates,
    budgets,
    approvals,
    elections,
    formationCount,
    seats,
    leaders,
  ] = await Promise.all([
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          preset: 1,
          currentTurn: 1,
          singleplayerConfig: 1,
          singleplayerTurnMetrics: 1,
          nppAutonomyLevel: 1,
          ...Object.fromEntries(ALLOWED_FEATURE_FLAGS.map((key) => [key, 1])),
        },
      }
    ),
    db.collection("politicalParties").countDocuments(),
    db.collection("corporations").countDocuments(),
    db.collection("npps").countDocuments(),
    db
      .collection("corporateSectors")
      .aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: "$workers" } } }])
      .toArray(),
    db
      .collection("electedOfficials")
      .aggregate<{ total: number; npp: number }>([
        { $match: { $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true } }] } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            npp: { $sum: { $cond: [{ $eq: ["$isNPP", true] }, 1, 0] } },
          },
        },
      ])
      .toArray(),
    db.collection<EconomicVitalSigns>("economicVitalSigns").findOne(
      {},
      {
        sort: { turn: -1 },
        projection: { "goods.pooledFillRate.value": 1, "firms.lossMakingShare.value": 1 },
      }
    ),
    db
      .collection("states")
      .find({}, { projection: { _id: 1, gdp: 1, population: 1 } })
      .toArray(),
    db
      .collection("macroMetrics")
      .find(
        {},
        {
          projection: {
            _id: 1,
            "economic.gdpGrowth.value": 1,
            "economic.unemploymentRate.value": 1,
            "population.populationGrowth.value": 1,
          },
        }
      )
      .toArray(),
    db
      .collection("countryState")
      .find({}, { projection: { _id: 1, governmentType: 1, rulingPartyId: 1 } })
      .toArray(),
    db
      .collection("federalBudget")
      .find({}, { projection: { "economicFactors.inflationRate": 1 } })
      .toArray(),
    db
      .collection("governmentApprovals")
      .find({}, { projection: { approvalRating: 1 } })
      .toArray(),
    db
      .collection("elections")
      .aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      .toArray(),
    db.collection("governmentFormations").countDocuments(),
    db
      .collection("parliamentSeatsHistory")
      .find({}, { projection: { turn: 1, seats: 1 } })
      .sort({ turn: -1 })
      .limit(2000)
      .toArray(),
    db
      .collection("countryLeaderStates")
      .find({}, { projection: { popularLegitimacy: 1 } })
      .toArray(),
  ]);
  if (!state) return null;

  const stateValues = state as unknown as Record<string, unknown>;
  const storedFlags = state.singleplayerConfig?.featureFlags ?? {};
  const featureFlags = Object.fromEntries(
    ALLOWED_FEATURE_FLAGS.map((key) => {
      const stateValue = stateValues[key];
      return [key, typeof stateValue === "boolean" ? stateValue : storedFlags[key] === true];
    })
  );
  const metrics: Record<string, number> = {
    partyCount,
    corporationCount,
    nppCount,
    totalCorporationEmployment: Math.round(employment[0]?.total ?? 0),
  };
  if (state.singleplayerTurnMetrics) {
    metrics.lastTurnDurationMs = state.singleplayerTurnMetrics.durationMs;
    metrics.lastTurnWarningCount = state.singleplayerTurnMetrics.warningCount;
  }
  const offices = officeCounts[0];
  if (offices && offices.total > 0)
    metrics.nppOfficeSharePercent = (offices.npp / offices.total) * 100;
  for (const [key, value] of [
    ["marketFillRatePercent", vital?.goods?.pooledFillRate?.value],
    ["corporateLossMakingSharePercent", vital?.firms?.lossMakingShare?.value],
  ] as const) {
    if (typeof value === "number" && Number.isFinite(value)) metrics[key] = value * 100;
  }

  let gdpMillions = 0;
  let totalPopulation = 0;
  const regionWeight = new Map<string, number>();
  for (const region of regions) {
    const gdp = finite(region.gdp);
    const population = finite(region.population);
    if (gdp !== null) gdpMillions += gdp;
    if (population !== null && population > 0) {
      totalPopulation += population;
      regionWeight.set(String(region._id), population);
    }
  }
  const gdpTotal = Math.min(1e15, Math.max(0, gdpMillions * 1_000_000));
  if (gdpMillions > 0) setMetric(metrics, "gdpTotal", gdpTotal);
  if (totalPopulation > 0) {
    setMetric(metrics, "totalPopulation", Math.min(2e10, totalPopulation), true);
    setMetric(metrics, "gdpPerCapita", Math.min(1e9, gdpTotal / totalPopulation));
  }

  const growthRows: Array<{ weight: number; value: number }> = [];
  const unemploymentRows: Array<{ weight: number; value: number }> = [];
  const populationGrowthRows: Array<{ weight: number; value: number }> = [];
  for (const row of macro) {
    const weight = regionWeight.get(String(row._id)) ?? 1;
    const gdpGrowth = finite(
      (row as { economic?: { gdpGrowth?: { value?: unknown } } }).economic?.gdpGrowth?.value
    );
    const unemployment = finite(
      (row as { economic?: { unemploymentRate?: { value?: unknown } } }).economic?.unemploymentRate
        ?.value
    );
    const popGrowth = finite(
      (row as { population?: { populationGrowth?: { value?: unknown } } }).population
        ?.populationGrowth?.value
    );
    if (gdpGrowth !== null) growthRows.push({ weight, value: gdpGrowth });
    if (unemployment !== null) unemploymentRows.push({ weight, value: unemployment });
    if (popGrowth !== null) populationGrowthRows.push({ weight, value: popGrowth });
  }
  setMetric(metrics, "gdpGrowthPercent", weightedMean(growthRows));
  setMetric(metrics, "unemploymentRatePercent", weightedMean(unemploymentRows));
  setMetric(metrics, "populationGrowthPercent", weightedMean(populationGrowthRows));
  setMetric(
    metrics,
    "inflationRatePercent",
    median(
      budgets
        .map((row) =>
          finite(
            (row as { economicFactors?: { inflationRate?: unknown } }).economicFactors?.inflationRate
          )
        )
        .filter((value): value is number => value !== null)
    )
  );

  let democracy = 0;
  let autocracy = 0;
  let withExecutive = 0;
  for (const row of countryStates) {
    const governmentType = String(
      (row as { governmentType?: unknown }).governmentType ?? ""
    );
    if (AUTOCRACY_TYPES.has(governmentType)) autocracy += 1;
    else if (governmentType) democracy += 1;
    if ((row as { rulingPartyId?: unknown }).rulingPartyId != null) withExecutive += 1;
  }
  if (democracy + autocracy > 0) {
    setMetric(metrics, "democracyCountryCount", democracy, true);
    setMetric(metrics, "autocracyCountryCount", autocracy, true);
    setMetric(
      metrics,
      "executiveControlSharePercent",
      (withExecutive / (democracy + autocracy)) * 100
    );
  }

  const approvalValues = approvals
    .map((row) => finite((row as { approvalRating?: unknown }).approvalRating))
    .filter((value): value is number => value !== null);
  setMetric(metrics, "governmentApprovalPercent", weightedMean(
    approvalValues.map((value) => ({ weight: 1, value }))
  ));

  const legitimacy = leaders
    .map((row) => finite((row as { popularLegitimacy?: unknown }).popularLegitimacy))
    .filter((value): value is number => value !== null);
  if (legitimacy.length > 0) {
    setMetric(metrics, "averageStability", legitimacy.reduce((a, b) => a + b, 0) / legitimacy.length);
    setMetric(metrics, "minStability", Math.min(...legitimacy));
    setMetric(metrics, "maxStability", Math.max(...legitimacy));
  }

  for (const row of elections) {
    const field = ELECTION_STATUS_FIELDS[row._id as keyof typeof ELECTION_STATUS_FIELDS];
    if (field) setMetric(metrics, field, row.count, true);
  }
  setMetric(metrics, "governmentFormationCount", formationCount, true);

  const latestSeatTurn = seats.reduce(
    (max, row) => Math.max(max, finite((row as { turn?: unknown }).turn) ?? 0),
    0
  );
  if (latestSeatTurn > 0) {
    const totalSeats = seats
      .filter((row) => finite((row as { turn?: unknown }).turn) === latestSeatTurn)
      .reduce((sum, row) => sum + (finite((row as { seats?: unknown }).seats) ?? 0), 0);
    setMetric(metrics, "legislativeSeatTotal", totalSeats, true);
  }

  return {
    setup: {
      era: state.preset?.split("-")[0],
      mode: state.singleplayerConfig?.mode ?? "normal",
      difficulty: state.singleplayerConfig?.difficulty ?? "normal",
      autonomy: state.nppAutonomyLevel ?? "off",
      featureFlags,
    },
    metrics,
    turn: state.currentTurn,
    metricDefinitionVersion: METRIC_DEFINITION_VERSION,
  };
}
