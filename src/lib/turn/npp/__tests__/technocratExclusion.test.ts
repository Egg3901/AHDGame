import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// This is the contract test for technocrat NPP exclusion from political NPP
// loops (spec requirement #10). Technocrat NPPs (e.g. autonomous central-bank
// chairs) must be hard-excluded from election entry, federal/state bill voting,
// action AI/processing, and fund generation.
//
// Two layers are asserted:
//   1. Query-layer filters — the standalone phases that own their own npps
//      `find` call must include `isTechnocrat: { $ne: true }` in the filter.
//   2. The shared NPP context (`loadNPPContext`) — the `allNPPs` query must
//      exclude technocrats at the query layer so the in-memory
//      `npp.isTechnocrat` guards in electionEntry/billVoting/stateBillVoting
//      (which operate on the shared context) work as defense-in-depth.
//
// The previous version of this test grepped six files for the literal
// `isTechnocrat: { $ne: true }` string. Three of those files
// (electionEntry.ts, billVoting.ts, stateBillVoting.ts) only mentioned the
// filter in prose comments — the regex matched comment text, not real query
// filters, so the test passed while the code did not exclude. This version
// strips comments before matching and drops files whose exclusion is not a
// real query filter in that file.

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function src(rel: string): string {
  return readFileSync(resolve("src", rel), "utf8");
}

// Strip JS/TS comments so the regex assertion can only pass on real code,
// not on prose comments that happen to mention the query filter. This is the
// gap that let the original false-positive test ship: the regex matched
// "Mirrors the isTechnocrat: { $ne: true } query filter" in comment text.
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("technocrat exclusion from political NPP loops", () => {
  // Files whose exclusion IS a real query-layer filter on the npps collection.
  // `electionEntry.ts`, `billVoting.ts`, `stateBillVoting.ts` are excluded from
  // this list because their guards are in-memory checks against `npp.isTechnocrat`
  // on the shared NPP context, not query filters — the exclusion is enforced
  // upstream in `context.ts` (see the behavioral test below). `actionAi.ts` is
  // excluded because it only describes the filter in a doc comment; the actual
  // query lives in its caller `nppActionProcessing.ts`.
  const queryFilterFiles = ["lib/turn/nppActionProcessing.ts", "lib/turn/nppFundGeneration.ts"];

  it.each(queryFilterFiles)(
    "%s queries npps with an isTechnocrat exclusion in real code (not comments)",
    (rel) => {
      const code = stripComments(src(rel));
      expect(code).toMatch(/isTechnocrat:\s*\{\s*\$ne:\s*true\s*\}/);
    }
  );

  describe("loadNPPContext allNPPs query", () => {
    let db: MockDb;

    beforeEach(async () => {
      vi.clearAllMocks();
      db = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    });

    it("excludes technocrat NPPs from the allNPPs find filter", async () => {
      const gameNow = new Date("2026-04-29T15:00:00.000Z");

      const { loadNPPContext } = await import("../context");
      await loadNPPContext(gameNow);

      const nppsFindCalls = db.collectionMocks["npps"]!.find.mock.calls as Array<
        [Record<string, unknown>, Record<string, unknown>?]
      >;
      // The allNPPs query is the first npps.find call in loadNPPContext.
      expect(nppsFindCalls.length).toBeGreaterThan(0);
      const allNPPsFilter = nppsFindCalls[0][0];
      expect(allNPPsFilter).toMatchObject({
        retiredAt: null,
        isTechnocrat: { $ne: true },
      });
    });

    it("projects isTechnocrat on the allNPPs query for defense-in-depth in-memory guards", async () => {
      const gameNow = new Date("2026-04-29T15:00:00.000Z");

      const { loadNPPContext } = await import("../context");
      await loadNPPContext(gameNow);

      const nppsFindCalls = db.collectionMocks["npps"]!.find.mock.calls as Array<
        [Record<string, unknown>, { projection?: Record<string, unknown> }?]
      >;
      expect(nppsFindCalls.length).toBeGreaterThan(0);
      const options = nppsFindCalls[0][1];
      expect(options?.projection).toMatchObject({ isTechnocrat: 1 });
    });
  });
});
