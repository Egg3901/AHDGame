import type { Db } from "mongodb";
import { expect, it, vi } from "vitest";
import type { Seat } from "@/lib/db/types";
import { buildSeatId } from "@/lib/seats";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { collectSeatIntegrity } from "@/lib/turn/gameHealthSnapshot";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { seedSeats } from "./seedSeats";

it.each(["1991-default", "2019-default"])(
  "seeds Nigeria's lower-house keys for its officials and the health check in %s",
  async (preset) => {
    const db = createMockDb();
    await seedSeats(db as unknown as Db, false, () => {}, preset);

    const operations = db.collectionMocks.seats!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: Omit<Seat, "_id"> } };
    }>;
    const houseSeats = operations
      .map(({ updateOne }) => ({ _id: updateOne.filter._id, ...updateOne.update.$set }))
      .filter((seat) => seat.countryId === "NG" && seat.electionType === "house");

    expect(houseSeats.map((seat) => seat._id).sort()).toEqual(
      ngRegions.map((region) => buildSeatId("NG", "house", region._id)).sort()
    );
    expect(operations.some(({ updateOne }) => updateOne.filter._id.startsWith("NG-chamber-"))).toBe(
      false
    );
    expect(db.collectionMocks.seats!.deleteMany).toHaveBeenCalledWith({
      countryId: "NG",
      electionType: "chamber",
    });

    const officials = ngRegions.map((region) => ({
      countryId: "NG",
      officeType: "house",
      state: region._id,
    }));
    db.collection("electedOfficials");
    db.collectionMocks.seats!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(houseSeats),
    });
    db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(officials),
    });

    expect(await collectSeatIntegrity(db as unknown as Db)).toEqual({
      orphanedOfficialCount: 0,
      seatBackedSeatsWithoutOfficials: 0,
    });
  }
);
