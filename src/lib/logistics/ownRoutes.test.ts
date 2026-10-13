import { describe, expect, it } from "vitest";
import { buildOwnRoutes } from "./ownRoutes";
import type { CommodityType } from "@/lib/constants/commodities";
import type { InternalSupplyPolicy } from "@/lib/market/internalSupply/rules";

const policy = (priority: InternalSupplyPolicy["priority"]) => ({
  root: "x",
  policy: { priority, discount: 0 },
});
const m = (entries: [string, [CommodityType, number][]][]) =>
  new Map(entries.map(([id, c]) => [id, new Map(c)]));
const stateToCountry = new Map([
  ["MN", "US"],
  ["CA", "US"],
  ["NV", "US"],
  ["ON", "CA"],
]);
const HOPS: Record<string, number> = { "MN>CA": 3, "NV>CA": 1, "ON>CA": 2 };
const hops = (_c: string, from: string, to: string) =>
  from === to ? 0 : (HOPS[`${from}>${to}`] ?? null);

const sectors = [
  { sectorId: "mine-mn", corporationId: "c1", stateId: "MN" },
  { sectorId: "mine-nv", corporationId: "c1", stateId: "NV" },
  { sectorId: "steel-ca", corporationId: "c1", stateId: "CA" },
  { sectorId: "mine-on", corporationId: "c1", stateId: "ON" },
];

describe("buildOwnRoutes", () => {
  it("routes own spare output to an own plant in another state, nearest origin first", () => {
    const routes = buildOwnRoutes({
      sectors,
      supplyBySector: m([
        ["mine-mn", [["iron", 100]]],
        ["mine-nv", [["iron", 10]]],
      ]),
      inputDemandBySector: m([["steel-ca", [["iron", 30]]]]),
      policies: new Map([["c1", policy("own")]]),
      stateToCountry,
      hops,
    });
    expect(routes).toEqual([
      { commodity: "iron", corporationId: "c1", originStateId: "NV", destStateId: "CA", units: 10 },
      { commodity: "iron", corporationId: "c1", originStateId: "MN", destStateId: "CA", units: 20 },
    ]);
  });

  it("nets same-state supply first and never crosses a country", () => {
    const routes = buildOwnRoutes({
      sectors: [...sectors, { sectorId: "mine-ca", corporationId: "c1", stateId: "CA" }],
      supplyBySector: m([
        ["mine-ca", [["iron", 25]]],
        ["mine-on", [["iron", 100]]],
        ["mine-mn", [["iron", 100]]],
      ]),
      inputDemandBySector: m([["steel-ca", [["iron", 30]]]]),
      policies: new Map([["c1", policy("own")]]),
      stateToCountry,
      hops,
    });
    expect(routes).toEqual([
      { commodity: "iron", corporationId: "c1", originStateId: "MN", destStateId: "CA", units: 5 },
    ]);
  });

  it("emits nothing for market priority or other corporations' plants", () => {
    const base = {
      supplyBySector: m([["mine-mn", [["iron", 100]]]]),
      inputDemandBySector: m([["steel-ca", [["iron", 30]]]]),
      stateToCountry,
      hops,
    };
    expect(
      buildOwnRoutes({ ...base, sectors, policies: new Map([["c1", policy("market")]]) })
    ).toEqual([]);
    expect(
      buildOwnRoutes({
        ...base,
        sectors: [sectors[0]!, { sectorId: "steel-ca", corporationId: "c2", stateId: "CA" }],
        policies: new Map([
          ["c1", policy("own")],
          ["c2", policy("own")],
        ]),
      })
    ).toEqual([]);
    expect(buildOwnRoutes({ ...base, sectors, policies: new Map() })).toEqual([]);
  });

  it("never claims more than the origin's spare across several destinations", () => {
    const routes = buildOwnRoutes({
      sectors: [...sectors, { sectorId: "steel-nv", corporationId: "c1", stateId: "NV" }],
      supplyBySector: m([["mine-mn", [["iron", 40]]]]),
      inputDemandBySector: m([
        ["steel-ca", [["iron", 30]]],
        ["steel-nv", [["iron", 30]]],
      ]),
      policies: new Map([["c1", policy("group")]]),
      stateToCountry,
      hops: (_c, from, to) => (from === to ? 0 : 2),
    });
    expect(routes.reduce((n, r) => n + r.units, 0)).toBeCloseTo(40);
    expect(routes.map((r) => r.destStateId)).toEqual(["CA", "NV"]);
  });
});

it("carries the opt-in for newly founded and existing sectors while keeping own local plants supplied", () => {
  const routes = buildOwnRoutes({
    sectors: [...sectors, { sectorId: "new-plant", corporationId: "c1", stateId: "MN" }],
    supplyBySector: m([["mine-mn", [["coal", 100]]]]),
    inputDemandBySector: m([
      ["new-plant", [["coal", 40]]],
      ["steel-ca", [["coal", 100]]],
    ]),
    policies: new Map([
      [
        "c1",
        { root: "c1", policy: { priority: "own", discount: 0.1, ownFirstAcrossStates: true } },
      ],
    ]),
    stateToCountry,
    hops,
  });
  expect(routes).toEqual([
    {
      commodity: "coal",
      corporationId: "c1",
      originStateId: "MN",
      destStateId: "CA",
      units: 60,
      ownFirstAcrossStates: true,
    },
  ]);
});
