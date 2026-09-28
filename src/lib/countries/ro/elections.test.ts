import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { roRegions1991 } from "@/lib/countries/ro/data/roRegions1991";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";
import { getElectionMethod } from "@/lib/elections/electionMethod";
import { ensureROElections } from "./elections";
import { RO_1992_DEPUTY_SEATS, RO_1992_SENATE_SEATS } from "./rules/parliament1992";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discordWebhooks")>()),
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
}));

const NOW = new Date("2026-01-01T00:00:00.000Z");
type SpawnedElection = {
  electionType: string;
  electionYear: number;
  endTurn: number;
  totalSeats: number;
};
let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "RO", status: "active" });
  db.collection("states").find.mockReturnValue({ toArray: async () => roRegions1991 });
  db.collection("elections").find.mockReturnValue({
    toArray: async () => [],
    sort: () => ({ toArray: async () => [] }),
  });
});

describe("Romanian election spawner", () => {
  it("spawns 1992 deputy and Senate races at the post-constitution chamber sizes", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
      startingYear: 1991,
      currentTurn: 1,
    });
    await ensureROElections(NOW, 1);
    const batches = db
      .collection("elections")
      .insertMany.mock.calls.map((call: unknown[]) => call[0] as SpawnedElection[]);
    expect(batches).toHaveLength(2);
    const deputies = batches[0];
    const senators = batches[1];
    expect(deputies).toHaveLength(roRegions1991.length);
    expect(senators).toHaveLength(roRegions1991.length);
    expect(
      deputies.every(
        (e) => e.electionType === "chamberOfDeputies" && e.electionYear === 1992 && e.endTurn === 96
      )
    ).toBe(true);
    expect(
      senators.every(
        (e) => e.electionType === "senat" && e.electionYear === 1992 && e.endTurn === 96
      )
    ).toBe(true);
    expect(deputies.reduce((sum: number, e: { totalSeats: number }) => sum + e.totalSeats, 0)).toBe(
      RO_1992_DEPUTY_SEATS
    );
    expect(senators.reduce((sum: number, e: { totalSeats: number }) => sum + e.totalSeats, 0)).toBe(
      RO_1992_SENATE_SEATS
    );
    expect(
      canonicalTurnsForCycle({
        electionType: "senat",
        countryId: "RO",
        cycle: 2,
        ctx: { preset: "1991-default", startingYear: 1991 },
      })?.endTurn
    ).toBe(288);
    expect(getElectionMethod("RO", "chamberOfDeputies")).toBe("pr_hareQuota");
    expect(getElectionMethod("RO", "senat")).toBe("pr_hareQuota");
  });

  it("keeps the 396/119 constituent chambers during the founding election", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
      startingYear: 1991,
      currentTurn: 1,
      preIteration: { active: true },
    });
    await ensureROElections(NOW, 1);
    const batches = db.collection("elections").insertMany.mock.calls.map(([docs]) => docs);
    expect(
      batches[0].reduce((sum: number, e: { totalSeats: number }) => sum + e.totalSeats, 0)
    ).toBe(396);
    expect(
      batches[1].reduce((sum: number, e: { totalSeats: number }) => sum + e.totalSeats, 0)
    ).toBe(119);
  });

  it("preserves the Cold War Grand National Assembly route", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1979-default",
      startingYear: 1979,
      currentTurn: 1,
    });
    await ensureROElections(NOW, 1);
    const batches = db
      .collection("elections")
      .insertMany.mock.calls.map((call: unknown[]) => call[0] as SpawnedElection[]);
    expect(batches).toHaveLength(1);
    expect(batches[0].every((e) => e.electionType === "grandNationalAssembly")).toBe(true);
  });

  it("does not revive the Cold War assembly in a modern preset", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "2027-default",
      startingYear: 2027,
      currentTurn: 1,
    });
    await ensureROElections(NOW, 1);
    expect(db.collection("elections").insertMany).not.toHaveBeenCalled();
  });
});
