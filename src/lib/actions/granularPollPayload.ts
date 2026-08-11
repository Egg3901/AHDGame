import type { DemographicPosition } from "@/lib/seeds/demographicCategories";
import { DEMOGRAPHIC_TURNOUT_RATES, getEraPositions } from "@/lib/seeds/demographicCategories";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import type { EraId } from "@/lib/seeds/presetSelector";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import {
  getCountrySubstrateForYear,
  getUsSubstrateForYear,
  getUsTurnoutRatesForYear,
} from "@/lib/seeds/eraSubstrateForYear";
import { eraIdForYear } from "@/lib/seeds/eraInterpolation";
import { calcAppeal } from "@/lib/utils/demographicAppeal";
import {
  deriveGranularCells,
  deriveGranularCellsGeneric,
  GRANULAR_DIMENSIONS,
  COUNTRY_PRIORS,
  type GenericGranularCell,
  type GenericGranularDimInput,
  type GranularDim,
} from "@/lib/demographics/granularCells";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/** Per-cell candidate vote shares for the granular electorate view. */
export interface GranularCandidateShare {
  /** Player's projected share of this cell (0–1). */
  you: number;
  /** Opponents' projected shares of this cell. */
  opponents: Array<{ id: string; name: string; share: number }>;
  /** Undecided voters in this cell (0–1). */
  undecided: number;
}

/** Additive granular payload attached to poll results when the flag is on. */
export interface GranularPollPayload {
  /** Ordered partition dimension names (e.g. ["race","age","education","wealth"]). */
  dims: string[];
  /** Display labels for each dimension so the client needs no country knowledge. */
  dimLabels: Record<string, string>;
  /** Cross-product Layer-1 electorate cells, pruned and sorted by share. */
  cells: GenericGranularCell[];
  /** Per-cell candidate vote shares keyed by cell id. */
  candidateShares: Record<string, GranularCandidateShare>;
}

/** Candidate inputs needed to compute per-cell appeal. */
export interface GranularPollCandidate {
  candidateId: string;
  name: string;
  economicPosition: number;
  socialPosition: number;
  favorability?: number;
  politicalInfluence: number;
}

/** Player + opponent inputs for {@link buildGranularPollPayload}. */
export interface GranularPollBuilderInput {
  /** State Layer-1 census config. */
  config: Layer1Config;
  /** Active reset-preset era; selects era-wide demographic positions. */
  era?: EraId;
  /** Region/state id — applies per-state era position overrides when known. */
  stateId?: string;
  /** Player candidate data. */
  character: {
    economicPosition: number;
    socialPosition: number;
    favorability?: number;
    politicalInfluence: number;
  };
  /** Opponent candidates (empty when no active race). */
  opponents: GranularPollCandidate[];
  /** Baseline Layer-1 turnout rates by dimension. */
  turnoutRates: Record<GranularDim, Record<string, number>>;
  /**
   * Fully-resolved position table to use instead of deriving one from
   * `era`/`stateId`. Set by the year-driven path, which has already blended
   * the bracketing anchors, carried regional character forward and subtracted
   * checkpoint-owned movement — none of which `resolveGranularPositions` can
   * reproduce from a discrete era id.
   */
  positionsOverride?: Record<GranularDim, Record<string, DemographicPosition>>;
}

/** State-aware inputs for {@link buildGranularPollPayloadForState}. */
export interface GranularPollForStateInput {
  /** Country code (e.g. "US", "DE"). */
  countryId: string;
  /** Region/state id (e.g. "CT", "BW"). */
  stateId: string;
  /** Active reset preset; used to resolve the era and the US census bundle. */
  preset?: string;
  /** Optional era override. */
  era?: EraId;
  /**
   * Live in-game year. When set, the census bundle, positions and turnout
   * rates all resolve from the year — the same substrate the vote engines
   * use — instead of from the seed preset.
   */
  year?: number | null;
  /** World `gameState.startingYear` — gates era-checkpoint de-duplication. */
  startingYear?: number | null;
  /** Player candidate data. */
  character: {
    economicPosition: number;
    socialPosition: number;
    favorability?: number;
    politicalInfluence: number;
  };
  /** Opponent candidates (empty when no active race). */
  opponents: GranularPollCandidate[];
}

/**
 * Merge era-wide demographic positions with any state-specific overrides
 * authored in the Layer-1 census config. Mirrors the merge used by
 * deriveGroupLeanFromLayer1 and the granularCells test seam.
 */
export function resolveGranularPositions(
  config: Layer1Config,
  era: EraId,
  stateId?: string
): Record<GranularDim, Record<string, DemographicPosition>> {
  // stateId applies per-state era overrides (STATE_POSITION_OVERRIDES, e.g. the
  // 1953 Solid-South/Plains white leans) before the state census positions merge.
  const merged: Record<GranularDim, Record<string, DemographicPosition>> = JSON.parse(
    JSON.stringify(getEraPositions(era, stateId))
  );
  if (config.positions) {
    for (const dim of GRANULAR_DIMENSIONS) {
      const overrides = config.positions[dim];
      if (!overrides) continue;
      for (const [key, pos] of Object.entries(overrides)) {
        merged[dim][key] = pos;
      }
    }
  }
  return merged;
}

/** Convert a raw dimension key into a readable label. First word capitalized,
 *  underscores become spaces; remaining words stay lowercase. */
function prettifyDimName(key: string): string {
  return key
    .split("_")
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()
    )
    .join(" ");
}

/** Shared candidate-share projection for any set of granular cells. */
function computeCandidateShares(
  cells: GenericGranularCell[],
  character: GranularPollBuilderInput["character"],
  opponents: GranularPollCandidate[]
): Record<string, GranularCandidateShare> {
  const candidateShares: Record<string, GranularCandidateShare> = {};

  for (const cell of cells) {
    const youAppeal = calcAppeal(
      cell.economicLean,
      cell.socialLean,
      character.economicPosition,
      character.socialPosition,
      character.politicalInfluence ?? 0,
      false
    );

    const opponentEntries = opponents.map((opp) => ({
      id: opp.candidateId,
      name: opp.name,
      appeal: calcAppeal(
        cell.economicLean,
        cell.socialLean,
        opp.economicPosition,
        opp.socialPosition,
        opp.politicalInfluence ?? 0,
        false
      ),
    }));

    const bestOpponentAppeal = opponentEntries.length
      ? Math.max(...opponentEntries.map((o) => o.appeal))
      : 0;
    const undecided = Math.max(0.04, 0.16 - Math.abs(youAppeal - bestOpponentAppeal) / 220);

    const totalAppeal = youAppeal + opponentEntries.reduce((s, o) => s + o.appeal, 0);
    const decidedPool = 1 - undecided;

    candidateShares[cell.id] = {
      you: totalAppeal > 0 ? (youAppeal / totalAppeal) * decidedPool : decidedPool,
      opponents: opponentEntries.map((o) => ({
        id: o.id,
        name: o.name,
        share: totalAppeal > 0 ? (o.appeal / totalAppeal) * decidedPool : 0,
      })),
      undecided,
    };
  }

  return candidateShares;
}

/**
 * Build the additive granular poll payload from a raw US Layer-1 config.
 *
 * Derives Layer-1 cross-product cells and projects candidate shares per cell
 * using the same appeal formula the existing poll uses (positional alignment
 * + political influence, no favorability). The payload is pure and has no
 * side effects so it can be unit tested without a database.
 */
export function buildGranularPollPayload({
  config,
  era = "2019",
  stateId,
  character,
  opponents,
  turnoutRates,
  positionsOverride,
}: GranularPollBuilderInput): GranularPollPayload {
  const positions = positionsOverride ?? resolveGranularPositions(config, era, stateId);
  const usCells = deriveGranularCells(config, positions, turnoutRates);

  const cells: GenericGranularCell[] = usCells.map((cell) => ({
    id: cell.id,
    buckets: {
      race: cell.race,
      age: cell.age,
      education: cell.education,
      wealth: cell.wealth,
    },
    share: cell.share,
    economicLean: cell.economicLean,
    socialLean: cell.socialLean,
    turnout: cell.turnout,
  }));

  const dims = [...GRANULAR_DIMENSIONS];
  const dimLabels = Object.fromEntries(dims.map((d) => [d, prettifyDimName(d)]));
  const candidateShares = computeCandidateShares(cells, character, opponents);

  return { dims, dimLabels, cells, candidateShares };
}

/**
 * Build the additive granular poll payload from a country/state id.
 *
 * Supports both the US Layer-1 census path (resolved via preset) and any
 * country with a CountryLayer1Model. The returned cells are dimension-agnostic
 * so the panel can render any model without country-specific knowledge.
 */
export function buildGranularPollPayloadForState({
  countryId,
  stateId,
  preset,
  era,
  year,
  startingYear,
  character,
  opponents,
}: GranularPollForStateInput): GranularPollPayload {
  const resolvedEra =
    era ?? (year != null ? eraIdForYear(year) : eraForPreset(preset ?? DEFAULT_SEED_PRESET));

  // eslint-disable-next-line local/no-country-literals -- US census path is separate from international models
  if (countryId === "US") {
    // Year-driven when the era clock is live. A poll that reported a different
    // electorate from the one the vote engines are counting would be worse
    // than no poll — it would be a lie the player can act on.
    const yearSubstrate =
      year != null
        ? getUsSubstrateForYear(stateId, year, { startingYear: startingYear ?? null })
        : null;
    const censusConfig = yearSubstrate?.config ?? getRegionCensusData("US", stateId, preset);
    if (!censusConfig || !("race" in censusConfig)) {
      throw new Error(`US census config not found for state ${stateId}`);
    }
    return buildGranularPollPayload({
      config: censusConfig as Layer1Config,
      era: resolvedEra,
      stateId,
      character,
      opponents,
      turnoutRates:
        year != null
          ? getUsTurnoutRatesForYear(stateId, year, { startingYear: startingYear ?? null })
          : DEMOGRAPHIC_TURNOUT_RATES,
      positionsOverride: yearSubstrate?.positions,
    });
  }

  const yearModel = year != null ? getCountrySubstrateForYear(countryId, stateId, year) : null;
  const model = yearModel ? null : getCountryLayer1Model(countryId, resolvedEra);
  if (!yearModel && !model) {
    throw new Error(`No Layer-1 model for country ${countryId}`);
  }

  const regionCensus = yearModel?.marginals ?? model?.census[stateId];
  if (!regionCensus) {
    throw new Error(`No census data for ${countryId}.${stateId}`);
  }

  const dimNames = yearModel?.dims ?? model?.dims ?? [];
  const modelPositions = yearModel?.positions ?? model?.positions ?? {};
  const modelTurnout = yearModel?.turnoutRates ?? model?.turnoutRates ?? {};
  const dims: GenericGranularDimInput[] = dimNames.map((name) => ({
    name,
    marginals: regionCensus[name],
    positions: modelPositions[name],
    turnoutRates: modelTurnout[name],
  }));

  const cells = deriveGranularCellsGeneric({
    dims,
    priors: COUNTRY_PRIORS[countryId] ?? {},
    opts: { pruneFloor: 0.001 },
  });

  const dimLabels = Object.fromEntries(dimNames.map((d) => [d, prettifyDimName(d)]));
  const candidateShares = computeCandidateShares(cells, character, opponents);

  return { dims: [...dimNames], dimLabels, cells, candidateShares };
}
