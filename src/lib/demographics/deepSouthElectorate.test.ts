/**
 * Deep South electorate regressions (#1165) — through the shared substrate.
 *
 * The granular cell mean dilutes the authored race:black position three-to-one
 * against class buckets that encode the white caste order, so pre-fix every
 * Black-conditioned cell in the 1953 Deep South sat socially right of centre,
 * Brown dragged Black cells further right through shared buckets, and pruning
 * erased the small educated/minority cells that remained. These tests pin the
 * corrected behavior at the substrate level:
 *
 *  - 1953 baseline: the Black-conditioned electorate is socially left in
 *    Alabama and across the Deep South, while the white electorate stays right.
 *  - Through Brown: the full Southern-realignment overlay moves white cells
 *    right and leaves Black cells left.
 *  - Controls: non-Southern states resolve no conditioned offsets and keep
 *    their Black-conditioned electorates left (black voters were never
 *    misdescribed there).
 *  - Pruning: every present bucket keeps at least half its marginal mass, so
 *    small-but-real counterweights (Black college/graduate cells, small
 *    minority buckets) survive the floor.
 */
import { describe, it, expect, beforeEach } from "vitest";
import "@/lib/seeds/stateDemographics";
import type { DemographicCategory, Layer1PositionOverlay, StateDemographics } from "@/lib/db/types";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import {
  buildGranularElectorateSubstrate,
  clearGranularElectorateCache,
  ELECTORATE_REPRESENTATION_FRACTION,
  type GranularElectorateUnit,
} from "./granularElectorate";
import { deriveGranularCellsGeneric, type GenericGranularDimInput } from "./granularCells";
import { SOUTHERN_REALIGNMENT_CHECKPOINT } from "./eraCheckpoints";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { getConditionedOffsetsForYear } from "@/lib/seeds/eraPositionsForYear";
import { conditionedOffsetsAtAnchor } from "@/lib/seeds/demographicCategories";

const DEEP_SOUTH = ["AL", "MS", "SC", "LA", "GA", "AR"] as const;

const EMPTY_CATEGORIES: DemographicCategory[] = [];
const EMPTY_ENRICHED: EnrichedCandidate[] = [];

function stubDemographics(stateId: string): StateDemographics {
  return { _id: stateId, countryId: "US", groups: {} } as unknown as StateDemographics;
}

function substrate(
  stateId: string,
  overlay?: Layer1PositionOverlay
): { units: GranularElectorateUnit[] } {
  const demo = stubDemographics(stateId);
  const out = buildGranularElectorateSubstrate({
    countryId: "US",
    stateId,
    preset: "1953-default",
    turnoutDoc: null,
    statePopulation: 1_000_000,
    demographics: demo,
    categories: EMPTY_CATEGORIES,
    enriched: EMPTY_ENRICHED,
    demographicDefaults: overlay ? { ...demo, layer1PositionOverrides: overlay } : null,
  });
  expect(out, `${stateId} substrate`).not.toBeNull();
  return out!;
}

/** Bucket-conditioned mean lean, share- and turnout-weighted. */
function conditioned(
  units: GranularElectorateUnit[],
  bucketKey: string
): { share: number; econ: number; soc: number; tEcon: number; tSoc: number } {
  let w = 0;
  let e = 0;
  let s = 0;
  let tw = 0;
  let te = 0;
  let ts = 0;
  for (const u of units) {
    const bw = u.bucketWeights[bucketKey] ?? 0;
    if (bw <= 0) continue;
    w += u.share * bw;
    e += u.share * bw * u.economicLean;
    s += u.share * bw * u.socialLean;
    tw += u.share * bw * u.turnout;
    te += u.share * bw * u.turnout * u.economicLean;
    ts += u.share * bw * u.turnout * u.socialLean;
  }
  expect(w, `${bucketKey} conditioned weight`).toBeGreaterThan(0);
  return { share: w, econ: e / w, soc: s / w, tEcon: te / tw, tSoc: ts / tw };
}

/** Full Southern-realignment (Brown) totals as a durable position overlay. */
function brownOverlay(): Layer1PositionOverlay {
  const out: Layer1PositionOverlay = {};
  for (const t of SOUTHERN_REALIGNMENT_CHECKPOINT.targets) {
    if (!t.dim || !t.bucket) continue;
    if (t.axis !== "economicLean" && t.axis !== "socialLean") continue;
    out[t.dim] ??= {};
    out[t.dim][t.bucket] ??= { economicLean: 0, socialLean: 0 };
    if (t.axis === "economicLean") out[t.dim][t.bucket]!.economicLean! += t.totalShift;
    else out[t.dim][t.bucket]!.socialLean! += t.totalShift;
  }
  return out;
}

beforeEach(() => {
  clearGranularElectorateCache();
});

describe("1953 Deep South baseline through the shared substrate", () => {
  it("keeps Alabama's Black-conditioned electorate socially left", () => {
    const { units } = substrate("AL");
    const black = conditioned(units, "race:black");
    expect(black.soc).toBeLessThan(-0.4);
    expect(black.tSoc).toBeLessThan(-0.4);
    // A meaningful counterweight, not a rounding artifact: nearly a third of
    // the state conditions Black.
    expect(black.share).toBeGreaterThan(0.25);
  });

  it("keeps every Deep South state's Black-conditioned electorate socially left", () => {
    for (const stateId of DEEP_SOUTH) {
      const { units } = substrate(stateId);
      const black = conditioned(units, "race:black");
      expect(black.soc, `${stateId} black share-weighted social`).toBeLessThan(-0.15);
      expect(black.tSoc, `${stateId} black turnout-weighted social`).toBeLessThan(-0.15);
      expect(black.econ, `${stateId} black economic`).toBeLessThan(0);
    }
  });

  it("keeps the white Southern electorate socially right at baseline", () => {
    for (const stateId of DEEP_SOUTH) {
      const { units } = substrate(stateId);
      const white = conditioned(units, "race:white");
      expect(white.soc, `${stateId} white share-weighted social`).toBeGreaterThan(1.5);
      expect(white.tSoc, `${stateId} white turnout-weighted social`).toBeGreaterThan(1.5);
    }
  });
});

describe("through the Brown realignment", () => {
  it("moves white cells right while Black cells stay left", () => {
    const overlay = brownOverlay();
    for (const stateId of DEEP_SOUTH) {
      const before = substrate(stateId);
      clearGranularElectorateCache();
      const after = substrate(stateId, overlay);
      const whiteBefore = conditioned(before.units, "race:white");
      const whiteAfter = conditioned(after.units, "race:white");
      const blackBefore = conditioned(before.units, "race:black");
      const blackAfter = conditioned(after.units, "race:black");
      // The intended defection: white moves right on both axes. The social
      // threshold is direction-plus-level rather than a fixed delta because
      // Mississippi starts highest (3.15) and saturates against the lean
      // clamp, so its measured move (+0.26) is smaller than Alabama's (+0.71)
      // while landing the furthest right (3.41). What must hold everywhere is
      // rightward direction, a firmly-right landing, and a widening
      // white-minus-Black polarization gap.
      expect(whiteAfter.soc, `${stateId} white social moves right`).toBeGreaterThan(
        whiteBefore.soc + 0.1
      );
      expect(whiteAfter.soc, `${stateId} white social lands firmly right`).toBeGreaterThan(2.5);
      expect(whiteAfter.econ, `${stateId} white econ moves right`).toBeGreaterThan(
        whiteBefore.econ + 0.5
      );
      expect(whiteAfter.soc - blackAfter.soc, `${stateId} polarization gap widens`).toBeGreaterThan(
        whiteBefore.soc - blackBefore.soc
      );
      // The preserved counterweight: Black stays meaningfully left, not merely
      // less right than white.
      expect(blackAfter.soc, `${stateId} black social stays left`).toBeLessThan(-0.3);
      expect(blackAfter.tSoc, `${stateId} black turnout-weighted social stays left`).toBeLessThan(
        -0.3
      );
      expect(blackAfter.econ, `${stateId} black econ stays left`).toBeLessThan(0);
    }
  });
});

describe("non-Southern controls", () => {
  it("author no conditioned offsets outside the 1953 Deep South", () => {
    for (const stateId of ["NY", "CA", "MA", "VT", "OH", "TX", "VA", "NC"]) {
      expect(conditionedOffsetsAtAnchor("1953", stateId), stateId).toEqual([]);
      expect(getConditionedOffsetsForYear(1953, stateId), stateId).toEqual([]);
    }
    for (const stateId of [...DEEP_SOUTH]) {
      expect(conditionedOffsetsAtAnchor("1953", stateId).length, stateId).toBeGreaterThan(0);
    }
    // Later anchors author none anywhere: the 1979+ tables already place
    // Black cells left, so the correction fades rather than carries forward.
    for (const stateId of [...DEEP_SOUTH]) {
      expect(conditionedOffsetsAtAnchor("1979", stateId), stateId).toEqual([]);
      expect(getConditionedOffsetsForYear(1979, stateId), `${stateId}@1979`).toEqual([]);
    }
  });

  it("keeps Northern Black-conditioned electorates socially left", () => {
    for (const stateId of ["NY", "CA", "MA"]) {
      const { units } = substrate(stateId);
      const black = conditioned(units, "race:black");
      expect(black.soc, `${stateId} black social`).toBeLessThan(0);
      expect(black.tSoc, `${stateId} black turnout-weighted social`).toBeLessThan(0);
    }
  });

  it("leaves non-Southern white electorates on the base table", () => {
    // Spot-check the mechanism's locality: a race:white-conditioned white
    // cell in a control state reads base positions only. Vermont 1953 is
    // economically right (Yankee Republicanism, +1.67) but socially left
    // (-0.62) in the authored base tables — the earlier draft asserted the
    // wrong axis. Pinning both axes proves the offsets touch neither, which
    // a single sign check could not catch. (Vermont's 1953 census has no
    // Black marginal at all, so there is no Black-conditioned control here;
    // NY/CA/MA cover that above.)
    const { units } = substrate("VT");
    const white = conditioned(units, "race:white");
    expect(white.econ).toBeGreaterThan(1);
    expect(white.soc).toBeLessThan(0);
  });
});

describe("pruning representation invariants", () => {
  it("keeps at least half of every present bucket's marginal mass", () => {
    // The guarantee as authored: for each bucket with a nonzero census
    // marginal, the units' share-weighted bucket mass must hold at least
    // ELECTORATE_REPRESENTATION_FRACTION of that marginal. In particular the
    // educated bloc the floor used to delete wholesale in 1953 Southern
    // states (every college/graduate cell sat below the 0.25% floor).
    for (const stateId of ["AL", "MS", "CA", "NY"]) {
      const { units } = substrate(stateId);
      const marginals = stateCensusData1953[stateId] as unknown as Record<
        string,
        Record<string, number>
      >;
      const mass: Record<string, number> = {};
      for (const u of units) {
        for (const [k, wgt] of Object.entries(u.bucketWeights)) {
          mass[k] = (mass[k] ?? 0) + u.share * wgt;
        }
      }
      for (const [dim, buckets] of Object.entries(marginals)) {
        if (dim === "ideology" || dim === "positions") continue;
        for (const [bucket, pct] of Object.entries(buckets)) {
          const marginal = (pct as number) / 100;
          if (marginal <= 0) continue;
          expect(
            mass[`${dim}:${bucket}`] ?? 0,
            `${stateId} ${dim}:${bucket} keeps half its ${marginal} marginal`
          ).toBeGreaterThanOrEqual(ELECTORATE_REPRESENTATION_FRACTION * marginal - 1e-6);
        }
      }
    }
  });

  it("keeps the Black counterweight's share through pruning in every Deep South state", () => {
    // The reprieve is per-bucket BY DESIGN: it guarantees each present bucket
    // half its marginal, satisfied through whichever cells are largest — for
    // the college marginal those are white-college cells, so a Black-college
    // JOINT probe is not implied by the mechanism and is not asserted here.
    // What the counterweight needs is the Black-conditioned electorate itself
    // surviving at scale: at least the guaranteed half of its census marginal
    // in every Deep South state (Alabama holds 0.315 of a 0.32 marginal).
    for (const stateId of DEEP_SOUTH) {
      const { units } = substrate(stateId);
      const marginals = stateCensusData1953[stateId] as unknown as Record<
        string,
        Record<string, number>
      >;
      const censusBlack = (marginals.race.black as number) / 100;
      expect(censusBlack, `${stateId} census has a Black marginal`).toBeGreaterThan(0);
      const black = conditioned(units, "race:black");
      expect(
        black.share,
        `${stateId} black share keeps half its ${censusBlack} marginal`
      ).toBeGreaterThanOrEqual(ELECTORATE_REPRESENTATION_FRACTION * censusBlack - 1e-6);
    }
  });

  it("still prunes genuinely absent groups fully", () => {
    // Alabama's 1953 census has no Asian marginal (0%): nothing to represent,
    // so no Asian cell may survive to add noise.
    const { units } = substrate("AL");
    let asianMass = 0;
    for (const u of units) asianMass += u.share * (u.bucketWeights["race:asian"] ?? 0);
    expect(asianMass).toBe(0);
  });

  it("is deterministic: two derivations agree exactly", () => {
    const first = substrate("AL");
    clearGranularElectorateCache();
    const second = substrate("AL");
    expect(second.units).toEqual(first.units);
  });
});

describe("conditioned-offsets mechanism (unit level)", () => {
  function toyDims(): GenericGranularDimInput[] {
    return [
      {
        name: "race",
        marginals: { white: 66, black: 34 },
        positions: {
          white: { economicLean: 0, socialLean: 4 },
          black: { economicLean: 0, socialLean: -2 },
        },
        turnoutRates: { white: 60, black: 50 },
      },
      {
        name: "class",
        marginals: { low: 50, high: 50 },
        positions: {
          low: { economicLean: 0, socialLean: 3 },
          high: { economicLean: 0, socialLean: 1 },
        },
        turnoutRates: { low: 50, high: 60 },
      },
    ];
  }

  it("moves only matching cells, leaving the rest byte-identical", () => {
    const base = deriveGranularCellsGeneric({ dims: toyDims(), opts: { pruneFloor: 0 } });
    const shifted = deriveGranularCellsGeneric({
      dims: toyDims(),
      opts: {
        pruneFloor: 0,
        conditionedOffsets: [
          {
            givenDim: "race",
            givenBucket: "black",
            dim: "class",
            bucket: "low",
            economicLean: 0,
            socialLean: -3,
          },
        ],
      },
    });
    expect(shifted.length).toBe(base.length);
    for (const b of base) {
      const s = shifted.find((c) => c.id === b.id)!;
      expect(s, b.id).toBeDefined();
      if (b.buckets.race === "black" && b.buckets.class === "low") {
        // (-2 + (3 - 3)) / 2 = -1, was (-2 + 3) / 2 = 0.5.
        expect(s.socialLean).toBeCloseTo(-1, 10);
      } else {
        expect(s.socialLean).toBe(b.socialLean);
        expect(s.economicLean).toBe(b.economicLean);
      }
    }
  });

  it("reprieves a present bucket below the floor while erasing a zero-marginal one", () => {
    const dims = [
      {
        name: "race",
        marginals: { white: 99, black: 1, ghost: 0 },
        positions: {
          white: { economicLean: 0, socialLean: 0 },
          black: { economicLean: 0, socialLean: 0 },
          ghost: { economicLean: 0, socialLean: 0 },
        },
        turnoutRates: { white: 60, black: 60, ghost: 60 },
      },
    ];
    const floored = deriveGranularCellsGeneric({
      dims,
      opts: { pruneFloor: 0.02 },
    });
    expect(floored.some((c) => c.buckets.race === "black")).toBe(false);
    const guarded = deriveGranularCellsGeneric({
      dims,
      opts: { pruneFloor: 0.02, preserveBucketRepresentation: 0.5 },
    });
    // 1% marginal needs 0.5% kept: the single black cell (1%) is reprieved.
    expect(guarded.some((c) => c.buckets.race === "black")).toBe(true);
    // Zero marginal stays erased.
    expect(guarded.some((c) => c.buckets.race === "ghost")).toBe(false);
    const total = guarded.reduce((sum, c) => sum + c.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});
