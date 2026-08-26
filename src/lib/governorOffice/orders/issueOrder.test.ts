/**
 * The executive-order ladder was written against the 7-option (0–6) policy
 * ladder most legislation types use: a missing prior policy defaulted to index
 * 3 and the shift clamped to 0–6 regardless of how many options the targeted
 * type actually has.
 *
 * That is out of bounds for any shorter ladder. The state redistricting
 * authority act has three options, and the same class of bug was already fixed
 * once on the bill path (see the centerIndex clamp in billEnactment.ts) — the
 * order path never got the same treatment. An order on a short ladder could
 * write a policyOptionIndex no option exists at, which downstream readers then
 * silently reinterpret: redistricting caps clamp an out-of-range index back to
 * the centre, so the order claims one authority and the map enforces another.
 */
import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { issueOrder } from "./issueOrder";
import { REDISTRICT_AUTHORITY_LAW } from "@/lib/redistricting/caps";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
vi.mock("@/lib/news", () => ({ generateOrderNews: vi.fn().mockResolvedValue(undefined) }));

/** A three-option ladder: 0 independent, 1 bipartisan, 2 legislature-drawn. */
const THREE_OPTION_TYPE = {
  _id: REDISTRICT_AUTHORITY_LAW,
  policyOptions: [
    { id: "state_redistricting_authority_opt_0", name: "Independent", economic: 0, social: 1 },
    { id: "state_redistricting_authority_opt_1", name: "Bipartisan", economic: 0, social: 0 },
    { id: "state_redistricting_authority_opt_2", name: "Legislative", economic: 0, social: -1 },
  ],
};

function setup(priorPolicy: unknown = null) {
  const db = createMockDb() as unknown as MockDb;
  // Collections are created lazily; touch each one so the mocks exist to stub.
  db.collection("governorOfficeState").findOne.mockResolvedValue({
    countryId: "US",
    stateId: "IA",
    gubernatorialActions: 99,
  });
  db.collection("governorExecutiveOrders").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
    sort: vi.fn().mockReturnThis(),
  });
  db.collection("statePolicies").findOne.mockResolvedValue(priorPolicy);
  db.collection("legislationTypes").findOne.mockResolvedValue(THREE_OPTION_TYPE);
  return db;
}

const INPUT = {
  countryId: "US" as const,
  stateId: "IA",
  characterId: "c1" as never,
  characterName: "Governor",
  legislationTypeId: REDISTRICT_AUTHORITY_LAW,
};

describe("issueOrder — short option ladders", () => {
  // Options run left-first to right-last, so effectDirection +1 walks the index
  // UP the ladder (toward "Legislative") and -1 walks it DOWN.

  it("treats a missing prior policy as the centre of THIS type's ladder", async () => {
    const db = setup();

    // Centre of a three-option ladder is index 1, so one step up lands on 2.
    // The old hardcoded default of 3 started off the end of the ladder.
    const result = await issueOrder(db as never, { ...INPUT, effectDirection: 1, steps: 1 });

    expect(result.status).toBe(200);
    expect(result.body.policyOptionIndexAfter).toBe(2);
  });

  it("never writes a policyOptionIndex the targeted type has no option at", async () => {
    const db = setup();

    // Two steps up from the centre of a three-option ladder runs off the end.
    const result = await issueOrder(db as never, { ...INPUT, effectDirection: 1, steps: 2 });

    if (result.status === 200) {
      const upsert = db.collectionMocks.statePolicies.updateOne.mock.calls[0];
      const written = (upsert[1] as { $set: { policyOptionIndex: number } }).$set.policyOptionIndex;
      expect(written).toBeLessThan(THREE_OPTION_TYPE.policyOptions.length);
      expect(written).toBeGreaterThanOrEqual(0);
    } else {
      // Refusing outright is the correct outcome — what must never happen is a
      // successful order writing an index off the end of the ladder.
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/boundary/i);
    }
  });

  it("refuses a step that would run past the top of a short ladder", async () => {
    const db = setup({
      stateId: "IA",
      legislationTypeId: REDISTRICT_AUTHORITY_LAW,
      policyOptionIndex: 2,
    });

    const result = await issueOrder(db as never, { ...INPUT, effectDirection: 1, steps: 1 });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/boundary|no effect/i);
  });

  it("still allows a legal step down a short ladder", async () => {
    const db = setup({
      stateId: "IA",
      legislationTypeId: REDISTRICT_AUTHORITY_LAW,
      policyOptionIndex: 2,
    });

    const result = await issueOrder(db as never, { ...INPUT, effectDirection: -1, steps: 1 });

    expect(result.status).toBe(200);
    expect(result.body.policyOptionIndexAfter).toBe(1);
  });
});
