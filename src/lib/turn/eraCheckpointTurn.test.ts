import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { StateDemographics } from "@/lib/db/types/demographics";
import type { DocketCase } from "@/lib/db/types/scotus";
import type { LegislationType } from "@/lib/db/types/legislation";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { processEraCheckpointsTurn } from "./eraCheckpointTurn";
import {
  SOUTHERN_REALIGNMENT_CHECKPOINT,
  NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT,
  REYNOLDS_REAPPORTIONMENT_CHECKPOINT,
} from "@/lib/demographics/eraCheckpoints";
// Side-effect import — populates stateCensusData with all US states so the
// Layer-1 derivation the granular-path assertions below rely on can find
// real census configs (mirrors granularElectorate.test.ts).
import "@/lib/seeds/stateDemographics";
import {
  buildGranularElectorateSubstrate,
  clearGranularElectorateCache,
} from "@/lib/demographics/granularElectorate";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";

/**
 * Minimal stateful fake `Db`: real MongoDB filter semantics are overkill here
 * — this only needs to support the exact query/update shapes
 * `processEraCheckpointsTurn` and `getActivePoliciesForState` issue (equality
 * + `$in`, and `$set` updates via bulkWrite), while actually PERSISTING
 * writes across calls so a multi-turn simulation observes cumulative drift
 * through the real function under test (not a hand-rolled loop).
 */
function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === "object" && "$in" in (value as Record<string, unknown>)) {
      const arr = (value as { $in: unknown[] }).$in;
      return arr.includes(doc[key]);
    }
    return doc[key] === value;
  });
}

function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

interface BulkOp {
  updateOne: { filter: { _id: unknown }; update: { $set: Record<string, unknown> } };
}

function createFakeCollection<T extends { _id: unknown }>(seed: T[]) {
  const store = new Map<string, T>(seed.map((d) => [String(d._id), d]));
  return {
    find: (filter: Record<string, unknown> = {}) => ({
      toArray: async () =>
        [...store.values()].filter((d) => matchesFilter(d as Record<string, unknown>, filter)),
    }),
    findOne: async (filter: Record<string, unknown> = {}) =>
      [...store.values()].find((d) => matchesFilter(d as Record<string, unknown>, filter)) ?? null,
    bulkWrite: async (ops: BulkOp[]) => {
      for (const op of ops) {
        const id = String(op.updateOne.filter._id);
        const doc = store.get(id);
        if (!doc) continue;
        for (const [path, value] of Object.entries(op.updateOne.update.$set)) {
          setDeep(doc as unknown as Record<string, unknown>, path, value);
        }
      }
      return { modifiedCount: ops.length, matchedCount: ops.length };
    },
    // exposed for assertions
    __store: store,
  };
}

function createFakeDb(fixtures: {
  docketCases: DocketCase[];
  legislationTypes: LegislationType[];
  statePolicies: StatePolicy[];
  stateDemographics: StateDemographics[];
  demographicDefaults: StateDemographics[];
}) {
  const collections = {
    // The turn processor gates on the world's starting year (checkpoints are
    // 1953-timeline history) — every test here runs a 1953 world.
    gameState: createFakeCollection([{ _id: "current", startingYear: 1953 }]),
    docketCases: createFakeCollection(fixtures.docketCases),
    legislationTypes: createFakeCollection(fixtures.legislationTypes),
    statePolicies: createFakeCollection(
      fixtures.statePolicies.map((p) => ({ ...p, _id: p._id ?? new ObjectId() }))
    ),
    stateDemographics: createFakeCollection(fixtures.stateDemographics),
    demographicDefaults: createFakeCollection(fixtures.demographicDefaults),
  };
  const db = {
    collection: (name: string) => (collections as Record<string, unknown>)[name],
  } as unknown as Db;
  return { db, collections };
}

function makeGroup(economicLean: number, socialLean: number) {
  return { population: 20, economicLean, socialLean, turnout: 60 };
}

function makeStateDemographics(stateId: string): StateDemographics {
  return {
    _id: stateId,
    countryId: "US",
    categoryWeights: { voterGroups: 100 },
    groups: {
      rural_traditionalists: makeGroup(-2.0, -1.5),
      evangelicals: makeGroup(-1.0, 1.5),
      union_trades: makeGroup(-4.0, -1.0),
    },
    lastUpdated: new Date("2026-01-01"),
  };
}

const DECIDED_AFFIRMED_CASE: DocketCase = {
  _id: new ObjectId(),
  countryId: "US",
  preset: "1953-default",
  caseKey: "brown-v-board-1954",
  title: "Brown v. Board of Education",
  axis: "social",
  historicalMajorityDirection: -1,
  decisionYear: 1954,
  status: "decided",
  outcome: "affirmed",
  decidedAtTurn: 49,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const DECIDED_DIVERGED_CASE: DocketCase = {
  ...DECIDED_AFFIRMED_CASE,
  outcome: "diverged",
};

/** `demographicDefaults.layer1PositionOverrides[dim][bucket][axis]`, or 0. */
function overlay(
  doc: StateDemographics,
  dim: string,
  bucket: string,
  axis: "economicLean" | "socialLean"
): number {
  return doc.layer1PositionOverrides?.[dim]?.[bucket]?.[axis] ?? 0;
}

describe("processEraCheckpointsTurn", () => {
  it("does nothing before the checkpoint's start turn", async () => {
    const { db, collections } = createFakeDb({
      docketCases: [DECIDED_AFFIRMED_CASE],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: [makeStateDemographics("AL")],
      demographicDefaults: [makeStateDemographics("AL")],
    });

    const result = await processEraCheckpointsTurn(db, 10, "US");
    expect(result).toEqual({ checkpointsActive: 0, statesUpdated: 0 });
    expect(
      collections.demographicDefaults.__store.get("AL")!.layer1PositionOverrides
    ).toBeUndefined();
  });

  it("does nothing in a non-1953 world, even at a turn where the fallback would fire", async () => {
    const { db, collections } = createFakeDb({
      docketCases: [],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: [makeStateDemographics("AL")],
      demographicDefaults: [makeStateDemographics("AL")],
    });
    (
      collections as { gameState: { __store: Map<string, { startingYear?: number }> } }
    ).gameState.__store.get("current")!.startingYear = 2019;

    const result = await processEraCheckpointsTurn(db, 5000, "US");
    expect(result).toEqual({ checkpointsActive: 0, statesUpdated: 0 });
    expect(
      collections.demographicDefaults.__store.get("AL")!.layer1PositionOverrides
    ).toBeUndefined();
  });

  it("moves the targeted Deep South buckets rightward (historically correct direction) across the simulated span when uncontested", async () => {
    const { db, collections } = createFakeDb({
      docketCases: [DECIDED_AFFIRMED_CASE],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: [makeStateDemographics("AL"), makeStateDemographics("VT")],
      demographicDefaults: [makeStateDemographics("AL"), makeStateDemographics("VT")],
    });

    const startTurn = DECIDED_AFFIRMED_CASE.decidedAtTurn!;
    const endTurn = startTurn + SOUTHERN_REALIGNMENT_CHECKPOINT.durationTurns;

    // The registry now holds several OTHER checkpoints too (Engel, Reynolds,
    // Griswold, Miranda, the national CRA/VRA statute — all triggered/paced
    // on their own docket cases or fallback turns, none seeded in this
    // fixture's docket), so the turn-by-turn RESULT COUNTS are no longer a
    // reliable proxy for "the Southern checkpoint specifically stopped
    // moving" — those other checkpoints' fallback windows can overlap this
    // span. Track AL's `age:mature` overlay directly instead: the Southern
    // realignment is the only registered checkpoint that targets it.
    let valueAtWindowClosePlusOne: number | undefined;
    for (let turn = startTurn; turn <= endTurn + 2; turn++) {
      await processEraCheckpointsTurn(db, turn, "US");
      if (turn === endTurn + 1) {
        valueAtWindowClosePlusOne = overlay(
          collections.demographicDefaults.__store.get("AL")!,
          "age",
          "mature",
          "economicLean"
        );
      }
    }

    const al = collections.demographicDefaults.__store.get("AL")!;

    // White, no-college and mature Southern voters moved Republican
    // (positive) on both axes...
    expect(overlay(al, "race", "white", "economicLean")).toBeGreaterThan(0);
    expect(overlay(al, "race", "white", "socialLean")).toBeGreaterThan(0);
    expect(overlay(al, "education", "no_college", "economicLean")).toBeGreaterThan(0);
    expect(overlay(al, "age", "mature", "economicLean")).toBeGreaterThan(0);
    // ...while low-income Southern voters consolidated further Democratic
    // (negative), matching the historical split. (race:black also carries the
    // national Civil Rights Act checkpoint's own pull, so wealth:low is the
    // clean read of the Southern checkpoint's negative half.)
    expect(overlay(al, "wealth", "low", "economicLean")).toBeLessThan(0);

    // The Southern checkpoint's own authored totals landed in full on the
    // buckets it targets (age:mature is exclusive to this checkpoint).
    const matureEcon = SOUTHERN_REALIGNMENT_CHECKPOINT.targets.find(
      (t) => t.dim === "age" && t.bucket === "mature" && t.axis === "economicLean"
    )!;
    expect(overlay(al, "age", "mature", "economicLean")).toBeCloseTo(matureEcon.totalShift, 6);

    // A state outside the Southern checkpoint's target list is untouched ON
    // THIS BUCKET (other national checkpoints target different buckets).
    const vt = collections.demographicDefaults.__store.get("VT")!;
    expect(overlay(vt, "age", "mature", "economicLean")).toBe(0);

    // After the Southern checkpoint's own window closes, ITS contribution to
    // AL's age:mature overlay stops changing (scoped to this
    // checkpoint/bucket, not a global "no checkpoint anywhere is active"
    // claim, since the registry now holds several others).
    expect(overlay(al, "age", "mature", "economicLean")).toBeCloseTo(valueAtWindowClosePlusOne!, 6);
  });

  it("is beatable: a sustained opposing state law holds the targeted state against the tide", async () => {
    const opposingLegType: LegislationType = {
      _id: "test-civil-rights-enforcement",
      name: "Test Civil Rights Enforcement",
      description: "test fixture",
      policyDomain: "governance",
      subCategory: "test",
      demographicEffects: [
        // Strong, sustained leftward pull on the same group+axis the
        // checkpoint targets — a player campaigning hard against the tide.
        { groupId: "rural_traditionalists", target: "economicLean", direction: -1, magnitude: 3 },
        { groupId: "rural_traditionalists", target: "socialLean", direction: -1, magnitude: 3 },
      ],
    } as unknown as LegislationType;

    const opposingPolicy: StatePolicy = {
      stateId: "AL",
      legislationTypeId: "test-civil-rights-enforcement",
      policyOptionId: "opt-max",
      policyOptionIndex: 6,
      enactedAt: new Date("2026-01-01"),
      enactedTurn: 49,
      economic: 3,
      social: 3,
      effectDirection: 1,
    };

    const { db, collections } = createFakeDb({
      docketCases: [DECIDED_AFFIRMED_CASE],
      legislationTypes: [opposingLegType],
      statePolicies: [opposingPolicy],
      stateDemographics: [makeStateDemographics("AL")],
      demographicDefaults: [makeStateDemographics("AL")],
    });

    const startTurn = DECIDED_AFFIRMED_CASE.decidedAtTurn!;
    const endTurn = startTurn + SOUTHERN_REALIGNMENT_CHECKPOINT.durationTurns;

    for (let turn = startTurn; turn <= endTurn; turn++) {
      await processEraCheckpointsTurn(db, turn, "US");
    }

    const al = collections.demographicDefaults.__store.get("AL")!;
    // The sustained countervailing law didn't just slow the drift — with a
    // per-turn shift several times the checkpoint's own rate, it held the
    // targeted buckets at (or past) their starting position (0, no
    // pre-existing overlay) instead of the full authored shift they would
    // otherwise have reached. The law is authored against the
    // `rural_traditionalists` archetype and still nets against bucket targets,
    // because the turn processor projects every active legislative archetype
    // shift through `archetypeValuesToBuckets` before netting.
    expect(overlay(al, "education", "no_college", "economicLean")).toBeLessThanOrEqual(0);
    expect(overlay(al, "age", "mature", "economicLean")).toBeLessThanOrEqual(0);
  });

  it("delays the checkpoint to the fallback turn when the trigger case diverges from history", async () => {
    const { db, collections } = createFakeDb({
      docketCases: [DECIDED_DIVERGED_CASE],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: [makeStateDemographics("AL")],
      demographicDefaults: [makeStateDemographics("AL")],
    });

    // Historical decision turn (49) has passed, but the case diverged, so the
    // checkpoint should NOT have started yet.
    const result = await processEraCheckpointsTurn(db, 49, "US");
    expect(result).toEqual({ checkpointsActive: 0, statesUpdated: 0 });
    expect(
      collections.demographicDefaults.__store.get("AL")!.layer1PositionOverrides
    ).toBeUndefined();

    // It DOES start at the fallback turn. (`>=1`, not `===1`: the registry
    // holds several other checkpoints whose OWN fallback windows can overlap
    // this turn too — the point here is only that the Southern checkpoint
    // itself is no longer dormant, which `statesUpdated` for AL confirms.)
    const fallbackTurn = SOUTHERN_REALIGNMENT_CHECKPOINT.fallbackStartTurn;
    const atFallback = await processEraCheckpointsTurn(db, fallbackTurn, "US");
    expect(atFallback.checkpointsActive).toBeGreaterThanOrEqual(1);
    expect(atFallback.statesUpdated).toBeGreaterThan(0);
  });

  it("holds the fallback window shut until the CALENDAR turn reaches it (#1208)", async () => {
    // A founding phase shifts the raw counter ahead of the calendar, and every
    // `fallbackStartTurn` is authored as `yearToTurn(...)` — a calendar turn.
    // Compared against the raw turn the whole 1950s-60s checkpoint timeline
    // pulled demographics a full game year early.
    const { db, collections } = createFakeDb({
      docketCases: [DECIDED_DIVERGED_CASE],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: [makeStateDemographics("AL")],
      demographicDefaults: [makeStateDemographics("AL")],
    });
    (
      collections as { gameState: { __store: Map<string, Record<string, unknown>> } }
    ).gameState.__store.get("current")!.preIterationTurns = 48;

    // `>` rather than an absolute count: the registry holds other checkpoints
    // whose own windows already cover this calendar turn. The point is that the
    // Southern window is still shut at the raw turn and opens 48 turns later,
    // exactly the founding-phase offset.
    const fallbackTurn = SOUTHERN_REALIGNMENT_CHECKPOINT.fallbackStartTurn;
    const early = await processEraCheckpointsTurn(db, fallbackTurn, "US");
    const onTime = await processEraCheckpointsTurn(db, fallbackTurn + 48, "US");
    expect(onTime.checkpointsActive).toBeGreaterThan(early.checkpointsActive);
  });
});

/**
 * Acceptance: the checkpoint's pull must reach an outcome computed through
 * the GRANULAR vote path (`granularElectorateEnabled`), not merely move a
 * stored archetype field the granular substrate never reads (the previous
 * implementation's fatal flaw — see `eraCheckpoints.ts`'s module doc).
 *
 * These tests run the real `processEraCheckpointsTurn` against Alabama for
 * the full checkpoint window, then feed the resulting `demographicDefaults`
 * doc's `layer1PositionOverrides` into the real `buildGranularElectorateSubstrate`
 * against Alabama's real 1953 Layer-1 census/position data, and finally
 * through the real `distributeVotesByGroupLevelAllocation` vote engine.
 *
 * Isolation: `demographics` (the "live" archetype doc) is passed as the SAME
 * object as `demographicDefaults` in both the before/after substrates, so the
 * pre-existing legislation lean-DELTA fold (live − defaults, see
 * `granularElectorate.ts`) is pinned at zero on both sides — any measured
 * difference is attributable ONLY to the new `layer1PositionOverrides`
 * channel a checkpoint accumulates.
 */
describe("processEraCheckpointsTurn reaches the granular vote path", () => {
  function makeGranularCandidate(
    id: string,
    party: string,
    ep: number,
    sp: number
  ): EnrichedCandidate {
    return {
      candidateId: id,
      characterId: `${id}_char`,
      characterName: id,
      party,
      isNPP: false,
      charEP: ep,
      charSP: sp,
      favorability: 55,
      politicalInfluence: 60,
      nationalInfluence: 50,
    };
  }

  function weightedMean(units: { share: number; economicLean: number; socialLean: number }[]) {
    let w = 0;
    let e = 0;
    let s = 0;
    for (const u of units) {
      w += u.share;
      e += u.share * u.economicLean;
      s += u.share * u.socialLean;
    }
    return { economicLean: e / w, socialLean: s / w };
  }

  function runShares(substrate: NonNullable<ReturnType<typeof buildGranularElectorateSubstrate>>) {
    return distributeVotesByGroupLevelAllocation(
      substrate.enriched,
      substrate.totalPool,
      substrate.totalPool,
      1_000_000,
      substrate.demographics,
      substrate.categories,
      new Map(),
      {
        isGeneralElection: true,
        countryId: "US",
        liveTurnouts: substrate.liveTurnouts,
      }
    ).sharesPct;
  }

  it("an uncontested realignment shifts AL's granular-cell electorate rightward and raises a matching candidate's vote share", async () => {
    const alPristine = makeStateDemographics("AL");
    const { db, collections } = createFakeDb({
      docketCases: [DECIDED_AFFIRMED_CASE],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: [makeStateDemographics("AL")],
      demographicDefaults: [makeStateDemographics("AL")],
    });

    const startTurn = DECIDED_AFFIRMED_CASE.decidedAtTurn!;
    const endTurn = startTurn + SOUTHERN_REALIGNMENT_CHECKPOINT.durationTurns;
    for (let turn = startTurn; turn <= endTurn; turn++) {
      await processEraCheckpointsTurn(db, turn, "US");
    }

    const alDefaultsAfter = collections.demographicDefaults.__store.get("AL")!;
    expect(alDefaultsAfter.layer1PositionOverrides).toBeDefined();

    const enriched = [
      makeGranularCandidate("dem", "democrat", -2, -2),
      makeGranularCandidate("rep", "republican", 2, 2),
    ];

    clearGranularElectorateCache();
    const before = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alPristine,
      categories: [],
      enriched,
      demographicDefaults: alPristine, // no overlay — pre-realignment baseline
    })!;
    clearGranularElectorateCache();
    const after = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alDefaultsAfter,
      categories: [],
      enriched,
      demographicDefaults: alDefaultsAfter, // live === defaults: lean-delta fold pinned at 0
    })!;
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();

    const beforeMean = weightedMean(before.units);
    const afterMean = weightedMean(after.units);
    // The Deep South's GRANULAR electorate genuinely moved Republican — this
    // is the substrate that actually counts ballots under the flag, not the
    // archetype field the previous implementation moved in isolation.
    expect(afterMean.economicLean).toBeGreaterThan(beforeMean.economicLean);
    expect(afterMean.socialLean).toBeGreaterThan(beforeMean.socialLean);

    const beforeShares = runShares(before);
    const afterShares = runShares(after);
    // Same two candidates, same positions, same census — the ONLY thing that
    // changed is the checkpoint's accumulated overlay. The Republican
    // candidate's granular-path vote share rises and the Democrat's falls.
    expect(afterShares["rep"]).toBeGreaterThan(beforeShares["rep"]);
    expect(afterShares["dem"]).toBeLessThan(beforeShares["dem"]);
  });

  it("is beatable through the granular path too: sustained counter-legislation holds the granular electorate", async () => {
    const alPristine = makeStateDemographics("AL");
    const opposingLegType: LegislationType = {
      _id: "test-civil-rights-enforcement",
      name: "Test Civil Rights Enforcement",
      description: "test fixture",
      policyDomain: "governance",
      subCategory: "test",
      demographicEffects: [
        { groupId: "rural_traditionalists", target: "economicLean", direction: -1, magnitude: 3 },
        { groupId: "rural_traditionalists", target: "socialLean", direction: -1, magnitude: 3 },
        { groupId: "evangelicals", target: "economicLean", direction: -1, magnitude: 3 },
        { groupId: "evangelicals", target: "socialLean", direction: -1, magnitude: 3 },
      ],
    } as unknown as LegislationType;
    const opposingPolicy: StatePolicy = {
      stateId: "AL",
      legislationTypeId: "test-civil-rights-enforcement",
      policyOptionId: "opt-max",
      policyOptionIndex: 6,
      enactedAt: new Date("2026-01-01"),
      enactedTurn: 49,
      economic: 3,
      social: 3,
      effectDirection: 1,
    };

    const { db, collections } = createFakeDb({
      docketCases: [DECIDED_AFFIRMED_CASE],
      legislationTypes: [opposingLegType],
      statePolicies: [opposingPolicy],
      stateDemographics: [makeStateDemographics("AL")],
      demographicDefaults: [makeStateDemographics("AL")],
    });

    const startTurn = DECIDED_AFFIRMED_CASE.decidedAtTurn!;
    const endTurn = startTurn + SOUTHERN_REALIGNMENT_CHECKPOINT.durationTurns;
    for (let turn = startTurn; turn <= endTurn; turn++) {
      await processEraCheckpointsTurn(db, turn, "US");
    }

    const alDefaultsAfter = collections.demographicDefaults.__store.get("AL")!;

    clearGranularElectorateCache();
    const before = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alPristine,
      categories: [],
      enriched: [],
      demographicDefaults: alPristine,
    })!;
    clearGranularElectorateCache();
    const after = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alDefaultsAfter,
      categories: [],
      enriched: [],
      demographicDefaults: alDefaultsAfter,
    })!;

    const beforeMean = weightedMean(before.units);
    const afterMean = weightedMean(after.units);
    // A sustained, strong-enough countervailing law held the GRANULAR
    // electorate at (or past) its starting position instead of letting it
    // drift right — the same "beatable, not rails" guarantee proven at the
    // archetype level above, now proven on the substrate that counts votes.
    expect(afterMean.economicLean).toBeLessThanOrEqual(beforeMean.economicLean);
  });
});

/**
 * BUCKET-kind targets (`{ dim, bucket }`): direct Layer-1 census-bucket
 * targeting for precise demographic-by-geography effects ("southern whites",
 * "midwestern lower class") with no archetype-proxy fuzziness. A bucket
 * target writes ONLY `layer1PositionOverrides` (there is no archetype to
 * carry it on the legacy live doc), so these tests read the overlay directly
 * (and feed it through the real granular substrate), rather than asserting on
 * `stateDemographics.groups`.
 */
describe("processEraCheckpointsTurn — BUCKET-kind targets (direct Layer-1 targeting)", () => {
  const REYNOLDS_CASE: DocketCase = {
    _id: new ObjectId(),
    countryId: "US",
    preset: "1953-default",
    caseKey: "reynolds-v-sims-1964",
    title: "Reynolds v. Sims",
    axis: "social",
    historicalMajorityDirection: -1,
    decisionYear: 1964,
    status: "decided",
    outcome: "affirmed",
    decidedAtTurn: 500,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };

  function overlayValue(
    doc: StateDemographics,
    dim: string,
    bucket: string,
    axis: "economicLean" | "socialLean"
  ): number {
    return doc.layer1PositionOverrides?.[dim]?.[bucket]?.[axis] ?? 0;
  }

  it("REGIONAL: moves the targeted bucket only in the targeted (Midwest) states, leaving a control state outside the region untouched", async () => {
    // OH is in MIDWEST_STATES (Reynolds' target region); TX is not — and is
    // not part of any other checkpoint's target list either, so it is a
    // clean control.
    const { db, collections } = createFakeDb({
      docketCases: [REYNOLDS_CASE],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: [makeStateDemographics("OH"), makeStateDemographics("TX")],
      demographicDefaults: [makeStateDemographics("OH"), makeStateDemographics("TX")],
    });

    const startTurn = REYNOLDS_CASE.decidedAtTurn!;
    const endTurn = startTurn + REYNOLDS_REAPPORTIONMENT_CHECKPOINT.durationTurns;
    for (let turn = startTurn; turn <= endTurn; turn++) {
      await processEraCheckpointsTurn(db, turn, "US");
    }

    const oh = collections.demographicDefaults.__store.get("OH")!;
    const tx = collections.demographicDefaults.__store.get("TX")!;

    const target = REYNOLDS_REAPPORTIONMENT_CHECKPOINT.targets[0];
    expect(target.dim).toBe("wealth");
    expect(target.bucket).toBe("low");

    // The targeted state moved by the full authored shift on wealth:low...
    expect(overlayValue(oh, "wealth", "low", "economicLean")).toBeCloseTo(target.totalShift, 6);
    // ...while the untargeted control state has no overlay at all.
    expect(tx.layer1PositionOverrides?.wealth?.low).toBeUndefined();

    // And it genuinely reaches the granular substrate: OH's wealth:low cells
    // resolve leftward relative to a pristine (no-overlay) derivation.
    const ohPristine = makeStateDemographics("OH");
    clearGranularElectorateCache();
    const before = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "OH",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: ohPristine,
      categories: [],
      enriched: [],
      demographicDefaults: ohPristine,
    })!;
    clearGranularElectorateCache();
    const after = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "OH",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: oh,
      categories: [],
      enriched: [],
      demographicDefaults: oh,
    })!;
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();

    function wealthLowMean(substrate: NonNullable<typeof before>) {
      let w = 0;
      let e = 0;
      for (const unit of substrate.units) {
        const bw = unit.bucketWeights["wealth:low"] ?? 0;
        if (bw <= 0) continue;
        w += unit.share * bw;
        e += unit.share * bw * unit.economicLean;
      }
      return w > 0 ? e / w : 0;
    }
    expect(wealthLowMean(after)).toBeLessThan(wealthLowMean(before));
  });

  it("NATIONAL: a checkpoint with no regional restriction (ALL_US_STATES) moves the targeted bucket in every state, not just one region", async () => {
    // National Civil Rights Act checkpoint: race:black, no triggerCaseKey
    // (statute, not gated by a docket case) — starts directly at its
    // fallbackStartTurn. Deliberately avoids Deep South states here: those
    // ALSO receive a race:black contribution from SOUTHERN_REALIGNMENT_
    // CHECKPOINT (which carries a
    // race:black target of its own), correct
    // layered behavior, but it would muddy THIS assertion's point, which is
    // that the national checkpoint alone already reaches every region.
    const states = ["OH", "CA", "NY", "TX"]; // Midwest, West, Northeast, South (non-Deep-South)
    const { db, collections } = createFakeDb({
      docketCases: [],
      legislationTypes: [],
      statePolicies: [],
      stateDemographics: states.map((s) => makeStateDemographics(s)),
      demographicDefaults: states.map((s) => makeStateDemographics(s)),
    });

    const startTurn = NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT.fallbackStartTurn;
    const endTurn = startTurn + NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT.durationTurns;
    for (let turn = startTurn; turn <= endTurn; turn++) {
      await processEraCheckpointsTurn(db, turn, "US");
    }

    const econTarget = NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT.targets.find(
      (t) => t.dim === "race" && t.bucket === "black" && t.axis === "economicLean"
    )!;
    // Every state in the fixture — spanning four different regions, none of
    // them special-cased — moved by the SAME full authored national shift.
    for (const stateId of states) {
      const doc = collections.demographicDefaults.__store.get(stateId)!;
      expect(
        overlayValue(doc, "race", "black", "economicLean"),
        `${stateId} did not receive the national race:black shift`
      ).toBeCloseTo(econTarget.totalShift, 6);
    }
  });

  it("is beatable: sustained opposing legislation on a mapped archetype nets against a bucket target's pull", async () => {
    // union_trades maps onto race:black at weight 0.25 in ARCHETYPE_BUCKET_MAP
    // — an ordinary archetype-authored law can contest a bucket checkpoint
    // with no new authoring convention needed, because eraCheckpointTurn.ts
    // projects every active legislative archetype shift through the SAME
    // archetypeValuesToBuckets map before netting.
    const opposingLegType: LegislationType = {
      _id: "test-opposing-union-law",
      name: "Test Opposing Union Law",
      description: "test fixture",
      policyDomain: "governance",
      subCategory: "test",
      demographicEffects: [
        // Positive (rightward) direction opposes the checkpoint's negative
        // (leftward) race:black pull.
        { groupId: "union_trades", target: "economicLean", direction: 1, magnitude: 3 },
      ],
    } as unknown as LegislationType;
    const opposingPolicy: StatePolicy = {
      stateId: "OH",
      legislationTypeId: "test-opposing-union-law",
      policyOptionId: "opt-max",
      policyOptionIndex: 6,
      enactedAt: new Date("2026-01-01"),
      enactedTurn: NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT.fallbackStartTurn,
      economic: 3,
      social: 0,
      effectDirection: 1,
    };

    const { db, collections } = createFakeDb({
      docketCases: [],
      legislationTypes: [opposingLegType],
      statePolicies: [opposingPolicy],
      stateDemographics: [makeStateDemographics("OH")],
      demographicDefaults: [makeStateDemographics("OH")],
    });

    const startTurn = NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT.fallbackStartTurn;
    const endTurn = startTurn + NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT.durationTurns;
    for (let turn = startTurn; turn <= endTurn; turn++) {
      await processEraCheckpointsTurn(db, turn, "US");
    }

    const oh = collections.demographicDefaults.__store.get("OH")!;
    // The sustained, strongly-opposing law held the bucket at (or past) its
    // starting position (0 — no pre-existing overlay) instead of letting it
    // drift negative.
    expect(overlayValue(oh, "race", "black", "economicLean")).toBeGreaterThanOrEqual(0);
  });
});
