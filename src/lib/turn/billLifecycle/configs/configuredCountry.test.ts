import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bill } from "@/lib/db/types/legislation";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { runBillLifecycle } from "../engine";
import type { ChamberVoteStage } from "../types";
import { buildConfiguredCountryBillLifecycle } from "./configuredCountry";

vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/legislationEffects", () => ({
  applyLegislationEffect: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(null),
}));

const NOW = new Date("2026-08-27T12:00:00Z");

const cursor = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  project: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
});

describe("buildConfiguredCountryBillLifecycle", () => {
  it.each([
    ["FR", "1953-default", 2, false],
    ["FR", "1979-default", 2, true],
    ["IT", "1953-default", 2, false],
    ["ES", "1953-default", 1, false],
    ["ES", "1979-default", 2, false],
    ["SE", "1953-default", 1, false],
    ["TR", "1953-default", 1, false],
    ["TR", "1979-default", 2, false],
    ["AT", "1953-default", 1, false],
    ["FI", "1953-default", 1, false],
    ["GR", "1953-default", 1, false],
    ["BR", "1953-default", 2, true],
    ["NG", "1953-default", 2, true],
  ] as const)(
    "%s in %s has the authored chamber and executive graph",
    (countryId, preset, chamberStages, hasExecutive) => {
      const config = buildConfiguredCountryBillLifecycle(countryId, preset);
      expect(config.stages.filter((stage) => stage.kind === "chamberVote")).toHaveLength(
        chamberStages
      );
      expect(config.stages.some((stage) => stage.kind === "executiveAction")).toBe(hasExecutive);
      expect(config.stages.some((stage) => stage.kind === "concurrentVote")).toBe(true);
    }
  );

  it("crosses a bicameral bill into the chamber where it did not originate", () => {
    const config = buildConfiguredCountryBillLifecycle("FR", "1953-default");
    const crossover = config.stages.find(
      (stage): stage is ChamberVoteStage =>
        stage.kind === "chamberVote" && stage.status === "active_other"
    );

    expect(crossover?.chamberOnEnter?.({ currentChamber: "assembleeNationale" } as Bill)).toBe(
      "senat"
    );
    expect(crossover?.chamberOnEnter?.({ currentChamber: "senat" } as Bill)).toBe(
      "assembleeNationale"
    );
  });
});

describe("France expired-bill regression", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("bills");
    db.collection("electedOfficials");
    db.collection("characters");
    db.collection("governmentFormations");
    db.collection("gameState");
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });
  });

  it("moves an expired active French bill into the Senate instead of leaving it active", async () => {
    const voterId = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "FR",
      status: "active",
      originChamber: "assembleeNationale",
      currentChamber: "assembleeNationale",
      votingEndsOnTurn: 265,
      votes: { [`npp_${voterId.toString()}`]: "for" },
      votesFor: 1,
      votesAgainst: 0,
      votesAbstain: 0,
      coSponsors: [],
    };
    db.collectionMocks["bills"]!.find.mockImplementation((query: { status?: string }) =>
      cursor(query.status === "active" ? [bill] : [])
    );
    db.collectionMocks["bills"]!.findOne.mockResolvedValue(bill);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(
      cursor([
        {
          nppId: voterId,
          characterId: null,
          countryId: "FR",
          officeType: "deputy",
          seatsHeld: 1,
        },
      ])
    );

    await runBillLifecycle(
      db as unknown as Db,
      buildConfiguredCountryBillLifecycle("FR", "1953-default"),
      NOW,
      439
    );

    expect(db.collectionMocks["bills"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: bill._id, status: "active" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "active_other",
          currentChamber: "senat",
          otherChamberVotingEndsOnTurn: 463,
        }),
      })
    );
  });
});
