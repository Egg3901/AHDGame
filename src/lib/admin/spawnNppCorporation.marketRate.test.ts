/**
 * The default founding treasury is ~₳2M (era-scaled) at the world's MARKET rate.
 *
 * It used to divide by the GDP normalization factor, which equals the market
 * rate only where authored GDP is denominated at it. In 1991 that handed a
 * Nigerian spawn 3.125B NGN (about 158 times the intended value) and in 1953 a
 * Japanese spawn 2M yen (about 0.003 times). See #2985.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { getEraNominalScale } from "@/lib/constants/sectorSeedEra";
import { COUNTRY_CURRENCY_MAP, eraRateForCurrency } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  NPP_DEFAULT_STARTING_CAPITAL_ANCHOR,
  spawnNppCorporation,
} from "@/lib/admin/spawnNppCorporation";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
// Identity and CEO selection carry no cash.
vi.mock("@/lib/npp/generator", () => ({
  createNPP: vi.fn(async () => ({ _id: new ObjectId(), name: "Fixture NPP" })),
}));
vi.mock("@/lib/admin/nppCorpCeoSelection", () => ({
  buildCeoAffiliations: vi.fn().mockReturnValue([]),
  chooseNppCorpCeo: vi.fn().mockReturnValue({ kind: "new", party: null }),
}));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn().mockResolvedValue(42) }));
vi.mock("@/lib/corporations/tickerSymbol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/corporations/tickerSymbol")>()),
  generateTickerSymbol: vi.fn().mockResolvedValue("SPWN"),
}));

let db: Db;

async function world(preset: string, countryId: CountryId, rates: Record<string, number> = {}) {
  db = createInMemoryDb() as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 2, preset });
  const rows = Object.entries(rates).map(([currencyCode, rate]) => ({ currencyCode, rate }));
  if (rows.length > 0) await db.collection("exchangeRates").insertMany(rows);
  await db
    .collection<{ _id: string; countryId: string }>("states")
    .insertOne({ _id: `${countryId}-HQ`, countryId });
}

async function spawn(countryId: CountryId, capital?: number) {
  const result = await spawnNppCorporation(db, {
    name: `Fixture ${countryId}`,
    type: "technology",
    countryId,
    headquartersState: `${countryId}-HQ`,
    ...(capital === undefined ? {} : { startingCapital: capital }),
  });
  return result.startingCapital;
}

const intendedAnchor = (preset: string) =>
  NPP_DEFAULT_STARTING_CAPITAL_ANCHOR * getEraNominalScale(preset);

const seededRate = (preset: string, countryId: CountryId) =>
  eraRateForCurrency(COUNTRY_CURRENCY_MAP[countryId], preset)!;

// Every preset's worst offenders under the GDP-factor conversion, with the
// multiple of the intended value each used to receive at its seeded rate.
const MISPRICED: ReadonlyArray<[preset: string, countryId: CountryId, oldMultiple: number]> = [
  ["1953-default", "NG", 2.8],
  ["1953-default", "JP", 0.003],
  ["1953-default", "IT", 0.002],
  ["1979-default", "NG", 2604],
  ["1979-default", "UK", 2.13],
  ["1979-default", "JP", 0.48],
  ["1991-default", "NG", 158],
  ["1991-default", "YU", 1.34],
  ["1991-default", "PL", 0.003],
  ["1991-default", "BG", 0.035],
  ["1991-default", "RO", 0.13],
  ["2019-default", "UK", 1.33],
  ["2019-default", "RU", 0.33],
  ["2027-default", "SCO", 1.33],
  ["2027-default", "RU", 0.33],
];

describe("spawned corporation default treasury", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(MISPRICED)(
    "gives a %s %s spawn the intended anchor value (was %sx)",
    async (preset, countryId) => {
      await world(preset, countryId);
      const rate = seededRate(preset, countryId);
      const local = await spawn(countryId);
      expect(local).toBe(Math.round(intendedAnchor(preset) * rate));
      expect(local / rate / intendedAnchor(preset)).toBeCloseTo(1, 3);
    }
  );

  it("converts at the live rate once the market has moved off the seeded one", async () => {
    await world("1991-default", "NG", { NGN: 10.75 });
    expect(seededRate("1991-default", "NG")).not.toBe(10.75);
    const local = await spawn("NG");
    expect(local).toBe(Math.round(intendedAnchor("1991-default") * 10.75));
    // The GDP-factor conversion this replaces gave 3,125,000,000 NGN.
    expect(local).toBeLessThan(25_000_000);
  });

  it("is unchanged where the GDP factor already equals the market rate", async () => {
    await world("2019-default", "US", { USD: 1 });
    expect(await spawn("US")).toBe(NPP_DEFAULT_STARTING_CAPITAL_ANCHOR);
  });

  it("keeps an explicit capital literal", async () => {
    await world("1991-default", "NG", { NGN: 10.75 });
    expect(await spawn("NG", 123_456)).toBe(123_456);
  });
});
