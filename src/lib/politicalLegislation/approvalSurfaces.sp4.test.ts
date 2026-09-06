/**
 * SP4 surface-conversion tests (spec §3/§6): the snapshot writer scores
 * playable countries from the hybrid political model, non-playables stay on
 * the byte-identical legacy path, and the country-page global reference
 * excludes playable regions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, getAccessedCollections, type MockDb } from "@/lib/test-utils/mockDb";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { APPROVAL_NEUTRAL_SCORE, approvalNeutralFor } from "./politicalApproval";

/** The era these JP fixtures score against. */
const PRESET = "1953-default";
import { snapshotApprovalHistory } from "@/lib/utils/governmentApproval";

function uniformValues(v: number): Record<PoliticalMetricId, number> {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) out[f.id] = v;
  return out;
}

describe("snapshotApprovalHistory (SP4 conversion)", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function seedUk(boardValue: number) {
    db.collection("states").distinct.mockResolvedValue(["LON", "MAN"]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "LON", countryId: "UK", population: 8_000_000 },
        { _id: "MAN", countryId: "UK", population: 2_000_000 },
      ]);
    db.collection("macroMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "LON", countryId: "UK" },
        { _id: "MAN", countryId: "UK" },
      ]);
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "LON", countryId: "UK", values: uniformValues(boardValue) },
        { _id: "MAN", countryId: "UK", values: uniformValues(boardValue) },
      ]);
  }

  it("scores UK regions from the hybrid political base (board moves the snapshot)", async () => {
    seedUk(APPROVAL_NEUTRAL_SCORE.UK + 10);
    await snapshotApprovalHistory(db as unknown as Db, "UK", 100);
    // Uniform board +10 → component +5 → base 55 per region; national 55; empty
    // cabinetMembers costs the NO_CABINET penalty 7.5 → 47.5 stored.
    const call = db.collectionMocks["governmentApprovals"]!.updateOne.mock.calls.at(-1)!;
    const set = (call[1] as { $set: { approvalRating: number } }).$set;
    expect(set.approvalRating).toBeCloseTo(42.5, 5);

    // A degraded board must move the snapshot the other way.
    db = createMockDb();
    seedUk(APPROVAL_NEUTRAL_SCORE.UK - 10);
    await snapshotApprovalHistory(db as unknown as Db, "UK", 100);
    const call2 = db.collectionMocks["governmentApprovals"]!.updateOne.mock.calls.at(-1)!;
    const set2 = (call2[1] as { $set: { approvalRating: number } }).$set;
    expect(set2.approvalRating).toBeCloseTo(32.5, 5);
  });

  it("scores JP from the board too, now that routing covers non-playables", async () => {
    // This asserted the OPPOSITE before the step-6 cutover — JP was pinned to
    // the legacy scorer. Every board country now shares one approval path;
    // per-country divergence was a real bug (fix/region-approval), so the
    // non-playables joining the pipeline is the point, not a side effect.
    db.collection("states").distinct.mockResolvedValue(["TOK"]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "TOK", countryId: "JP", population: 13_000_000 }]);
    db.collection("macroMetrics")
      .find()
      .toArray.mockResolvedValue([{ _id: "TOK", countryId: "JP" }]);
    // The world's preset picks which era's intercept JP scores against, so the
    // fixture has to declare one — an unset preset now fails loudly instead of
    // silently scoring against the wrong era.
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", preset: PRESET });
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        {
          _id: "TOK",
          countryId: "JP",
          values: uniformValues(approvalNeutralFor("JP", PRESET) + 10),
        },
      ]);
    await snapshotApprovalHistory(db as unknown as Db, "JP", 100);
    expect(getAccessedCollections(db)).toContain("politicalMetrics");
    // Uniform board +10 → component +5 → base 55, minus the 7.5 cabinet penalty.
    const call = db.collectionMocks["governmentApprovals"]!.updateOne.mock.calls.at(-1)!;
    const set = (call[1] as { $set: { approvalRating: number } }).$set;
    expect(set.approvalRating).toBeCloseTo(42.5, 5);
  });

  it("falls back to BASE_APPROVAL, never the legacy scorer, when a board country is unseeded", async () => {
    // The seam that matters for a mid-migration world: a board country whose
    // politicalMetrics docs do not exist yet. Silently reverting to the legacy
    // metric scorer here is what would reintroduce per-surface divergence.
    //
    // The macro doc is deliberately EMPTY. Named modifiers still stack on top
    // of the base by design (see the baseOverride seam test), so leaving metrics
    // on it would measure those rather than which BASE was chosen — which is
    // the only thing this test is about.
    db.collection("states").distinct.mockResolvedValue(["TOK"]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "TOK", countryId: "JP", population: 13_000_000 }]);
    db.collection("macroMetrics")
      .find()
      .toArray.mockResolvedValue([{ _id: "TOK", countryId: "JP" }]);
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", preset: PRESET });
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    await snapshotApprovalHistory(db as unknown as Db, "JP", 100);
    // BASE_APPROVAL 50 minus the 7.5 cabinet penalty.
    const call = db.collectionMocks["governmentApprovals"]!.updateOne.mock.calls.at(-1)!;
    const set = (call[1] as { $set: { approvalRating: number } }).$set;
    expect(set.approvalRating).toBeCloseTo(37.5, 5);
  });
});
