import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { processRuPresidencyTransition } from "./ruPresidencyTransition";

describe("Russian 1991 presidential office transition", () => {
  it("waits for the July inauguration and respects a pinned founding calendar", async () => {
    const db = { collection: vi.fn() } as unknown as Db;
    const now = new Date("2026-01-01T00:00:00Z");
    expect(await processRuPresidencyTransition(db, { preset: "1979-default" }, 25, now)).toBe(
      false
    );
    expect(await processRuPresidencyTransition(db, { preset: "1991-default" }, 24, now)).toBe(
      false
    );
    expect(
      await processRuPresidencyTransition(
        db,
        { preset: "1991-default", preIteration: { active: true, startedTurn: 1 } },
        100,
        now
      )
    ).toBe(false);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("retires only the Chairman and records the office change once", async () => {
    const writes: Array<[string, unknown]> = [];
    let marked = false;
    let ratified = false;
    const db = {
      collection: (name: string) => ({
        findOne: async () =>
          name === "countryGameStates"
            ? {
                _id: "RU",
                ...(ratified
                  ? { ruSovietSuccessionSinceTurn: 24, ruPresidencyMandateSinceTurn: 25 }
                  : {}),
                ...(marked ? { ruPresidencySinceTurn: 25 } : {}),
              }
            : null,
        deleteMany: async (filter: unknown) => {
          writes.push([name, filter]);
        },
        updateOne: async (filter: unknown) => {
          writes.push([name, filter]);
          if (name === "countryGameStates") marked = true;
        },
        updateMany: async (filter: unknown) => {
          writes.push([name, filter]);
        },
      }),
    } as unknown as Db;
    const now = new Date("2026-01-01T00:00:00Z");
    expect(await processRuPresidencyTransition(db, { preset: "1991-default" }, 25, now)).toBe(
      false
    );
    expect(writes).toHaveLength(0);
    ratified = true;
    expect(await processRuPresidencyTransition(db, { preset: "1991-default" }, 25, now)).toBe(true);
    expect(await processRuPresidencyTransition(db, { preset: "1991-default" }, 26, now)).toBe(
      false
    );
    expect(writes).toContainEqual([
      "electedOfficials",
      { countryId: "RU", officeType: "chairmanOfSupremeSoviet" },
    ]);
    expect(writes.filter(([name]) => name === "countryGameStates")).toHaveLength(1);
  });
});
