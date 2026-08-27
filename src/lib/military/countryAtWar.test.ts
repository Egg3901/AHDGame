import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { loadCountryWarNotice } from "./countryAtWar";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const war = (over: Record<string, unknown> = {}) => ({
  _id: "war_us_dd_415",
  conflictId: 2,
  name: "The War for Germany",
  status: "active",
  startTurn: 415,
  hostCountry: "DD",
  hostEntities: ["DD", "DE"],
  sideA: { label: "United States", countries: ["US"] },
  sideB: { label: "East Germany", countries: ["DD", "RU"] },
  ...over,
});

describe("loadCountryWarNotice", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  const rows = (list: unknown[]) =>
    prime(db, "conflicts").find.mockReturnValue({ toArray: async () => list });

  it("says nothing in peacetime", async () => {
    rows([]);
    expect(await loadCountryWarNotice(db as unknown as Db, "UK")).toBeNull();
  });

  it("names the war and its number for a belligerent", async () => {
    rows([war()]);
    const notice = await loadCountryWarNotice(db as unknown as Db, "RU");
    expect(notice).toMatchObject({
      count: 1,
      conflictNumber: 2,
      name: "The War for Germany",
      hostOnly: false,
    });
  });

  it("asks the database for the widened host roster, not just the anchor", async () => {
    rows([war()]);
    await loadCountryWarNotice(db as unknown as Db, "DE");
    // West Germany is neither a belligerent nor the map anchor of the war for
    // Germany, but the war IS fought over its soil. `hostCountry` alone would
    // leave its pages saying nothing at all.
    const filter = prime(db, "conflicts").find.mock.calls[0][0] as { $or: unknown[] };
    expect(filter.$or).toContainEqual({ hostEntities: "DE" });
  });

  it("marks a country that is only the ground", async () => {
    rows([war()]);
    const notice = await loadCountryWarNotice(db as unknown as Db, "DE");
    expect(notice?.hostOnly).toBe(true);
  });

  it("counts several wars and refuses to feature one of them", async () => {
    rows([war(), war({ _id: "w2", conflictId: 3, name: "Another War", startTurn: 420 })]);
    const notice = await loadCountryWarNotice(db as unknown as Db, "RU");
    expect(notice).toMatchObject({ count: 2, conflictNumber: null, name: null });
  });

  it("features the OLDEST war, so the banner does not change on a reload", async () => {
    rows([
      war({ startTurn: 500, conflictId: 9 }),
      war({ _id: "w2", conflictId: 4, startTurn: 100 }),
    ]);
    const notice = await loadCountryWarNotice(db as unknown as Db, "RU");
    // Two wars means no featured number either way; the ordering is what makes
    // `hostOnly` and any future first-war field deterministic.
    expect(notice?.count).toBe(2);
  });

  it("offers no number for a war that has none", async () => {
    rows([war({ conflictId: undefined })]);
    const notice = await loadCountryWarNotice(db as unknown as Db, "RU");
    // A dead link is worse than no link; the banner falls back to the board.
    expect(notice?.conflictNumber).toBeNull();
  });

  it("excludes resolved wars in the query", async () => {
    rows([war()]);
    await loadCountryWarNotice(db as unknown as Db, "RU");
    const filter = prime(db, "conflicts").find.mock.calls[0][0] as { status: unknown };
    expect(filter.status).toEqual({ $ne: "resolved" });
  });
});
