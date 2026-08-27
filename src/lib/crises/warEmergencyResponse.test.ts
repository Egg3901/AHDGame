import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { applyWarEmergencyResponse } from "./warEmergencyResponse";

const dependencies = vi.hoisted(() => ({
  applyCountryTreasuryDelta: vi.fn().mockResolvedValue(undefined),
  writeSectorOutputDemandModifier: vi.fn().mockResolvedValue(undefined),
  writeWarEmergencyMitigation: vi.fn().mockResolvedValue(undefined),
  applyCivilLibertiesDelta: vi.fn().mockResolvedValue(1),
  logWireEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/events/substrate/applyEffects", () => ({
  applyCountryTreasuryDelta: dependencies.applyCountryTreasuryDelta,
}));
vi.mock("@/lib/events/substrate/countryModifiers", () => ({
  writeSectorOutputDemandModifier: dependencies.writeSectorOutputDemandModifier,
  writeWarEmergencyMitigation: dependencies.writeWarEmergencyMitigation,
}));
vi.mock("@/lib/politicalMetrics/civilLiberties", () => ({
  applyCivilLibertiesDelta: dependencies.applyCivilLibertiesDelta,
}));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: dependencies.logWireEvent }));

function context() {
  const db = createMockDb();
  db.collection("governmentApprovals");
  return {
    db,
    ctx: {
      db: db as never,
      crisis: { _id: new ObjectId() },
      interaction: {},
      option: {},
      characterId: new ObjectId(),
      countryId: "US",
      currentTurn: 438,
    } as never,
  };
}

describe("war emergency crisis responses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("makes a protest crackdown trade Democratic Health and consumer demand for mitigation and war industry", async () => {
    const { db, ctx } = context();

    await applyWarEmergencyResponse(ctx, "protests_crackdown");

    expect(dependencies.applyCivilLibertiesDelta).toHaveBeenCalledWith(db, "US", -7);
    expect(dependencies.writeWarEmergencyMitigation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ countryId: "US", pct: 18, durationTurns: 24 })
    );
    expect(
      dependencies.writeSectorOutputDemandModifier.mock.calls.map(([, input]) => input)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sectorType: "retail", pct: -8 }),
        expect.objectContaining({ sectorType: "entertainment", pct: -10 }),
        expect.objectContaining({ sectorType: "manufacturing", pct: 8 }),
        expect.objectContaining({ sectorType: "defense", pct: 10 }),
      ])
    );
    expect(db.collectionMocks.governmentApprovals!.updateOne).toHaveBeenCalledWith(
      { _id: "US" },
      { $inc: { approvalRating: -6 } }
    );
  });

  it("charges the treasury and creates mitigation when all bank deposits are guaranteed", async () => {
    const { db, ctx } = context();

    await applyWarEmergencyResponse(ctx, "bank_guarantee");

    expect(dependencies.applyCountryTreasuryDelta).toHaveBeenCalledWith(
      db,
      "US",
      438,
      -20_000,
      expect.objectContaining({
        source: "war_emergency_crisis",
        responseId: "bank_guarantee",
      })
    );
    expect(dependencies.writeWarEmergencyMitigation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ countryId: "US", pct: 10, durationTurns: 12 })
    );
    expect(dependencies.applyCivilLibertiesDelta).not.toHaveBeenCalled();
  });
});
