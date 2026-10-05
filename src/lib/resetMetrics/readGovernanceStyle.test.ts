import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resetLawFamilies } from "@/lib/resetLegislation/catalog";
import { openingLawReference } from "@/lib/resetLegislation/openingLaw";
import { readResetGovernanceStyle } from "./readGovernanceStyle";

vi.mock("@/lib/governanceStyle/loadCompetition", () => ({
  loadDemocraticCompetition: vi.fn().mockResolvedValue({
    dominantPartyId: null,
    dominantSeatShare: 0,
    chambersMeasured: 0,
    executivePartyId: null,
    executiveSystem: "presidential",
    executiveAlignedWithLegislature: null,
    uninterruptedControlTurns: 0,
    consecutiveExecutiveTerms: 0,
    seatMarginPenalty: 0,
    legislativeContinuityPenalty: 0,
    executiveContinuityPenalty: 0,
    courtDominantBloc: null,
    courtDominantShare: 0,
    courtSeated: 0,
    courtLiberalSeats: 0,
    courtSwingSeats: 0,
    courtConservativeSeats: 0,
    courtUnclassifiedSeats: 0,
    courtPenalty: 0,
    penalty: 0,
  }),
}));

describe("readResetGovernanceStyle", () => {
  it("uses an enacted v2 option instead of its 1991 opening position", async () => {
    const db = createMockDb();
    const family = resetLawFamilies.find((row) => row.availability.national.includes("US"))!;
    const reference = openingLawReference("US", "national", family.id)!;
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    db.collection("resetLawOpeningBoards").findOne.mockResolvedValue({
      references: { [family.id]: reference },
    });

    const score = await readResetGovernanceStyle({
      db: db as unknown as Db,
      worldId: "world-test",
      countryId: "US",
      scope: "national",
      conditionScores: { "50": 80 },
      programs: [{ familyId: family.id, choice: "far_right" }],
    });

    expect(score?.leftRight).toEqual({ value: 100, label: "Right" });
    expect(score?.democraticHealth.value).toBe(80);
    expect(db.collectionMocks.resetLawOpeningBoards!.findOne).toHaveBeenCalledWith(
      { _id: "US:national", worldId: "world-test" },
      { projection: { references: 1 } }
    );
  });

  it("does not force Leave it to the States onto the ideology rail", async () => {
    const db = createMockDb();
    const family = resetLawFamilies.find(
      (row) => row.leaveToStates && row.availability.national.includes("US")
    )!;
    const reference = openingLawReference("US", "national", family.id)!;
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
    db.collection("resetLawOpeningBoards").findOne.mockResolvedValue({
      references: { [family.id]: reference },
    });

    const score = await readResetGovernanceStyle({
      db: db as unknown as Db,
      worldId: "world-test",
      countryId: "US",
      scope: "national",
      conditionScores: {},
      programs: [{ familyId: family.id, choice: "leave_to_states" }],
    });

    expect(score?.leftRight).toEqual({ value: 50, label: "Centre" });
  });
});
