import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedScotus } from "@/lib/scotus/seedScotus";

describe("seedScotus Original Roster", () => {
  it("seats historical justices from the preset succession chain", async () => {
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
    expect(seats.updateMany).not.toHaveBeenCalled();
    expect(seats.updateOne).toHaveBeenCalledTimes(9);
    for (const call of seats.updateOne.mock.calls) {
      const update = call[1] as {
        $setOnInsert: Record<string, unknown>;
      };
      expect(update.$setOnInsert).toMatchObject({
        justiceMode: "historical",
        justiceCharacterId: null,
        justiceNppId: null,
        isDivergent: false,
        historicalOccupantIndex: 0,
      });
      expect(update.$setOnInsert.justiceName).toEqual(expect.any(String));
      expect(Array.isArray(update.$setOnInsert.historicalOccupants)).toBe(true);
      expect((update.$setOnInsert.historicalOccupants as unknown[]).length).toBeGreaterThan(0);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining("9 Original Roster seat(s)"));
  });
});
