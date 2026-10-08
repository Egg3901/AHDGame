import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { countRoundTrips } from "@/lib/test-utils/roundTripCounter";
import { runInAuditContext } from "@/lib/observability/context";
import { loadWorldPreset } from "./gdpAnchorRate";

function world(preset: string) {
  const memory = createInMemoryDb();
  memory.seed("gameState", [{ _id: "current", preset }]);
  return { memory, db: memory as unknown as Db };
}

describe("loadWorldPreset inside a turn phase", () => {
  it("reads the preset once per phase", async () => {
    const w = world("1991");
    const trips = countRoundTrips(w.memory);
    const presets = await runInAuditContext("turn:7:bankingTurn", () =>
      Promise.all(Array.from({ length: 20 }, () => loadWorldPreset(w.db)))
    );
    expect(new Set(presets)).toEqual(new Set(["1991"]));
    expect(trips.total()).toBe(1);
  });

  it("reads again in the next phase, so a reset between phases is seen", async () => {
    const w = world("1991");
    expect(await runInAuditContext("turn:7:bankingTurn", () => loadWorldPreset(w.db))).toBe("1991");
    await w.db
      .collection("gameState")
      .updateOne({ _id: "current" as never }, { $set: { preset: "1953" } });
    expect(await runInAuditContext("turn:8:bankingTurn", () => loadWorldPreset(w.db))).toBe("1953");
  });

  it("never caches outside a turn phase", async () => {
    const w = world("1991");
    expect(await loadWorldPreset(w.db)).toBe("1991");
    await w.db
      .collection("gameState")
      .updateOne({ _id: "current" as never }, { $set: { preset: "1953" } });
    expect(await loadWorldPreset(w.db)).toBe("1953");
    expect(await runInAuditContext("request:abc", () => loadWorldPreset(w.db))).toBe("1953");
  });

  it("keeps worlds apart when they share a phase id", async () => {
    const a = world("1991");
    const b = world("1953");
    expect(await runInAuditContext("turn:1:x", () => loadWorldPreset(a.db))).toBe("1991");
    expect(await runInAuditContext("turn:1:x", () => loadWorldPreset(b.db))).toBe("1953");
  });
});
