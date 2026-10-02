/**
 * Roster application: `seedFromSeats` with a rostered `presetId` seats real
 * officeholders (name, birth year, portrait) instead of generated identities,
 * and leaves unrostered seats on the generated path.
 *
 * Pinned against real compiled keys (CA 1991 delegation, post Senate-label
 * audit: class 1 is Republican Seymour, class 3 is Democrat Cranston), so a
 * key-scheme change that silently unseats the roster trips here rather than
 * shipping a world of fictional names with a green suite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedFromSeats } from "@/lib/npp/seedHistorical";
import { seatGroupsFor, type HistoricalSeat } from "@/lib/constants/historicalSeats";
import { buildSeatId } from "@/lib/seats";
import { collectSeatIntegrity } from "@/lib/turn/gameHealthSnapshot";
import type { Db } from "mongodb";

vi.mock("@/lib/db/sequentialId", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/sequentialId")>();
  let n = 1000;
  return {
    ...actual,
    reserveSequentialIds: vi.fn(async (_db: unknown, _type: unknown, count: number) =>
      Array.from({ length: count }, () => ++n)
    ),
  };
});

const STATES = [{ _id: "CA", countryId: "US" }];

// Mirrors fixed 1991 CA delegation rows: class 1 Republican (Seymour),
// class 3 Democrat (Cranston), House Republican bloc (Moorhead).
const SEATS: HistoricalSeat[] = [
  { state: "CA", officeType: "senate", party: "republican", senateClass: 1 },
  { state: "CA", officeType: "senate", party: "democrat", senateClass: 3 },
  { state: "CA", officeType: "house", party: "republican", seatsHeld: 5 },
  // No roster entry for this tuple — stays on the generated path.
  { state: "CA", officeType: "house", party: "green", seatsHeld: 1 },
];

function statefulDb(): {
  db: MockDb;
  officials: Array<Record<string, unknown>>;
  npps: Array<Record<string, unknown>>;
} {
  const db = createMockDb();
  const officials: Array<Record<string, unknown>> = [];
  const npps: Array<Record<string, unknown>> = [];

  db.collection("states");
  db.collectionMocks["states"].find = vi.fn().mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(STATES),
  });

  const nppsCol = db.collection("npps");
  nppsCol.find = vi.fn().mockImplementation(() => ({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(npps.filter((n) => n.retiredAt == null)),
  }));
  nppsCol.insertMany = vi.fn().mockImplementation(async (docs: Array<Record<string, unknown>>) => {
    npps.push(...docs);
    return { insertedIds: {} };
  });
  nppsCol.aggregate = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });

  const officialsCol = db.collection("electedOfficials");
  officialsCol.insertMany = vi
    .fn()
    .mockImplementation(async (docs: Array<Record<string, unknown>>) => {
      officials.push(...docs);
      return { insertedIds: {} };
    });
  officialsCol.aggregate = vi.fn().mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });

  const partiesCol = db.collection("politicalParties");
  partiesCol.findOne = vi.fn().mockResolvedValue(null);

  return { db, officials, npps };
}

describe("seedFromSeats historical roster", () => {
  let ctx: ReturnType<typeof statefulDb>;

  beforeEach(() => {
    ctx = statefulDb();
  });

  it("seats real officeholders with birth years on rostered presets", async () => {
    const result = await seedFromSeats(ctx.db as unknown as Db, SEATS, "winners", {
      presetId: "1991-default",
    });

    expect(result.nppsCreated).toBe(4);
    expect(result.officialsCreated).toBe(4);

    const byName = new Map(ctx.npps.map((n) => [n.name, n]));
    expect(byName.get("John Seymour")).toMatchObject({ birthYear: 1937, gender: "male" });
    expect(byName.get("Alan Cranston")).toMatchObject({ birthYear: 1914 });
    expect(byName.get("Carlos Moorhead")).toMatchObject({ birthYear: 1922 });

    // Officials carry the real names.
    const officialNames = new Set(ctx.officials.map((o) => o.characterName));
    expect(officialNames).toContain("John Seymour");
    expect(officialNames).toContain("Alan Cranston");
    expect(officialNames).toContain("Carlos Moorhead");

    // The unrostered tuple stays generated: fictional name, no birth year.
    const generated = ctx.npps.filter(
      (n) => n.name !== "John Seymour" && n.name !== "Alan Cranston" && n.name !== "Carlos Moorhead"
    );
    expect(generated).toHaveLength(1);
    expect(generated[0]).not.toHaveProperty("birthYear");
  });

  it("ignores the roster without a presetId (backfill-safe)", async () => {
    await seedFromSeats(ctx.db as unknown as Db, SEATS, "winners");

    const names = ctx.npps.map((n) => n.name);
    expect(names).not.toContain("John Seymour");
    expect(names).not.toContain("Alan Cranston");
    expect(ctx.npps.every((n) => !("birthYear" in n))).toBe(true);
  });

  it.each([
    ["1991-default", "Mary Robinson", 1944],
    ["2019-default", "Michael D. Higgins", 1941],
  ])("seats the documented Irish Uachtarán at %s opening", async (preset, name, birthYear) => {
    const presidentialSeats = seatGroupsFor(preset).IE!.filter(
      (seat) => seat.officeType === "uachtaran"
    );
    expect(presidentialSeats).toEqual([{ state: "IE", officeType: "uachtaran", party: "ie_ind" }]);

    const result = await seedFromSeats(ctx.db as unknown as Db, presidentialSeats, "winners", {
      presetId: preset,
    });
    expect(result).toMatchObject({ nppsCreated: 1, officialsCreated: 1 });
    expect(ctx.npps).toHaveLength(1);
    expect(ctx.npps[0]).toMatchObject({
      name,
      birthYear,
      countryId: "IE",
      currentOffice: { type: "uachtaran" },
    });
    expect(ctx.officials).toHaveLength(1);
    expect(ctx.officials[0]).toMatchObject({
      countryId: "IE",
      officeType: "uachtaran",
      state: "IE",
      characterName: name,
    });

    const seatId = buildSeatId("IE", "uachtaran", "IE");
    ctx.db.collection("seats");
    ctx.db.collectionMocks.seats!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: seatId, countryId: "IE", electionType: "uachtaran", state: "IE" },
        ]),
    });
    ctx.db.collectionMocks.electedOfficials!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(ctx.officials),
    });
    expect(await collectSeatIntegrity(ctx.db as unknown as Db)).toEqual({
      orphanedOfficialCount: 0,
      seatBackedSeatsWithoutOfficials: 0,
    });
  });

  it.each(["1999-default", "2007-default"])(
    "does not back-project the 2019 presidential roster into %s",
    (preset) => {
      expect(seatGroupsFor(preset).IE!.some((seat) => seat.officeType === "uachtaran")).toBe(false);
    }
  );
});
