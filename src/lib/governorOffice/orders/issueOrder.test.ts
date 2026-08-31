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
import { getCatalog } from "@/lib/politicalLegislation/catalog";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";

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

describe("issueOrder — new-generation `both` laws in a region", () => {
  const bothLaw = getCatalog("RU").find(
    (law) => law.kind !== "tax" && law.allowedScope === "both"
  )!;
  const projected = projectLawToLegislationType(bothLaw);

  function setupNewGen(priorPolicy: unknown = null) {
    const db = createMockDb() as unknown as MockDb;
    db.collection("governorOfficeState").findOne.mockResolvedValue({
      countryId: "RU",
      stateId: "MOW",
      gubernatorialActions: 99,
    });
    db.collection("governorExecutiveOrders").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
    });
    db.collection("statePolicies").findOne.mockResolvedValue(priorPolicy);
    db.collection("legislationTypes").findOne.mockResolvedValue(projected);
    return db;
  }

  /** `policyOptionIndexBefore` lives on the stored order doc, not the result body. */
  function beforeIndexOf(db: MockDb): number {
    const order = db.collectionMocks.governorExecutiveOrders.insertOne.mock.calls[0]![0] as {
      policyOptionIndexBefore: number;
    };
    return order.policyOptionIndexBefore;
  }

  const NEWGEN_INPUT = {
    countryId: "RU" as const,
    stateId: "MOW",
    characterId: "c1" as never,
    characterName: "Governor",
    legislationTypeId: bothLaw.id,
  };

  /**
   * The region default is level 0, and /api/game/current-policies now reports
   * it, so IssueOrderModal previews the step from 0. Falling back to the
   * ladder centre here made the server write a level the region never had —
   * and disagree with the preview the player was shown.
   */
  it("steps from level 0, not the ladder centre, when the region has no row", async () => {
    const db = setupNewGen();

    const result = await issueOrder(db as never, {
      ...NEWGEN_INPUT,
      effectDirection: 1,
      steps: 1,
    });

    expect(result.status).toBe(200);
    expect(beforeIndexOf(db)).toBe(0);
    expect(result.body.policyOptionIndexAfter).toBe(1);
  });

  it("refuses to step below the region default instead of silently clamping", async () => {
    const db = setupNewGen();

    const result = await issueOrder(db as never, {
      ...NEWGEN_INPUT,
      effectDirection: -1,
      steps: 1,
    });

    expect(result.status).toBe(400);
  });

  it("a real region row still wins over the default", async () => {
    const db = setupNewGen({ policyOptionIndex: 3, policyOptionId: "l3" });

    const result = await issueOrder(db as never, {
      ...NEWGEN_INPUT,
      effectDirection: 1,
      steps: 1,
    });

    expect(result.status).toBe(200);
    expect(beforeIndexOf(db)).toBe(3);
    expect(result.body.policyOptionIndexAfter).toBe(4);
  });

  /**
   * National rows ARE seeded for these laws. A missing one means something
   * else is wrong; defaulting it to 0 would quietly rewrite a national order.
   */
  it("keeps the ladder centre at national scope", async () => {
    const db = setupNewGen();

    const result = await issueOrder(db as never, {
      ...NEWGEN_INPUT,
      stateId: "su_national",
      scope: "national",
      effectDirection: 1,
      steps: 1,
    });

    expect(result.status).toBe(200);
    expect(beforeIndexOf(db)).toBe(2);
  });
});
