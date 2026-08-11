import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedScotus } from "@/lib/scotus/seedScotus";

describe("seedScotus identity safety", () => {
  it("creates vacant seats without copying historical officeholders into the world", async () => {
    const db = createMockDb();
    const seats = db.collection("supremeCourtSeats");
    const cases = db.collection("docketCases");
    const nominations = db.collection("scotusNominations");
    db.collectionMocks.supremeCourtSeats = seats;
    db.collectionMocks.docketCases = cases;
    db.collectionMocks.scotusNominations = nominations;

    const log = vi.fn();
    const result = await seedScotus(db as unknown as Db, log, "1953-default", true);

    expect(result.seatsSeeded).toBe(9);
    expect(seats.updateMany).toHaveBeenCalledWith(
      { countryId: "US", "historicalOccupants.0": { $exists: true } },
      expect.objectContaining({
        $set: expect.objectContaining({ historicalOccupants: [], historicalOccupantIndex: -1 }),
      })
    );
    expect(seats.updateMany).toHaveBeenCalledWith(
      { countryId: "US", justiceMode: "historical" },
      expect.objectContaining({
        $set: expect.objectContaining({ justiceMode: null, justiceName: null }),
      })
    );
    expect(seats.updateOne).toHaveBeenCalledTimes(9);
    for (const call of seats.updateOne.mock.calls) {
      const update = call[1] as {
        $setOnInsert: Record<string, unknown>;
      };
      expect(update.$setOnInsert).toMatchObject({
        justiceMode: null,
        justiceCharacterId: null,
        justiceNppId: null,
        justiceName: null,
        justiceParty: null,
        economicLean: null,
        socialLean: null,
        seatedAt: null,
        seatedAtTurn: null,
        // Fresh vacancies have diverged from nothing; the Divergence Point
        // is a live confirmation, not the seeded starting state.
        isDivergent: false,
        historicalOccupantIndex: -1,
        historicalOccupants: [],
      });
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining("9 vacant seat(s)"));
  });
});
