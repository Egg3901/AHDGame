import { describe, it, expect, vi } from "vitest";
import { type Db } from "mongodb";
import {
  isLeadershipElectionFreezeActive,
  LEADERSHIP_FREEZE_TURNS,
} from "./leadershipElectionFreeze";

function makeDb(matching: number) {
  const countDocuments = vi.fn().mockResolvedValue(matching);
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name !== "nationalPartyElections") throw new Error(`unexpected collection ${name}`);
      return { countDocuments };
    }),
  } as unknown as Db;
  return { db, countDocuments };
}

const PARTY = { sequentialId: 3, countryId: "UK" as const };

describe("isLeadershipElectionFreezeActive", () => {
  it("is inactive when no leadership election is closing", async () => {
    const { db } = makeDb(0);
    expect(await isLeadershipElectionFreezeActive(db, PARTY, 100)).toBe(false);
  });

  it("is active when one is closing inside the window", async () => {
    const { db } = makeDb(1);
    expect(await isLeadershipElectionFreezeActive(db, PARTY, 100)).toBe(true);
  });

  it("queries only open elections closing within the freeze window", async () => {
    const { db, countDocuments } = makeDb(0);
    await isLeadershipElectionFreezeActive(db, PARTY, 100);
    expect(countDocuments).toHaveBeenCalledWith(
      {
        partyId: "3",
        countryId: "UK",
        status: "voting",
        endTurn: { $lte: 100 + LEADERSHIP_FREEZE_TURNS },
      },
      { limit: 1 }
    );
  });

  it("does not filter by position, so any leadership race freezes transfers", async () => {
    const { db, countDocuments } = makeDb(0);
    await isLeadershipElectionFreezeActive(db, PARTY, 100);
    const [filter] = countDocuments.mock.calls[0] as [Record<string, unknown>];
    expect(filter).not.toHaveProperty("position");
  });

  it("scopes to this party and country", async () => {
    const { db, countDocuments } = makeDb(0);
    await isLeadershipElectionFreezeActive(db, { sequentialId: 7, countryId: "US" }, 50);
    const [filter] = countDocuments.mock.calls[0] as [Record<string, unknown>];
    expect(filter).toMatchObject({ partyId: "7", countryId: "US" });
  });

  it("freezes two turns out but not three", () => {
    // The window is endTurn <= currentTurn + 2, so an election ending on
    // turn 103 is outside it at turn 100 and inside it at turn 101.
    expect(LEADERSHIP_FREEZE_TURNS).toBe(2);
  });
});
