/** State map metrics expose measured economic values and policy scores with their own units. */
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import { US_METRIC_NAMES } from "@/lib/politicalMetrics/names";
import type { MapMetricDefinition, MapMetricsResponse } from "./metricTypes";

const stocks: MapMetricDefinition[] = [
  {
    id: "gdp",
    name: "State GDP",
    category: "economy",
    description: "Annual state gross domestic product in US dollars.",
    prefix: "$",
    suffix: "",
    decimals: 0,
    source: "state",
  },
  {
    id: "gdpPerCapita",
    name: "GDP per capita",
    category: "economy",
    description: "State GDP divided by its population, in US dollars per resident.",
    prefix: "$",
    suffix: "",
    decimals: 0,
    source: "state",
  },
  {
    id: "capitalStock",
    name: "Capital stock",
    category: "economy",
    description: "Productive capital in the state, in US dollars.",
    prefix: "$",
    suffix: "",
    decimals: 0,
    source: "state",
  },
  {
    id: "outputGap",
    name: "Output gap",
    category: "economy",
    description:
      "Actual output relative to potential output. Negative values indicate spare capacity.",
    prefix: "",
    suffix: "%",
    decimals: 1,
    source: "state",
  },
  ...[
    ["population", "Population"],
    ["workingAgePopulation", "Working-age population"],
    ["votingEligiblePopulation", "Voting-eligible population"],
    ["militaryServicePopulation", "Population in military service"],
  ].map(([id, name]): MapMetricDefinition => ({
    id,
    name,
    category: "population",
    description: name + " in the state.",
    prefix: "",
    suffix: "",
    decimals: 0,
    source: "state",
  })),
];
const definitions: MapMetricDefinition[] = [
  ...stocks,
  ...metricCategories
    .filter((c) => ["economic", "population", "governance"].includes(c.id))
    .flatMap((c) =>
      c.metrics.map((m): MapMetricDefinition => ({
        id: `macro.${c.id}.${m.id}`,
        name: m.name,
        category: c.id === "economic" ? "economy" : c.id,
        description: m.detailedDescription ?? m.description,
        prefix: m.formatPrefix ?? "",
        suffix: m.formatSuffix ?? "",
        decimals: m.decimals ?? 1,
        source: "macro",
      }))
    ),
  ...POLITICAL_METRIC_FAMILIES.map((f): MapMetricDefinition => ({
    id: `score.${f.id}`,
    name: US_METRIC_NAMES[f.id],
    category: f.categoryId,
    description: f.description,
    prefix: "",
    suffix: " / 100",
    decimals: 1,
    source: "score",
  })),
];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function buildMapMetrics(
  states: Pick<
    State,
    | "_id"
    | "gdp"
    | "population"
    | "capitalStock"
    | "outputGap"
    | "workingAgePopulation"
    | "votingEligiblePopulation"
    | "militaryServicePopulation"
  >[],
  macros: MacroMetricsDoc[],
  boards: Pick<PoliticalMetricsDoc, "_id" | "values">[]
): MapMetricsResponse {
  const macroById = new Map(macros.map((m) => [m._id, m]));
  const boardById = new Map(boards.map((b) => [b._id, b]));
  const result: MapMetricsResponse = { definitions: [], states: {} };
  const available = new Set<string>();
  for (const state of states) {
    const row: Record<string, number> = {};
    for (const def of definitions) {
      let value: unknown;
      if (def.source === "state") {
        // State monetary stocks are stored in millions of host currency.
        if (def.id === "gdpPerCapita")
          value =
            finite(state.gdp) && state.population > 0
              ? (state.gdp * 1_000_000) / state.population
              : undefined;
        else {
          value = state[def.id as keyof typeof state];
          if ((def.id === "gdp" || def.id === "capitalStock") && finite(value)) value *= 1_000_000;
        }
      } else if (def.source === "macro") {
        const [, category, metric] = def.id.split(".");
        const macro = macroById.get(state._id);
        const fields = macro?.[category as "economic" | "population" | "governance"];
        value = (fields as Record<string, { value?: number }> | undefined)?.[metric]?.value;
      } else
        value = boardById.get(state._id)?.values[
          def.id.slice(6) as keyof PoliticalMetricsDoc["values"]
        ];
      if (finite(value)) {
        row[def.id] = value;
        available.add(def.id);
      }
    }
    result.states[state._id] = row;
  }
  result.definitions = definitions.filter((d) => available.has(d.id));
  return result;
}

export async function loadMapMetrics(db: Db, stateIds: string[]): Promise<MapMetricsResponse> {
  const filter = { countryId: "US", _id: { $in: stateIds } };
  const [states, macros, boards] = await Promise.all([
    db
      .collection<State>("states")
      .find(filter, {
        projection: {
          _id: 1,
          gdp: 1,
          population: 1,
          capitalStock: 1,
          outputGap: 1,
          workingAgePopulation: 1,
          votingEligiblePopulation: 1,
          militaryServicePopulation: 1,
        },
      })
      .toArray(),
    db
      .collection<MacroMetricsDoc>("macroMetrics")
      .find(filter, { projection: { _id: 1, economic: 1, population: 1, governance: 1 } })
      .toArray(),
    db
      .collection<PoliticalMetricsDoc>("politicalMetrics")
      .find(filter, { projection: { _id: 1, values: 1 } })
      .toArray(),
  ]);
  return buildMapMetrics(states, macros, boards);
}
