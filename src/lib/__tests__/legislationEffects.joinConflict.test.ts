import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bill, JoinConflictProvision } from "@/lib/db/types/legislation";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { billRequiresExecutiveAction } from "@/lib/internationalOrganizations/withdrawalBills";
import { billHasDeclareWar } from "@/lib/congress/billPassRule";

const joinSide = vi.fn().mockResolvedValue(undefined);
const prepareAutonomousWarEntry = vi.fn();
let conflict: ConflictDoc | null = null;

vi.mock("@/lib/military/joinSide", () => ({
  joinSide: (...args: unknown[]) => joinSide(...args),
}));
vi.mock("@/lib/nppAutonomy/autonomousWarCommands", () => ({
  prepareAutonomousWarEntry: (...args: unknown[]) => prepareAutonomousWarEntry(...args),
}));
vi.mock("@/lib/db/collections/conflicts", () => ({ getConflict: vi.fn(async () => conflict) }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: async () => 200 }));

const { applyLegislationEffect } = await import("@/lib/legislationEffects");

const PROVISION: JoinConflictProvision = {
  type: "join_conflict",
  theaterId: "korea-1953",
  side: "A",
  organizationId: "NATO",
  resolutionId: "507f1f77bcf86cd799439012",
};

const KOREA: ConflictDoc = {
  _id: "korea-1953",
  conflictId: 7,
  name: "Korean War",
  status: "active",
  sideA: { label: "United Nations Command", countries: ["KR"] },
  sideB: { label: "Korean People's Army", countries: ["KP"] },
} as unknown as ConflictDoc;

const bill = (over: Partial<Bill> = {}): Bill =>
  ({
    _id: new ObjectId(),
    countryId: "US",
    stateId: "us_national",
    title: "Entry into the Korean War (NATO)",
    provisions: [PROVISION],
    ...over,
  }) as unknown as Bill;

function stubDb() {
  return {
    collection: () => ({
      findOne: async () => null,
      updateOne: async () => ({ modifiedCount: 1 }),
      insertOne: async () => ({ acknowledged: true }),
      find: () => ({ toArray: async () => [] }),
    }),
  } as unknown as Db;
}

describe("join_conflict enactment effect", () => {
  beforeEach(() => {
    joinSide.mockClear();
    prepareAutonomousWarEntry.mockReset().mockResolvedValue({
      ready: true,
      deployedUnits: 1,
      reason: "Ready.",
    });
    conflict = KOREA;
  });

  it("requires a fresh force-readiness check for an NPP-sponsored entry law", async () => {
    prepareAutonomousWarEntry.mockResolvedValue({
      ready: false,
      deployedUnits: 0,
      reason: "No ready force can deploy.",
    });

    await applyLegislationEffect(stubDb(), bill({ nppSponsored: true }));

    expect(prepareAutonomousWarEntry).toHaveBeenCalledWith(
      expect.anything(),
      "US",
      expect.objectContaining({ _id: "korea-1953" }),
      200,
      "NATO"
    );
    expect(joinSide).not.toHaveBeenCalled();
  });

  it("enrols the country on the resolution's side", async () => {
    await applyLegislationEffect(stubDb(), bill());

    expect(joinSide).toHaveBeenCalledTimes(1);
    const [, passedConflict, countryId, side] = joinSide.mock.calls[0]!;
    expect((passedConflict as ConflictDoc)._id).toBe("korea-1953");
    expect(countryId).toBe("US");
    expect(side).toBe("A");
  });

  it("is a no-op when the conflict resolved while the bill sat", async () => {
    // Up to 48 turns of world state separate the bloc vote from this effect —
    // 24 at the org and 24 at the chamber.
    conflict = { ...KOREA, status: "resolved" } as ConflictDoc;
    await applyLegislationEffect(stubDb(), bill());

    expect(joinSide).not.toHaveBeenCalled();
  });

  it("is a no-op when the conflict has vanished entirely", async () => {
    conflict = null;
    await applyLegislationEffect(stubDb(), bill());

    expect(joinSide).not.toHaveBeenCalled();
  });

  it("is a no-op when the country already landed on the opposing side", async () => {
    // Never switches a country's side: it could have been dragged onto the other
    // side by its own declaration while this bill was on the floor.
    conflict = {
      ...KOREA,
      sideB: { label: "Korean People's Army", countries: ["KP", "US"] },
    } as ConflictDoc;
    await applyLegislationEffect(stubDb(), bill());

    expect(joinSide).not.toHaveBeenCalled();
  });

  it("skips the president", () => {
    // The chambers ratified an entry the bloc called for; there is no separate
    // executive assent stage, exactly as for a declaration of war.
    expect(
      billRequiresExecutiveAction({
        countryId: "US",
        stateId: "us_national",
        internationalAction: undefined,
        provisions: [PROVISION],
      })
    ).toBe(false);
  });

  it("keeps the simple-majority bar", () => {
    // Enforced by OMISSION — join_conflict is deliberately not added to
    // billHasDeclareWar. A decision enforced by absence needs a test that names it.
    expect(billHasDeclareWar([PROVISION])).toBe(false);
  });
});
