import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { deriveSeanadComposition } from "./seanadComposition";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

function seedParties() {
  const parties = [
    {
      _id: new ObjectId(),
      countryId: "IE",
      sequentialId: 1,
      name: "Fianna Fáil",
      color: "#0080A8",
    },
    { _id: new ObjectId(), countryId: "IE", sequentialId: 2, name: "Fine Gael", color: "#6699CC" },
    { _id: new ObjectId(), countryId: "IE", sequentialId: 3, name: "Sinn Féin", color: "#326B47" },
    { _id: new ObjectId(), countryId: "IE", sequentialId: 4, name: "Labour", color: "#CC0000" },
  ];
  db.collectionMocks["politicalParties"] = {
    ...db.collection("politicalParties"),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(parties),
      sort: vi.fn().mockReturnThis(),
    }),
  } as MockDb["collectionMocks"][string];
}

function seedDail(rows: { state: string; party: string; seatsHeld: number }[]) {
  const records = rows.map((r) => ({
    _id: new ObjectId(),
    countryId: "IE",
    officeType: "dail",
    ...r,
  }));
  db.collectionMocks["electedOfficials"] = {
    ...db.collection("electedOfficials"),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(records),
      sort: vi.fn().mockReturnThis(),
    }),
  } as MockDb["collectionMocks"][string];
}

function seedCabinet(rows: { positionId: string; party: string; confirmedAt?: Date }[]) {
  const baseDate = new Date("2026-01-01T00:00:00Z");
  const records = rows.map((r, i) => ({
    _id: new ObjectId(),
    countryId: "IE",
    positionId: r.positionId,
    characterId: new ObjectId(),
    characterName: `Minister ${i}`,
    party: r.party,
    appointedByPresidentId: new ObjectId(),
    confirmedAt: r.confirmedAt ?? new Date(baseDate.getTime() + i * 60_000),
    createdAt: baseDate,
    updatedAt: baseDate,
  }));
  // Helper sorts ascending; emulate that by sorting the seeded rows here so the
  // mock returns them in the expected order regardless of how the helper drives the cursor.
  records.sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime());
  db.collectionMocks["cabinetMembers"] = {
    ...db.collection("cabinetMembers"),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(records),
      sort: vi.fn().mockReturnThis(),
    }),
  } as MockDb["collectionMocks"][string];
}

function seedFormation(governingPartyId: string | null) {
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(governingPartyId ? { _id: "IE", governingPartyId } : null),
  } as MockDb["collectionMocks"][string];
}

describe("deriveSeanadComposition", () => {
  it("returns empty vocational + 11 loyalist-filler picks when no Dáil + no cabinet exist", async () => {
    seedParties();
    seedFormation(null);
    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.totals.seats).toBe(17); // 0 + 11 + 6
    expect(result.totals.vocational).toBe(0);
    expect(result.totals.taoiseachPicks).toBe(11);
    expect(result.totals.university).toBe(6);
    expect(result.vocational).toEqual([]);
    expect(result.taoiseachPicks).toHaveLength(11);
    expect(result.taoiseachPicks.every((p) => p.source === "loyalist_fill")).toBe(true);
    // All filler picks default to "independent" when no formation exists.
    expect(result.taoiseachPicks.every((p) => p.partyId === "independent")).toBe(true);
  });

  it("allocates the 43 vocational seats by largest remainder from Dáil composition", async () => {
    seedParties();
    seedFormation(null);
    // Dáil totals: FF 80 (50.0%), FG 60 (37.5%), SF 20 (12.5%) → 160 seats total.
    // Hamilton over 43 seats: FF 21.5 → floor 21 (remainder .5),
    // FG 16.125 → floor 16 (remainder .125), SF 5.375 → floor 5 (remainder .375).
    // Floors sum to 42; the top remainder (FF .5) takes the 43rd seat.
    seedDail([
      { state: "DUB", party: "1", seatsHeld: 80 },
      { state: "KIL", party: "2", seatsHeld: 60 },
      { state: "MID", party: "3", seatsHeld: 20 },
    ]);

    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.totals.vocational).toBe(43);
    const ff = result.vocational.find((v) => v.partyId === "1");
    const fg = result.vocational.find((v) => v.partyId === "2");
    const sf = result.vocational.find((v) => v.partyId === "3");
    expect(ff?.seats).toBe(22);
    expect(fg?.seats).toBe(16);
    expect(sf?.seats).toBe(5);
    expect((ff?.seats ?? 0) + (fg?.seats ?? 0) + (sf?.seats ?? 0)).toBe(43);
  });

  it("aggregates multiple electedOfficials rows of the same party across regions", async () => {
    seedParties();
    seedFormation(null);
    seedDail([
      { state: "DUB", party: "1", seatsHeld: 30 },
      { state: "KIL", party: "1", seatsHeld: 50 },
      { state: "MID", party: "2", seatsHeld: 80 },
    ]);

    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.totals.vocational).toBe(43);
    const ff = result.vocational.find((v) => v.partyId === "1");
    const fg = result.vocational.find((v) => v.partyId === "2");
    expect(ff?.seats).toBe(22);
    expect(fg?.seats).toBe(21);
  });

  it("returns 11 cabinet members as Taoiseach picks when seated, sorted by confirmedAt", async () => {
    seedParties();
    seedFormation(null);
    seedCabinet(
      Array.from({ length: 11 }, (_, i) => ({
        positionId: `pos_${i}`,
        party: i < 6 ? "1" : "2",
      }))
    );

    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.taoiseachPicks).toHaveLength(11);
    expect(result.taoiseachPicks.every((p) => p.source === "cabinet")).toBe(true);
    // First six were seeded with party=1 (FF), next five with party=2 (FG).
    expect(result.taoiseachPicks.filter((p) => p.partyId === "1")).toHaveLength(6);
    expect(result.taoiseachPicks.filter((p) => p.partyId === "2")).toHaveLength(5);
  });

  it("fills remaining slots with governing party loyalists when cabinet has fewer than 11 members", async () => {
    seedParties();
    seedCabinet(Array.from({ length: 5 }, (_, i) => ({ positionId: `pos_${i}`, party: "2" })));
    seedFormation("2"); // Fine Gael governing

    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.taoiseachPicks).toHaveLength(11);
    expect(result.taoiseachPicks.filter((p) => p.source === "cabinet")).toHaveLength(5);
    expect(result.taoiseachPicks.filter((p) => p.source === "loyalist_fill")).toHaveLength(6);
    // All 11 picks should be Fine Gael (cabinet members + fill from governing party).
    expect(result.taoiseachPicks.filter((p) => p.partyId === "2")).toHaveLength(11);
  });

  it("caps cabinet picks at 11 even if more cabinet members exist", async () => {
    seedParties();
    seedFormation(null);
    seedCabinet(
      Array.from({ length: 19 }, (_, i) => ({
        positionId: `pos_${i}`,
        party: "1",
      }))
    );

    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.taoiseachPicks).toHaveLength(11);
    expect(result.taoiseachPicks.every((p) => p.source === "cabinet")).toBe(true);
  });

  it("always returns 6 university seats", async () => {
    seedParties();
    seedFormation(null);
    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.university.seats).toBe(6);
    expect(result.totals.university).toBe(6);
  });

  it("produces 60 total seats when the Dáil is fully seated and cabinet has 11+ members", async () => {
    seedParties();
    seedFormation(null);
    seedDail([{ state: "DUB", party: "1", seatsHeld: 160 }]);
    seedCabinet(Array.from({ length: 15 }, (_, i) => ({ positionId: `pos_${i}`, party: "1" })));

    const result = await deriveSeanadComposition(db as unknown as Db, "IE");
    expect(result.totals.seats).toBe(60);
    expect(result.totals.vocational).toBe(43);
    expect(result.totals.taoiseachPicks).toBe(11);
    expect(result.totals.university).toBe(6);
  });
});
