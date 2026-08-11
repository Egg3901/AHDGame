import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

function makeDb(counts: Record<string, number>, finds: Record<string, unknown> = {}): Db {
  const collection = (name: string) => ({
    countDocuments: vi.fn().mockResolvedValue(counts[name] ?? 0),
    findOne: vi.fn().mockResolvedValue(finds[name] ?? null),
  });
  return { collection: vi.fn().mockImplementation(collection) } as unknown as Db;
}

describe("buildCountryReadinessReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for a country with no expectations", async () => {
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    // Force a country into the type that has no expectations entry (none of the
    // current 8 countries qualify — fake by typing-cast).
    const db = makeDb({});
    const result = await buildCountryReadinessReport(db, "ZZ" as never);
    expect(result).toBeNull();
  });

  it("reports ready when all expected counts match (DE seeded fully)", async () => {
    const db = makeDb(
      {
        states: 16,
        politicalParties: 7,
        statePartyOrg: 112,
        seats: 16,
        npps: 217,
        electedOfficials: 217,
        stateDemographics: 16,
        macroMetrics: 16, // region metrics live on macroMetrics since step-6 Phase 3
        legislationTypes: 4,
        landeslisten: 50,
      },
      { governmentFormations: { _id: "DE", status: "active", cycle: 1 } }
    );
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "DE");
    expect(result).not.toBeNull();
    expect(result!.ready).toBe(true);
    expect(result!.summary.missing).toBe(0);
    expect(result!.summary.warning).toBe(0);
  });

  it("flags warnings when partial seeding is present (CN missing some rows)", async () => {
    const db = makeDb(
      {
        states: 7, // ok
        politicalParties: 1, // warning (expect ≥3)
        statePartyOrg: 0, // missing
        seats: 14, // ok
        npps: 10, // warning
        electedOfficials: 5, // warning
        stateDemographics: 7, // ok
        macroMetrics: 7, // ok
        legislationTypes: 0, // missing
        countryLeaderStates: 0,
      },
      { governmentFormations: { _id: "CN", status: "active" } }
    );
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "CN");
    expect(result).not.toBeNull();
    expect(result!.ready).toBe(false);
    expect(result!.summary.missing).toBeGreaterThanOrEqual(2);
    const partyCheck = result!.checks.find((c) => c.name === "Parties");
    expect(partyCheck?.status).toBe("warning");
  });

  it("counts legislation types by countryScope (lowercase), not countryId", async () => {
    // legislationTypes docs carry `countryScope: "cn"` (lowercase), never a
    // `countryId` field — so the diagnostic must query by countryScope or it
    // silently counts 0 for every country.
    const seenFilters: Record<string, unknown[]> = {};
    const collection = (name: string) => ({
      countDocuments: vi.fn().mockImplementation((filter: unknown) => {
        (seenFilters[name] ??= []).push(filter);
        return Promise.resolve(0);
      }),
      findOne: vi.fn().mockResolvedValue(null),
    });
    const db = { collection: vi.fn().mockImplementation(collection) } as unknown as Db;
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    await buildCountryReadinessReport(db, "CN");
    expect(seenFilters.legislationTypes).toEqual([{ countryScope: "cn" }]);
  });

  it("counts DE region metrics by countryId, not an _id prefix that matches nothing", async () => {
    // DE's macroMetrics `_id`s are bare Land codes (BW, BY, NW…), never
    // `de_`-prefixed — that prefix is the national-scope convention
    // (`de_national`). Filtering on /^de_/ matched 0 of 11 seeded rows and
    // reported the country as missing its region metrics entirely.
    const seenFilters: Record<string, unknown[]> = {};
    const collection = (name: string) => ({
      countDocuments: vi.fn().mockImplementation((filter: unknown) => {
        (seenFilters[name] ??= []).push(filter);
        return Promise.resolve(0);
      }),
      findOne: vi.fn().mockResolvedValue(null),
    });
    const db = { collection: vi.fn().mockImplementation(collection) } as unknown as Db;
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    await buildCountryReadinessReport(db, "DE");
    expect(seenFilters.macroMetrics).toEqual([{ countryId: "DE" }]);
  });

  it("expects 11 Länder on a divided-Germany preset, not the reunified 16", async () => {
    // 1953/1979 seed the 11 western Länder; the 6 eastern ones belong to DD.
    // A flat expectation of 16 reported a correct seed as incomplete.
    const db = makeDb(
      {
        states: 11,
        politicalParties: 7,
        statePartyOrg: 112,
        seats: 16,
        npps: 217,
        electedOfficials: 217,
        stateDemographics: 11,
        macroMetrics: 11,
        legislationTypes: 4,
        landeslisten: 50,
      },
      { governmentFormations: { _id: "DE", status: "active", cycle: 1 } }
    );
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "DE", "1953-default");
    expect(result).not.toBeNull();
    const byName = (n: string) => result!.checks.find((c) => c.name === n)?.status;
    expect(byName("Regions")).toBe("ok");
    expect(byName("Demographics")).toBe("ok");
    expect(byName("RegionMetrics")).toBe("ok");
  });

  it("still expects the reunified 16 on a modern preset", async () => {
    const db = makeDb(
      {
        states: 11,
        politicalParties: 7,
        statePartyOrg: 112,
        seats: 16,
        npps: 217,
        electedOfficials: 217,
        stateDemographics: 11,
        macroMetrics: 11,
        legislationTypes: 4,
        landeslisten: 50,
      },
      { governmentFormations: { _id: "DE", status: "active", cycle: 1 } }
    );
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "DE", "2019-default");
    const byName = (n: string) => result!.checks.find((c) => c.name === n)?.status;
    // 11 of an expected 16 is partial, not complete.
    expect(byName("Regions")).toBe("warning");
    expect(byName("RegionMetrics")).toBe("warning");
  });

  it("falls back to the static expectation when no preset is known", async () => {
    // The admin route may call without a preset and with no gameState doc; the
    // report must not invent a 2019 default, it must use the entry as authored.
    const db = makeDb(
      {
        states: 16,
        politicalParties: 7,
        statePartyOrg: 112,
        seats: 16,
        npps: 217,
        electedOfficials: 217,
        stateDemographics: 16,
        macroMetrics: 16,
        legislationTypes: 4,
        landeslisten: 50,
      },
      { governmentFormations: { _id: "DE", status: "active", cycle: 1 } }
    );
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "DE");
    expect(result!.checks.find((c) => c.name === "Regions")?.status).toBe("ok");
  });

  it("reports ready for Ireland when all expected counts match (post-bootstrap)", async () => {
    const db = makeDb(
      {
        states: 8,
        politicalParties: 5,
        statePartyOrg: 40, // 8 regions × 5 default parties (Phase 9)
        seats: 160,
        npps: 0,
        electedOfficials: 0,
        stateDemographics: 8,
        macroMetrics: 8,
        legislationTypes: 56,
      },
      { governmentFormations: { _id: "IE", status: "pending", cycle: 1 } }
    );
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "IE");
    expect(result).not.toBeNull();
    expect(result!.ready).toBe(true);
  });
});
