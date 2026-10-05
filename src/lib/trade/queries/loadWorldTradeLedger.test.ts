import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { loadWorldTradeLedger } from "./loadWorldTradeLedger";

function fakeDb(opts: {
  preset: string;
  overrides?: Array<{ _id: string; displayNameOverride?: string }>;
}): Db {
  const snapshot = {
    turn: 10,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    commodities: {},
    national: {
      RU: { exports: 10, imports: 5, net: 5 },
      DD: { exports: 3, imports: 4, net: -1 },
    },
    world: { grossVolume: 22, clearedVolume: 22, unclearedSurplus: 0 },
  };
  const collections: Record<string, unknown> = {
    tradeFlowSnapshots: { find: () => ({ next: async () => snapshot }) },
    gameState: { findOne: async () => ({ preset: opts.preset }) },
    countryState: { find: () => ({ toArray: async () => opts.overrides ?? [] }) },
  };
  return { collection: (name: string) => collections[name] } as unknown as Db;
}

describe("loadWorldTradeLedger country names", () => {
  it("uses the era name, so RU reads Soviet Union in a Cold War world", async () => {
    const led = await loadWorldTradeLedger(fakeDb({ preset: "1979-default" }));
    expect(led?.meta.countries.find((c) => c.code === "RU")?.name).toBe("Soviet Union");
    expect(led?.nations.find((n) => n.code === "RU")?.name).toBe("Soviet Union");
    expect(led?.meta.countries.find((c) => c.code === "DE")?.name).toBe("West Germany");
  });

  it("honors a per-world display-name override, matching Sectors", async () => {
    const led = await loadWorldTradeLedger(
      fakeDb({
        preset: "1979-default",
        overrides: [{ _id: "DD", displayNameOverride: "Germany" }],
      })
    );
    expect(led?.meta.countries.find((c) => c.code === "DD")?.name).toBe("Germany");
  });
});
