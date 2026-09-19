import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stubMarketizationDb } from "@/lib/test-utils/stubMarketizationDb";
import type { CountryId } from "@/lib/constants/countries";
import { bootstrapWorldsimCorporations } from "./worldsimCorporationBootstrap";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const batchSpawnNppCorporations = vi.fn();

vi.mock("@/lib/admin/spawnNppCorporation", () => ({
  // Scope under test: market economies plus the four countries from the
  // reported run. RU carries a capital here (unlike production, where it is
  // blank) so the blocked-with-capital path is exercised; DD stands in for
  // the no-capital path.
  NPP_CAPITAL_STATES: {
    US: "DC",
    UK: "LON",
    DE: "BE",
    CN: "HB",
    UKR: "UKR_KYI",
    BLR: "BLR_MIN",
    BAL: "BAL_LVA",
    RU: "MOW",
    DD: "",
  },
  batchSpawnNppCorporations: (...args: unknown[]) => batchSpawnNppCorporations(...args),
}));

const SCOPE: CountryId[] = ["US", "UK", "DE", "CN", "UKR", "BLR", "BAL", "RU", "DD"];

describe("bootstrapWorldsimCorporations", () => {
  let base: MockDb;
  let db: Db;
  let logs: string[];
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  function wire(year: number | null, levels?: Parameters<typeof stubMarketizationDb>[0]["levels"]) {
    base = createMockDb();
    base.collection("corporations");
    base.collection("gameConfig");
    db = stubMarketizationDb({ currentYear: year, levels, base: base as unknown as Db });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    logs = [];
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    batchSpawnNppCorporations.mockImplementation(async (_db: unknown, countryId: CountryId) => [
      { countryId },
    ]);
    wire(1953);
  });

  function attemptedCountries(): string[] {
    return batchSpawnNppCorporations.mock.calls.map((call) => (call as unknown[])[1] as string);
  }

  it("makes zero attempts in 1953 planned economies while seeding eligible markets", async () => {
    const result = await bootstrapWorldsimCorporations(db, {
      countryIds: SCOPE,
      perSectorCount: 3,
      log: (msg) => logs.push(msg),
    });

    const attempted = attemptedCountries();
    // The four countries from the reported run: not one spawn attempt.
    expect(attempted).not.toContain("CN");
    expect(attempted).not.toContain("UKR");
    expect(attempted).not.toContain("BLR");
    expect(attempted).not.toContain("BAL");
    expect(attempted).not.toContain("RU");
    // Eligible markets still get their coverage.
    expect(attempted).toEqual(expect.arrayContaining(["US", "UK", "DE"]));
    expect(result.skippedBlocked).toEqual(["CN", "UKR", "BLR", "BAL", "RU"]);
    expect(result.skippedNoCapital).toEqual(["DD"]);
    expect(result.countriesSeeded).toBe(3);
    // No expected-failure noise: nothing attempted, nothing refused.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toMatch(/PrivateEnterpriseBlockedError/);
  });

  it("covers every supported preset: blocked sets follow the dial, attempts follow the sets", async () => {
    const { loadPrivateEnterpriseBlockedCountries } =
      await import("@/lib/economy/queries/privateEnterpriseGate");
    for (const year of [1953, 1979, 1991, 2019]) {
      vi.clearAllMocks();
      batchSpawnNppCorporations.mockImplementation(async (_db: unknown, countryId: CountryId) => [
        { countryId },
      ]);
      wire(year);
      const result = await bootstrapWorldsimCorporations(db, {
        countryIds: SCOPE,
        perSectorCount: 3,
      });
      const authority = await loadPrivateEnterpriseBlockedCountries(db);
      const expectedBlocked = SCOPE.filter((c) => c !== "DD" && authority.has(c));
      expect(new Set(result.skippedBlocked)).toEqual(new Set(expectedBlocked));
      for (const c of expectedBlocked) {
        expect(attemptedCountries(), `${year}: ${c} must see zero attempts`).not.toContain(c);
      }
    }
  });

  it("pins the preset transitions: CN reforms out, RU stays command through 1991", async () => {
    for (const [year, cnBlocked, ruBlocked] of [
      [1953, true, true],
      [1979, false, true],
      [1991, false, true],
      [2019, false, false],
    ] as const) {
      vi.clearAllMocks();
      batchSpawnNppCorporations.mockImplementation(async (_db: unknown, countryId: CountryId) => [
        { countryId },
      ]);
      wire(year);
      const result = await bootstrapWorldsimCorporations(db, {
        countryIds: ["CN", "RU", "US"],
        perSectorCount: 3,
      });
      expect(result.skippedBlocked.includes("CN"), `${year} CN`).toBe(cnBlocked);
      expect(result.skippedBlocked.includes("RU"), `${year} RU`).toBe(ruBlocked);
      expect(attemptedCountries()).toContain("US");
    }
  });

  it("is flag-blind like the gate: commandEconomyEnabled changes nothing", async () => {
    for (const flag of [true, false]) {
      vi.clearAllMocks();
      batchSpawnNppCorporations.mockImplementation(async (_db: unknown, countryId: CountryId) => [
        { countryId },
      ]);
      wire(1953);
      base.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        commandEconomyEnabled: flag,
      });
      const result = await bootstrapWorldsimCorporations(db, {
        countryIds: SCOPE,
        perSectorCount: 3,
      });
      expect(result.skippedBlocked).toEqual(["CN", "UKR", "BLR", "BAL", "RU"]);
      expect(attemptedCountries()).toEqual(expect.arrayContaining(["US", "UK", "DE"]));
    }
  });

  it("honours transitions: a reformed persisted level releases, a stray market-economy value does not block", async () => {
    // RU persisted at 80 in 1953: converted OUT, spawn permitted.
    wire(1953, { RU: 80 });
    let result = await bootstrapWorldsimCorporations(db, {
      countryIds: ["RU"],
      perSectorCount: 3,
    });
    expect(result.skippedBlocked).toEqual([]);
    expect(attemptedCountries()).toContain("RU");

    // DE carries no marketization trajectory, so a stray persisted value is
    // noise the gate ignores: still permitted.
    vi.clearAllMocks();
    batchSpawnNppCorporations.mockImplementation(async (_db: unknown, countryId: CountryId) => [
      { countryId },
    ]);
    wire(1953, { DE: 5 });
    result = await bootstrapWorldsimCorporations(db, {
      countryIds: ["DE"],
      perSectorCount: 3,
    });
    expect(result.skippedBlocked).toEqual([]);
    expect(attemptedCountries()).toContain("DE");
  });

  it("skips countries that already have NPP corps, so a retry attempts nothing", async () => {
    base.collectionMocks.corporations!.countDocuments.mockImplementation(
      async (filter: Record<string, unknown>) => (filter.countryId === "US" ? 51 : 0)
    );
    const first = await bootstrapWorldsimCorporations(db, {
      countryIds: ["US", "UK"],
      perSectorCount: 3,
    });
    expect(first.skippedExisting).toEqual(["US"]);
    expect(attemptedCountries()).toEqual(["UK"]);

    // Retry: UK now seeded too - zero attempts anywhere.
    vi.clearAllMocks();
    base.collectionMocks.corporations!.countDocuments.mockResolvedValue(51);
    const second = await bootstrapWorldsimCorporations(db, {
      countryIds: ["US", "UK"],
      perSectorCount: 3,
    });
    expect(batchSpawnNppCorporations).not.toHaveBeenCalled();
    expect(second.skippedExisting).toEqual(["US", "UK"]);
  });

  it("leaves planned-economy corporations untouched: zero writes for blocked countries", async () => {
    await bootstrapWorldsimCorporations(db, {
      countryIds: SCOPE,
      perSectorCount: 3,
    });
    const corps = base.collectionMocks.corporations!;
    expect(corps.insertOne).not.toHaveBeenCalled();
    expect(corps.updateOne).not.toHaveBeenCalled();
    expect(corps.deleteMany).not.toHaveBeenCalled();
    expect(corps.bulkWrite).not.toHaveBeenCalled();
    // Eligibility is read-only: the only corporations reads are the
    // per-country idempotency counts for eligible countries.
    expect(corps.countDocuments).toHaveBeenCalled();
    for (const call of corps.countDocuments.mock.calls) {
      expect(["US", "UK", "DE"]).toContain((call[0] as { countryId: string }).countryId);
    }
  });

  it("lets an unrelated spawn failure fail visibly without stopping the sweep", async () => {
    batchSpawnNppCorporations.mockImplementation(async (_db: unknown, countryId: CountryId) => {
      if (countryId === "UK") throw new Error('State "LON" not found');
      return [{ countryId }];
    });
    const result = await bootstrapWorldsimCorporations(db, {
      countryIds: ["US", "UK", "DE"],
      perSectorCount: 3,
      log: (msg) => logs.push(msg),
    });
    expect(result.failures).toEqual([{ countryId: "UK", message: 'State "LON" not found' }]);
    expect(logs.join("\n")).toMatch(/UK: corp spawn failed/);
    // The failure is reported, not thrown past the caller - and the sweep
    // continues onto the remaining countries.
    expect(attemptedCountries()).toEqual(["US", "UK", "DE"]);
    expect(result.spawnedByCountry.US).toBe(1);
    expect(result.spawnedByCountry.DE).toBe(1);
  });
});
