import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { buildCoalitionSide } from "../battleSides";
import { unit, FRONTS_MAP } from "./battleFixtures";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { CountryId } from "@/lib/constants/countries";

vi.mock("@/lib/db/collections/militaryFormations", () => ({
  getMilitaryFormations: vi.fn(async (_db: Db, country: string) => ({
    conflictAssignments: [
      { theaterId: "afghan", generalCharacterId: `g-${country}`, inCharge: false },
    ],
    positions: { [`p-${country}`]: "support" },
  })),
}));
vi.mock("@/lib/db/collections/nationalDoctrine", () => ({
  getNationalDoctrine: vi.fn(async () => ({ adopted: {} })),
}));
vi.mock("@/lib/db/collections/characterGenerals", () => ({
  loadGeneralsById: vi.fn(async (_db: Db, country: string) => ({ [`g-${country}`]: {} })),
}));
vi.mock("@/lib/db/collections/militaryCommands", () => ({
  getMilitaryCommands: vi.fn(async (_db: Db, country: string) =>
    country === "US"
      ? [
          {
            id: "logistics-us",
            name: "US Logistics Command",
            type: "LOGISTICS",
            commanderIds: ["g-US"],
            commandingGeneralId: "g-US",
            regionIds: ["afghan"],
            spec: "Logistics",
            posture: "Expeditionary",
            supply: "High",
            readiness: "Ready",
            cap: 20,
            base: 100,
            political: "Low",
            branchFocus: "Combined",
            unitIds: [],
            role: "Supply the front",
          },
        ]
      : []
  ),
}));

const db = {} as Db;
const u = (country: string) =>
  [unit({ countryId: country as CountryId })] as unknown as MilitaryUnit[];

beforeEach(() => vi.clearAllMocks());

describe("buildCoalitionSide", () => {
  it("builds one contingent per country, in the order given", async () => {
    const sides = await buildCoalitionSide(
      db,
      ["US", "UK"],
      new Map([
        ["US", u("US")],
        ["UK", u("UK")],
      ]),
      FRONTS_MAP,
      55
    );
    expect(sides).toHaveLength(2);
    expect(sides.map((s) => s.country)).toEqual(["US", "UK"]);
  });

  it("gives each contingent its OWN org and generals, not the leader's", async () => {
    const sides = await buildCoalitionSide(
      db,
      ["US", "UK"],
      new Map([
        ["US", u("US")],
        ["UK", u("UK")],
      ]),
      FRONTS_MAP
    );
    expect(sides[0].assignments[0].generalCharacterId).toBe("g-US");
    expect(sides[1].assignments[0].generalCharacterId).toBe("g-UK");
    expect(Object.keys(sides[0].generalsById)).toEqual(["g-US"]);
    expect(Object.keys(sides[1].generalsById)).toEqual(["g-UK"]);
  });

  it("hands every contingent the same supply — it is a per-side figure", async () => {
    const sides = await buildCoalitionSide(
      db,
      ["US", "UK"],
      new Map([
        ["US", u("US")],
        ["UK", u("UK")],
      ]),
      FRONTS_MAP,
      42
    );
    expect(sides.every((s) => s.conflictSupply === 42)).toBe(true);
  });

  it("loads each country's Logistics-command coverage into its battle side", async () => {
    const sides = await buildCoalitionSide(db, ["US"], new Map([["US", u("US")]]), FRONTS_MAP);

    expect(sides[0].logisticsCoverageByRegion).toEqual({ afghan: 1 });
  });

  it("gives a country with no units an empty contingent rather than dropping it", async () => {
    // A declared ally whose units are all elsewhere still belongs on the roster.
    const sides = await buildCoalitionSide(
      db,
      ["US", "UK"],
      new Map([["US", u("US")]]),
      FRONTS_MAP
    );
    expect(sides).toHaveLength(2);
    expect(sides[1].units).toEqual([]);
  });

  it("returns an empty coalition for no countries", async () => {
    expect(await buildCoalitionSide(db, [], new Map(), FRONTS_MAP)).toEqual([]);
  });
});
