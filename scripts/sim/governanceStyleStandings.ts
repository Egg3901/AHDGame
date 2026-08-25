/**
 * Governance Style calibration and 1953 seed standings.
 *
 * Uses the same population-weighted national aggregation as the live query.
 * Run with: npx tsx scripts/sim/governanceStyleStandings.ts
 */
import type { State } from "@/lib/db/types";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { getCountryConfig, getCountryDisplayName, type CountryId } from "@/lib/constants/countries";
import { getPresetSeats } from "@/lib/constants/historicalSeats";
import { assessDemocraticCompetition } from "@/lib/governanceStyle/competition";
import { scoreGovernanceStyle, supportsGovernanceStyle } from "@/lib/governanceStyle/score";
import { aggregateNationalPoliticalMetrics } from "@/lib/politicalMetrics/aggregate";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import { NATIONAL_BASELINES_1953 } from "@/lib/politicalMetrics/seeds/nationalBaselines1953";
import { NON_PLAYABLE_BOARDS } from "@/lib/politicalMetrics/seeds/nonPlayableBoards";
import { REGIONAL_MODIFIERS_1953 } from "@/lib/politicalMetrics/seeds/regionalModifiers1953";
import {
  POLITICAL_METRIC_COUNTRY_IDS,
  type PoliticalMetricId,
  type PoliticalMetricsCountryId,
} from "@/lib/politicalMetrics/types";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";

const PRESET = "1953-default";

type RegionLoader = () => Promise<State[]>;

const REGION_LOADERS: Partial<Record<CountryId, RegionLoader>> = {
  US: () => import("@/lib/seeds/reference/states1953").then((m) => m.states1953),
  UK: () => import("@/lib/seeds/uk/ukRegions1953").then((m) => m.ukRegions1953),
  DE: () => import("@/lib/seeds/de/deRegions1953").then((m) => m.deRegions1953),
  JP: () => import("@/lib/seeds/jp/jpRegions1953").then((m) => m.jpRegions1953),
  IE: () => import("@/lib/seeds/ie/ieRegions1953").then((m) => m.ieRegions1953),
  BR: () => import("@/lib/seeds/br/brRegions1953").then((m) => m.brRegions1953),
  CN: () => import("@/lib/seeds/cn/cnRegions1953").then((m) => m.cnRegions1953),
  NG: () => import("@/lib/seeds/ng/ngRegions1953").then((m) => m.ngRegions1953),
  HU: () => import("@/lib/seeds/hu/huRegions1953").then((m) => m.huRegions1953),
  PL: () => import("@/lib/seeds/pl/plRegions1953").then((m) => m.plRegions1953),
  RO: () => import("@/lib/seeds/ro/roRegions1953").then((m) => m.roRegions1953),
  YU: () => import("@/lib/seeds/yu/yuRegions1953").then((m) => m.yuRegions1953),
  BG: () => import("@/lib/seeds/bg/bgRegions1953").then((m) => m.bgRegions1953),
  BLR: () => import("@/lib/seeds/blr/blrRegions1953").then((m) => m.blrRegions1953),
  UKR: () => import("@/lib/seeds/ua/uaRegions1953").then((m) => m.uaRegions1953),
  CS: () => import("@/lib/seeds/cs/csRegions1953").then((m) => m.csRegions1953),
  BAL: () => import("@/lib/seeds/bal/balRegions1953").then((m) => m.balRegions1953),
  RU: () => import("@/lib/seeds/ru/ruRegions1953").then((m) => m.ruRegions1953),
  FR: () => import("@/lib/seeds/fr/frRegions1953").then((m) => m.frRegions1953),
  IT: () => import("@/lib/seeds/it/itRegions1953").then((m) => m.itRegions1953),
  ES: () => import("@/lib/seeds/es/esRegions1953").then((m) => m.esRegions1953),
  SE: () => import("@/lib/seeds/se/seRegions1953").then((m) => m.seRegions1953),
  TR: () => import("@/lib/seeds/tr/trRegions1953").then((m) => m.trRegions1953),
  GR: () => import("@/lib/seeds/gr/grRegions1953").then((m) => m.grRegions1953),
  AT: () => import("@/lib/seeds/at/atRegions1953").then((m) => m.atRegions1953),
  FI: () => import("@/lib/seeds/fi/fiRegions1953").then((m) => m.fiRegions1953),
  DD: () => import("@/lib/seeds/dd/ddRegions1953").then((m) => m.ddRegions1953),
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

function playableBoard(countryId: PoliticalMetricsCountryId, regionId: string) {
  const values = {} as Record<PoliticalMetricId, number>;
  const modifiers = REGIONAL_MODIFIERS_1953[countryId][regionId] ?? {};
  for (const family of POLITICAL_METRIC_FAMILIES) {
    values[family.id] = clamp(
      NATIONAL_BASELINES_1953[countryId][family.id].value + (modifiers[family.id] ?? 0)
    );
  }
  return values;
}

async function boardDocs(countryId: CountryId, regions: State[]) {
  const playable = (POLITICAL_METRIC_COUNTRY_IDS as readonly string[]).includes(countryId);
  const emitted = NON_PLAYABLE_BOARDS[PRESET]?.[countryId];
  const docs: Pick<PoliticalMetricsDoc, "_id" | "values">[] = [];

  for (const region of regions) {
    const values = playable
      ? playableBoard(countryId as PoliticalMetricsCountryId, String(region._id))
      : emitted?.[String(region._id)];
    if (values) docs.push({ _id: String(region._id), values });
  }
  return docs;
}

function seedCompetition(countryId: CountryId) {
  const config = getCountryConfig(countryId, PRESET);
  const legislature = config.legislature;
  const seats = getPresetSeats(PRESET);
  const chamberKeys = [legislature.lowerChamber.key];
  if (legislature.bicameral && legislature.upperChamber) {
    chamberKeys.push(legislature.upperChamber.key);
  }
  const chamberTallies = new Map(chamberKeys.map((key) => [key, {} as Record<string, number>]));
  for (const seat of seats) {
    const seatsByParty = chamberTallies.get(seat.officeType);
    if (!seatsByParty) continue;
    seatsByParty[seat.party] = (seatsByParty[seat.party] ?? 0) + (seat.seatsHeld ?? 1);
  }
  const executive =
    config.governmentType === "presidential"
      ? seats.find((seat) => seat.officeType === "president" && seat.state === countryId)
      : undefined;
  return assessDemocraticCompetition({
    chambersByParty: [...chamberTallies.values()],
    executivePartyId: executive?.party,
    consecutiveExecutiveTerms: executive ? 1 : 0,
  });
}

async function main() {
  const standings: Array<{
    countryId: CountryId;
    country: string;
    direction: number;
    directionLabel: string;
    health: number;
    healthLabel: string;
    hasCompetitionData: boolean;
    dominantSeatShare: number;
    executiveStatus: string;
    competitionPenalty: number;
  }> = [];
  const excluded: string[] = [];
  const playerCountries = getWorldEntityPresetManifest(PRESET).entries.flatMap((entry) =>
    entry.legacyAccess === "player" && entry.countryId ? [entry.countryId] : []
  );

  for (const countryId of playerCountries) {
    const loader = REGION_LOADERS[countryId];
    if (!loader) continue;
    const config = getCountryConfig(countryId, PRESET);
    const country = getCountryDisplayName(countryId, PRESET);
    if (!supportsGovernanceStyle(config.governmentType)) {
      excluded.push(country);
      continue;
    }

    const regions = await loader();
    const docs = await boardDocs(countryId, regions);
    if (docs.length === 0) continue;
    const populations = new Map(regions.map((region) => [String(region._id), region.population]));
    const national = aggregateNationalPoliticalMetrics(docs, populations);
    const competition = seedCompetition(countryId);
    const score = scoreGovernanceStyle(national, competition);
    standings.push({
      countryId,
      country,
      direction: score.leftRight.value,
      directionLabel: score.leftRight.label,
      health: score.democraticHealth.value,
      healthLabel: score.democraticHealth.label,
      hasCompetitionData: competition.dominantPartyId !== null,
      dominantSeatShare: competition.dominantSeatShare,
      executiveStatus:
        competition.executiveAlignedWithLegislature === null
          ? "Parliamentary"
          : competition.executiveAlignedWithLegislature
            ? "Aligned"
            : "Divided",
      competitionPenalty: competition.penalty,
    });
  }

  standings.sort((a, b) => b.health - a.health || a.direction - b.direction);

  console.log(`# Governance Style standings: ${PRESET}`);
  console.log("");
  console.log(
    "| Player nation | Left to Right | Direction | Failed State to Healthy Democracy | Health | Largest party across elected chambers | Executive status | Health penalty |"
  );
  console.log("|---|---:|---|---:|---|---:|---|---:|");
  for (const row of standings) {
    const dominantShare = row.hasCompetitionData
      ? `${row.dominantSeatShare.toFixed(1)}%`
      : "Not seeded";
    console.log(
      `| ${row.country} (${row.countryId}) | ${row.direction.toFixed(1)} | ${row.directionLabel} | ${row.health.toFixed(1)} | ${row.healthLabel} | ${dominantShare} | ${row.executiveStatus} | -${row.competitionPenalty.toFixed(1)} |`
    );
  }
  console.log("");
  console.log(
    `Player-run liberal democracies: ${standings.length}. Player-run one-party states excluded for their separate mechanic: ${excluded.join(", ")}.`
  );

  const directionRange = standings.length
    ? Math.max(...standings.map((row) => row.direction)) -
      Math.min(...standings.map((row) => row.direction))
    : 0;
  const healthRange = standings.length
    ? Math.max(...standings.map((row) => row.health)) -
      Math.min(...standings.map((row) => row.health))
    : 0;
  console.log(
    `Calibration: direction range ${directionRange.toFixed(1)} points; health range ${healthRange.toFixed(1)} points.`
  );
}

void main();
