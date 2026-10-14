import { describe, expect, it } from "vitest";
import { buildOwnRoutes } from "./ownRoutes";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  resolveSupplyPolicies,
  type InternalSupplyPolicy,
} from "@/lib/market/internalSupply/rules";

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
      originSupplyUnits: 60,
      destinationDemandUnits: 100,
    },
  ]);
});

it("keeps fallback origins for opted-in own supply instead of spending demand on a planned haul", () => {
  const routes = buildOwnRoutes({
    sectors,
    supplyBySector: m([
      ["mine-nv", [["coal", 100]]],
      ["mine-mn", [["coal", 200]]],
    ]),
    inputDemandBySector: m([["steel-ca", [["coal", 60]]]]),
    policies: new Map([
      ["c1", { root: "c1", policy: { priority: "own", discount: 0, ownFirstAcrossStates: true } }],
    ]),
    stateToCountry,
    hops,
  });
  expect(routes.map((r) => r.originStateId)).toEqual(["NV", "MN"]);
});

it("plans one cross-state group route across wholly owned nested subsidiaries", () => {
  const resolved = resolveSupplyPolicies([
    {
      id: "parent",
      totalShares: 100,
      holders: [{ shares: 100 }],
      policy: { priority: "group", discount: 0.1, ownFirstAcrossStates: true },
    },
    { id: "child", totalShares: 100, holders: [{ corporationId: "parent", shares: 100 }] },
    { id: "nested", totalShares: 100, holders: [{ corporationId: "child", shares: 100 }] },
    {
      id: "minority",
      totalShares: 100,
      holders: [{ corporationId: "parent", shares: 99 }, { shares: 1 }],
    },
    { id: "unrelated", totalShares: 100, holders: [{ shares: 100 }] },
  ]);
  const routes = buildOwnRoutes({
    sectors: [
      { sectorId: "parent-mine", corporationId: "parent", stateId: "MN" },
      { sectorId: "child-mine", corporationId: "child", stateId: "NV" },
      { sectorId: "nested-plant", corporationId: "nested", stateId: "CA" },
      { sectorId: "minority-plant", corporationId: "minority", stateId: "CA" },
      { sectorId: "unrelated-plant", corporationId: "unrelated", stateId: "CA" },
    ],
    supplyBySector: m([
      ["parent-mine", [["rare_earth", 40]]],
      ["child-mine", [["rare_earth", 30]]],
      ["minority-plant", [["rare_earth", 100]]],
      ["unrelated-plant", [["rare_earth", 100]]],
    ]),
    inputDemandBySector: m([
      ["nested-plant", [["rare_earth", 60]]],
      ["minority-plant", [["rare_earth", 100]]],
      ["unrelated-plant", [["rare_earth", 100]]],
    ]),
    policies: resolved,
    stateToCountry,
    hops,
  });
  expect(routes.map((route) => route.corporationId)).toEqual(["group:parent", "group:parent"]);
  expect(routes.map((route) => [route.originStateId, route.units])).toEqual([
    ["NV", 30],
    ["MN", 40],
  ]);
  expect(routes.every((route) => route.destinationDemandUnits === 60)).toBe(true);
  expect(routes.every((route) => route.ownFirstAcrossStates === true)).toBe(true);
});

it.each([
  ["disabled", { priority: "group" as const, discount: 0, ownFirstAcrossStates: false }],
  ["missing", { priority: "group" as const, discount: 0 }],
])("keeps %s group shipping on the legacy own-company route", (_label, policyValue) => {
  const policies = resolveSupplyPolicies([
    {
      id: "parent",
      totalShares: 100,
      holders: [{ shares: 100 }],
      policy: policyValue,
    },
    { id: "child", totalShares: 100, holders: [{ corporationId: "parent", shares: 100 }] },
  ]);
  const routes = buildOwnRoutes({
    sectors: [
      { sectorId: "mine", corporationId: "parent", stateId: "MN" },
      { sectorId: "own-plant", corporationId: "parent", stateId: "CA" },
      { sectorId: "child-plant", corporationId: "child", stateId: "CA" },
    ],
    supplyBySector: m([["mine", [["iron", 100]]]]),
    inputDemandBySector: m([
      ["own-plant", [["iron", 30]]],
      ["child-plant", [["iron", 60]]],
    ]),
    policies,
    stateToCountry,
    hops,
  });
  expect(routes).toEqual([
    {
      commodity: "iron",
      corporationId: "parent",
      originStateId: "MN",
      destStateId: "CA",
      units: 30,
    },
  ]);
});
