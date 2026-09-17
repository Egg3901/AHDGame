import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

/**
 * `counts` is read as SEATS for `seats` and `electedOfficials`, and as rows for
 * everything else.
 *
 * ⚠️ THOSE TWO COLLECTIONS ARE SUMMED, NOT COUNTED. Each stores one row per
 * constituency or per (region, party) carrying a seat count, so the report
 * aggregates `totalSeats` / `seatsHeld` rather than calling `countDocuments`.
 * The numbers these tests pass were always seat counts -- DE's 16 is 16 seats --
 * so the stub answers the aggregate with the same figure and the cases keep
 * meaning what they did.
 */
function makeDb(counts: Record<string, number>, finds: Record<string, unknown> = {}): Db {
  const collection = (name: string) => ({
    countDocuments: vi.fn().mockResolvedValue(counts[name] ?? 0),
    findOne: vi.fn().mockResolvedValue(finds[name] ?? null),
    aggregate: vi.fn().mockImplementation(() => ({
      toArray: async () => [{ seats: counts[name] ?? 0 }],
    })),
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
      // `seats` and `electedOfficials` are summed, not counted, so they arrive
      // as a pipeline. Record the $match under the same key: these cases assert
      // WHICH FILTER each collection is queried with, and that has to keep
      // working whichever call shape the report uses.
      aggregate: vi.fn().mockImplementation((pipeline: Array<Record<string, unknown>>) => {
        const match = pipeline.find((stage) => "$match" in stage)?.$match;
        (seenFilters[name] ??= []).push(match);
        return { toArray: async () => [{ seats: 0 }] };
      }),
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
      // `seats` and `electedOfficials` are summed, not counted, so they arrive
      // as a pipeline. Record the $match under the same key: these cases assert
      // WHICH FILTER each collection is queried with, and that has to keep
      // working whichever call shape the report uses.
      aggregate: vi.fn().mockImplementation((pipeline: Array<Record<string, unknown>>) => {
        const match = pipeline.find((stage) => "$match" in stage)?.$match;
        (seenFilters[name] ??= []).push(match);
        return { toArray: async () => [{ seats: 0 }] };
      }),
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

  /**
   * The regression this file exists to prevent from coming back.
   *
   * ⚠ ROWS AND SEATS ARE DIFFERENT NUMBERS, and `makeDb` above cannot tell
   * them apart -- it answers `countDocuments` and the aggregate with the same
   * figure, so reverting the report to `countDocuments` would keep every case
   * above green. This one models real documents: Japan's Diet is 713 seats held
   * in 24 rows. Counting rows scores a correctly seeded Diet as 24 against an
   * expectation of 713 and reports a healthy world as broken, which is exactly
   * what it did on a live 2019 reset.
   */
  it("sums seats across grouped rows rather than counting the rows", async () => {
    // Whole seats only: a chamber never splits one between two rows.
    const spread = (total: number, rows: number, field: string) =>
      Array.from({ length: rows }, (_, i) => ({
        [field]: Math.floor(total / rows) + (i < total % rows ? 1 : 0),
      }));
    const docs: Record<string, Array<Record<string, number>>> = {
      // 8 Shugiin blocs totalling 465, 16 Sangiin blocs totalling 248.
      seats: [...spread(465, 8, "totalSeats"), ...spread(248, 16, "totalSeats")],
      // 51 + 87 party blocs holding the same 713 seats between them.
      electedOfficials: [...spread(465, 51, "seatsHeld"), ...spread(248, 87, "seatsHeld")],
    };
    const collection = (name: string) => ({
      countDocuments: vi.fn().mockResolvedValue((docs[name] ?? []).length),
      findOne: vi
        .fn()
        .mockResolvedValue(
          name === "governmentFormations" ? { _id: "JP", status: "active", cycle: 1 } : null
        ),
      aggregate: vi.fn().mockImplementation((pipeline: Array<Record<string, unknown>>) => {
        const group = pipeline.find((stage) => "$group" in stage)?.$group as
          { seats?: { $sum?: { $ifNull?: [string, number] } } } | undefined;
        const field = group?.seats?.$sum?.$ifNull?.[0]?.replace("$", "") ?? "";
        const fallback = group?.seats?.$sum?.$ifNull?.[1] ?? 1;
        const seats = (docs[name] ?? []).reduce(
          (total, doc) => total + (doc[field] ?? fallback),
          0
        );
        return { toArray: async () => [{ seats }] };
      }),
    });
    const db = { collection: vi.fn().mockImplementation(collection) } as unknown as Db;
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "JP");

    const byName = (n: string) => result!.checks.find((c) => c.name === n);
    // 713 seats, not the 24 rows holding them.
    expect(byName("Seats")?.count).toBe(713);
    expect(byName("Seats")?.status).toBe("ok");
    // 713 seats again, not the 138 party blocs.
    expect(byName("ElectedOfficials")?.count).toBe(713);
    expect(byName("ElectedOfficials")?.status).toBe("ok");
  });

  /**
   * ⚠ A MISSING COUNT MEANS ONE SEAT. Single-seat offices omit the field
   * rather than storing 1: the US Senate is 100 rows with no `totalSeats` at
   * all. A sum without the fallback scores the whole chamber as zero.
   */
  it("treats a row with no seat count as holding one seat", async () => {
    const collection = (name: string) => ({
      countDocuments: vi.fn().mockResolvedValue(0),
      findOne: vi.fn().mockResolvedValue(null),
      aggregate: vi.fn().mockImplementation((pipeline: Array<Record<string, unknown>>) => {
        const group = pipeline.find((stage) => "$group" in stage)?.$group as
          { seats?: { $sum?: { $ifNull?: [string, number] } } } | undefined;
        const fallback = group?.seats?.$sum?.$ifNull?.[1];
        // 100 Senate rows, none carrying a seat count.
        return { toArray: async () => [{ seats: name === "seats" ? 100 * (fallback ?? 0) : 0 }] };
      }),
    });
    const db = { collection: vi.fn().mockImplementation(collection) } as unknown as Db;
    const { buildCountryReadinessReport } = await import("./countryReadinessReport");
    const result = await buildCountryReadinessReport(db, "US");
    expect(result!.checks.find((c) => c.name === "Seats")?.count).toBe(100);
  });
});
