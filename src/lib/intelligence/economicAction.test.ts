import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { BOOKS_EXPOSED_TURNS } from "./config";
import { applyEconomicAction } from "./economicAction";

const state = {
  corps: [] as Record<string, unknown>[],
  writes: [] as Record<string, unknown>[],
  filters: [] as Record<string, unknown>[],
};

function db(): Db {
  return {
    collection: () => ({
      find: (f: Record<string, unknown>) => {
        state.filters.push(f);
        return {
          sort: () => ({ limit: () => ({ toArray: async () => state.corps }) }),
        };
      },
      updateOne: async (_f: unknown, u: Record<string, unknown>) => {
        state.writes.push(u);
      },
    }),
  } as unknown as Db;
}

beforeEach(() => {
  state.corps = [{ _id: "c1", liquidCapital: 900 }];
  state.writes = [];
  state.filters = [];
  vi.clearAllMocks();
});

describe("applyEconomicAction", () => {
  it("exposes one corporation's books until a future turn", async () => {
    const r = await applyEconomicAction(db(), "RU", 100);
    expect(r).toEqual({ corporationsExposed: 1, exposedUntilTurn: 100 + BOOKS_EXPOSED_TURNS });
    expect((state.writes[0].$set as Record<string, number>).booksExposedUntilTurn).toBe(
      100 + BOOKS_EXPOSED_TURNS
    );
  });

  it("never touches a PRIVATE company", async () => {
    // A private company is redacted outright rather than fogged. That is a
    // different rule and this operation has no business dissolving it.
    await applyEconomicAction(db(), "RU", 100);
    expect(state.filters[0]).toMatchObject({ isPrivate: { $ne: true } });
  });

  it("targets only the named country", async () => {
    await applyEconomicAction(db(), "RU", 100);
    expect(state.filters[0]).toMatchObject({ countryId: "RU" });
  });

  it("reports nothing done when the country has no listed company", async () => {
    state.corps = [];
    const r = await applyEconomicAction(db(), "RU", 100);
    expect(r).toEqual({ corporationsExposed: 0, exposedUntilTurn: null });
    expect(state.writes).toHaveLength(0);
  });

  it("sets an expiry rather than a permanent flag", async () => {
    // Expressed as a turn so the exposure lapses on its own and nothing has to
    // remember to clear it.
    const r = await applyEconomicAction(db(), "RU", 100);
    expect(r.exposedUntilTurn).toBeGreaterThan(100);
  });
});
