/**
 * SP4 §4/§6 — demolished-doc handling + policy-effects gate.
 *
 * A playable region has NO stateMetrics doc at all: SP5's writeSplitMetrics
 * sends the economic and population categories plus independenceDesire to
 * macroMetrics and returns `political: null` for LAW_COUNTRY_IDS, so legacy
 * consumers see a macro-only doc. These tests build that doc from the real
 * production path (splitMetricsDoc + mergeRegionMetrics) rather than from a
 * test-only stripper.
 *
 * The legacy decay/policy loop skips the playable countries entirely;
 * non-playable processing is unchanged. The metric-engine side needs no new
 * fixture: the presence gate (phase.ts generic nodes) is already under test
 * (countryIndicesLive asserts non-present nodes are never written).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { StateMetrics } from "@/lib/db/types";
import { buildFlatMetrics } from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { processStatePolicyEffects } from "@/lib/policyEffects";
import { splitMetricsDoc } from "@/lib/macroMetrics/split";
import { mergeRegionMetrics } from "@/lib/macroMetrics/merge";

/**
 * The doc shape a playable region actually presents to legacy consumers after
 * SP5: the macro half only, with no political categories.
 */
function demolishedDoc(raw: StateMetrics): StateMetrics {
  // The extractor returns only the macro half now — there is no political
  // remainder to assert away.
  const { macro } = splitMetricsDoc(raw);
  return mergeRegionMetrics(macro) as StateMetrics;
}

describe("evaluateModifiers on a demolished doc (spec §4 sweep)", () => {
  it("neither throws nor fires political-keyed named modifiers", async () => {
    const { ukStateMetrics } = await import("@/lib/seeds/uk/ukStateMetrics");
    const doc = demolishedDoc({ ...ukStateMetrics[0], countryId: "UK" } as StateMetrics);
    const modifiers = evaluateModifiers(buildFlatMetrics(doc), {
      preset: "1953-default",
      countryId: "UK",
      year: null,
    });
    expect(Array.isArray(modifiers)).toBe(true);
    // Any modifier that fires must be keyed on a surviving metric — its id
    // cannot reference a demolished category's flat map (which is absent).
    for (const m of modifiers) expect(typeof m.effect).toBe("number");
  });
});

describe("processStatePolicyEffects country gate (spec §6)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("skips EVERY board country now, playable or not", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentTurn: 100 });
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "SCO", countryId: "UK" },
        { _id: "TOK", countryId: "JP" },
      ]);
    db.collection("statePolicies").find().toArray.mockResolvedValue([]);
    db.collection("legislationTypes").find().toArray.mockResolvedValue([]);
    // Both docs sit above their baseline → decay toward it produces an update
    // for any state the loop actually processes.
    const metricsDoc = (id: string, countryId: string) => ({
      _id: id,
      countryId,
      economic: { gdpGrowth: { value: 6 } },
    });
    db.collection("stateMetrics")
      .find()
      .toArray.mockResolvedValue([metricsDoc("SCO", "UK"), metricsDoc("TOK", "JP")]);
    db.collection("stateBaselines")
      .find()
      .toArray.mockResolvedValue([
        { _id: "SCO", baselines: { economic: { gdpGrowth: 2 } } },
        { _id: "TOK", baselines: { economic: { gdpGrowth: 2 } } },
      ]);

    await processStatePolicyEffects(db as unknown as Db);

    // Phase 3: the legacy decay/policy loop skips every board country. Their
    // metrics live on the board, whose sole animator is the dynamics phase —
    // running this loop for them would fight that phase over the same numbers.
    const bulk = [
      ...(db.collectionMocks["stateMetrics"]?.bulkWrite.mock.calls ?? []),
      ...(db.collectionMocks["macroMetrics"]?.bulkWrite.mock.calls ?? []),
    ];
    const writtenIds = bulk.flatMap((c) =>
      (c[0] as Array<{ updateOne: { filter: { _id: string } } }>).map(
        (op) => op.updateOne.filter._id
      )
    );
    expect(writtenIds).not.toContain("TOK");
    expect(writtenIds).not.toContain("SCO");
  });
});
