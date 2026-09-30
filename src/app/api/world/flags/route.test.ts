import { planEuroSettlement } from "@/lib/currency/euro/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { GET } from "./route";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("world euro flags", () => {
  let db: ReturnType<typeof createMockDb>;
  beforeEach(() => {
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: async () => ["DE", "IE", "UK"].map((countryId) => ({ countryId })),
    });
  });
  it("opens eligible decisions at the date without displaying pending consents as membership", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1999,
      preset: "1991-default",
      eurozoneEnabled: false,
      euroAdoptedCountries: ["DE"],
    });
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const flags = await response.json();
    expect(flags.euroAdoptionEligibleCountries).toEqual(expect.arrayContaining(["UK", "IE"]));
    expect(flags.euroAdoptionEligibleCountries).not.toContain("DE");
    expect(flags.euroMemberCurrencies).toEqual([]);
  });
  it("keeps an early world's adoption decisions closed", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1991,
      eurozoneEnabled: false,
    });
    expect((await (await GET()).json()).euroAdoptionEligibleCountries).toEqual([]);
  });
  it("preserves legacy euro membership without including the UK automatically", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 2019,
      eurozoneEnabled: true,
    });
    const flags = await (await GET()).json();
    expect(flags.euroMemberCurrencies).toEqual(expect.arrayContaining(["EUR", "IEP"]));
    expect(flags.euroMemberCurrencies).not.toContain("GBP");
    expect(flags.euroAdoptionEligibleCountries).toContain("UK");
  });
});

it("publishes settled conversion terms for purchase quotations", async () => {
  const db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const union = planEuroSettlement({
    year: 1999,
    turn: 385,
    preset: "1991-default",
    europeanMembers: ["DE", "IE", "UK"],
    consentedCountries: ["DE", "IE", "UK"],
    rates: { EUR: 0.8, IEP: 0.7, GBP: 0.6 },
  }).union;
  db.collection("gameState").findOne.mockResolvedValue({
    currentYear: 1999,
    eurozoneEnabled: true,
    euroMonetaryUnion: union,
  });
  expect((await (await GET()).json()).euroMonetaryUnion).toEqual(union);
});

it("does not offer euro adoption in an unratified Community after 1999", async () => {
  const db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("gameState").findOne.mockResolvedValue({
    currentYear: 1999,
    currentTurn: 385,
    startingYear: 1991,
    eurozoneEnabled: false,
    europeanIntegration: {
      stage: "community",
      source: "historical-seed",
      establishedTurn: 1,
      ratifications: {},
    },
  });
  db.collection("organizationMemberships").find.mockReturnValue({
    toArray: async () => ["DE", "IE", "UK"].map((countryId) => ({ countryId })),
  });
  const flags = await (await GET()).json();
  expect(flags.euroAdoptionEligibleCountries).toEqual([]);
  expect(flags.maastrichtEligibleCountries).toContain("UK");
});

describe("world campaign pricing flag", () => {
  it.each([true, false, undefined])(
    "exposes the effective price scalar for flag %s",
    async (enabled) => {
      const db = createMockDb();
      db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default" });
      db.collection("gameConfig").findOne.mockResolvedValue({
        campaignEraPriceLevelEnabled: enabled,
      });
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
      const data = await (await GET()).json();
      expect(data.campaignPriceLevel).toBe(enabled ? 0.35808 : 1);
    }
  );
});
