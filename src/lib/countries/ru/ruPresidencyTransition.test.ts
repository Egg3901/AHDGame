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
});
