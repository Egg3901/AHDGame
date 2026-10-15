import { describe, expect, it } from "vitest";
import {
  allocateInternalSupply,
  internalSupplyAvailability,
  internalSupplyDiscounts,
  settleConsumedInternalDiscounts,
  resolveSupplyPolicies,
  ownRouteGroupRoot,
  recordedGroupRouteMembers,
  type SupplyOwner,
} from "./rules";

const policy = { priority: "group" as const, discount: 0.1 };
const owners: SupplyOwner[] = [
  { id: "parent", totalShares: 100, holders: [{ shares: 100 }], policy },
  { id: "child", totalShares: 100, holders: [{ corporationId: "parent", shares: 100 }] },
  { id: "nested", totalShares: 100, holders: [{ corporationId: "child", shares: 100 }] },
  {
    id: "minority",
    totalShares: 100,
    holders: [{ corporationId: "parent", shares: 99 }, { shares: 1 }],
  },
];
const policies = resolveSupplyPolicies(owners);
function allocate(overrides: Partial<Parameters<typeof allocateInternalSupply>[0]> = {}) {
  return allocateInternalSupply({
    sellers: [{ sectorId: "mine", corporationId: "parent", units: 60 }],
    buyers: [
      { sectorId: "own", corporationId: "parent", demand: 40, availability: 0.6 },
      { sectorId: "sub", corporationId: "nested", demand: 40, availability: 0.6 },
      { sectorId: "public", corporationId: "minority", demand: 20, availability: 0.6 },
    ],
    policies,
    supply: 60,
    demand: 100,
    reservationRoom: 100,
    ...overrides,
  });
}
describe("own-group commodity priority", () => {
  it("inherits through full ownership, excludes minority holdings and resets after sale", () => {
    expect(policies.get("nested")?.root).toBe("parent");
    expect(policies.get("minority")?.policy.priority).toBe("market");
    expect(
      resolveSupplyPolicies(
        owners.map((o) =>
          o.id === "child"
            ? { ...o, holders: [{ corporationId: "parent", shares: 99 }, { shares: 1 }] }
            : o
        )
      ).get("nested")?.policy.priority
    ).toBe("market");
  });
  it("rejects self ownership, malformed ownership and circular groups", () => {
    const cycle = resolveSupplyPolicies([
      { id: "a", totalShares: 1, holders: [{ corporationId: "b", shares: 1 }], policy },
      { id: "b", totalShares: 1, holders: [{ corporationId: "a", shares: 1 }], policy },
    ]);
    expect([...cycle.values()].every((p) => p.policy.priority === "market")).toBe(true);
    expect(
      resolveSupplyPolicies([
        { id: "a", totalShares: Infinity, holders: [{ shares: Infinity }] },
      ]).get("a")?.policy.priority
    ).toBe("market");
  });
  it("fills own demand first, then the full-owned group, without minting supply", () => {
    const r = allocate();
    expect(r.trades.map((t) => [t.buyerSectorId, t.units])).toEqual([
      ["own", 40],
      ["sub", 20],
    ]);
    expect(r.availabilityBySector.get("own")).toBe(1);
    expect(r.availabilityBySector.get("sub")).toBe(0.5);
    expect(r.availabilityBySector.get("public")).toBe(0);
    expect(r.trades.reduce((n, t) => n + t.units, 0)).toBe(60);
  });
  it("respects explicit commitments, buyer demand and reservation room", () => {
    const r = allocate({
      sellers: [{ sectorId: "mine", corporationId: "parent", units: 60, committed: 50 }],
      reservationRoom: 10,
    });
    expect(r.trades.reduce((n, t) => n + t.units, 0)).toBe(10);
    expect(
      allocate({
        buyers: [
          {
            sectorId: "own",
            corporationId: "parent",
            demand: 40,
            committed: 40,
            availability: 0.6,
          },
        ],
      }).trades
    ).toEqual([]);
  });
  it("shares scarce output across plants and is independent of row order", () => {
    const buyers = [
      { sectorId: "a", corporationId: "parent", demand: 100, availability: 0.3 },
      { sectorId: "b", corporationId: "parent", demand: 100, availability: 0.3 },
    ];
    const a = allocate({ buyers, demand: 200 });
    expect(a.trades.map((t) => t.units)).toEqual([30, 30]);
    expect(allocate({ buyers: [...buyers].reverse(), demand: 200 }).trades).toEqual(a.trades);
  });
  it("leaves surplus unreserved and market mode inert", () => {
    expect(
      allocate({
        buyers: [{ sectorId: "own", corporationId: "parent", demand: 10, availability: 1 }],
      }).trades.reduce((n, t) => n + t.units, 0)
    ).toBe(10);
    expect(
      allocate({
        policies: resolveSupplyPolicies(owners.map((o) => ({ ...o, policy: undefined }))),
      }).trades
    ).toEqual([]);
    expect(allocate({ supply: 0 }).trades).toEqual([]);
  });
  it("does not produce NaN or phantom units from invalid offers", () => {
    expect(
      allocate({ sellers: [{ sectorId: "mine", corporationId: "parent", units: NaN }] }).trades
    ).toEqual([]);
  });
  it("discounts exactly cancel on the daily-to-turn basis", () => {
    const costs = internalSupplyDiscounts(allocate().trades, 120, 24);
    expect(costs.get("mine")).toBe(30);
    expect(costs.get("own")).toBe(-20);
    expect(costs.get("sub")).toBe(-10);
    expect([...costs.values()].reduce((n, c) => n + c, 0)).toBeCloseTo(0, 10);
  });
});

it("inherits an intermediate parent's group policy when the ultimate owner has no group policy", () => {
  const result = resolveSupplyPolicies(
    owners.map((o) =>
      o.id === "parent" ? { ...o, policy: undefined } : o.id === "child" ? { ...o, policy } : o
    )
  );
  expect(result.get("nested")?.root).toBe("child");
  expect(result.get("parent")?.policy.priority).toBe("market");
});
it("prorates actual consumption across suppliers and leaves unused reservations unpriced", () => {
  const trades = [
    {
      supplierSectorId: "a",
      buyerSectorId: "buyer",
      supplierCorpId: "corp",
      buyerCorpId: "corp",
      units: 60,
      discount: 0.1,
      commodity: "iron",
      marketPrice: 120,
    },
    {
      supplierSectorId: "b",
      buyerSectorId: "buyer",
      supplierCorpId: "corp",
      buyerCorpId: "corp",
      units: 40,
      discount: 0.2,
      commodity: "iron",
      marketPrice: 120,
    },
  ];
  const costs = settleConsumedInternalDiscounts(
    trades,
    new Map([["buyer", new Map([["iron", 20]])]]),
    24
  );
  expect(costs.get("a")).toBe(6);
  expect(costs.get("b")).toBe(8);
  expect(costs.get("buyer")).toBe(-14);
  expect([...costs.values()].reduce((sum, n) => sum + n, 0)).toBe(0);
  expect(settleConsumedInternalDiscounts(trades, new Map(), 24).get("buyer")).toBe(0);
});

it("counts committed buyers only once in the remaining finite input pool", () => {
  const buyers = [
    { sectorId: "own", corporationId: "parent", demand: 40, committed: 20, availability: 0.6 },
    { sectorId: "other", corporationId: "other", demand: 60, availability: 0.6 },
  ];
  const trades = [
    {
      supplierSectorId: "mine",
      buyerSectorId: "own",
      supplierCorpId: "parent",
      buyerCorpId: "parent",
      units: 20,
      discount: 0.1,
    },
  ];
  const availability = internalSupplyAvailability(buyers, trades, 60, 100);
  expect((availability.get("own") ?? 0) * 40 + (availability.get("other") ?? 0) * 60).toBeCloseTo(
    60
  );
  const consumption = new Map([["own", new Map([["iron", 25]])]]);
  const committed = new Map([["own", new Map([["iron", 20]])]]);
  const costs = settleConsumedInternalDiscounts(
    trades.map((t) => ({ ...t, commodity: "iron", marketPrice: 120 })),
    consumption,
    24,
    committed
  );
  expect(costs.get("mine")).toBe(2.5);
  expect(costs.get("own")).toBe(-2.5);
});

describe("own-company cross-state routes under active freight", () => {
  const states = new Map([
    ["mn-mine", "MN"],
    ["mn-plant", "MN"],
    ["ca-plant", "CA"],
    ["ca-sub", "CA"],
  ]);
  const freightAllocate = (caps?: Map<string, number>, units = 60) =>
    allocateInternalSupply({
      sellers: [{ sectorId: "mn-mine", corporationId: "parent", units }],
      buyers: [
        { sectorId: "mn-plant", corporationId: "parent", demand: 10, availability: 0.5 },
        { sectorId: "ca-plant", corporationId: "parent", demand: 40, availability: 0.5 },
        { sectorId: "ca-sub", corporationId: "nested", demand: 40, availability: 0.5 },
      ],
      policies,
      supply: units,
      demand: 90,
      reservationRoom: 100,
      deliveryStateBySector: states,
      ownRouteCaps: caps,
    });
  const unitsTo = (trades: { buyerSectorId: string; units: number }[], id: string) =>
    trades.filter((t) => t.buyerSectorId === id).reduce((n, t) => n + t.units, 0);

  it("keeps the same-state rule when nothing was hauled", () => {
    const { trades } = freightAllocate();
    expect(unitsTo(trades, "mn-plant")).toBeCloseTo(10);
    expect(unitsTo(trades, "ca-plant")).toBe(0);
    expect(unitsTo(trades, "ca-sub")).toBe(0);
  });
  it("serves own plants in another state within the hauled units, after same-state plants", () => {
    const { trades } = freightAllocate(new Map([["parent|MN|CA", 25]]));
    expect(unitsTo(trades, "mn-plant")).toBeCloseTo(10);
    expect(unitsTo(trades, "ca-plant")).toBeCloseTo(25);
    expect(unitsTo(trades, "ca-sub")).toBe(0);
  });
  it("never exceeds the seller's spare output or the buyer's need", () => {
    const big = freightAllocate(new Map([["parent|MN|CA", 500]]));
    expect(unitsTo(big.trades, "ca-plant")).toBeCloseTo(40);
    const short = freightAllocate(new Map([["parent|MN|CA", 500]]), 30);
    expect(unitsTo(short.trades, "mn-plant")).toBeCloseTo(10);
    expect(unitsTo(short.trades, "ca-plant")).toBeCloseTo(20);
  });
  it("ignores a route hauled for a different company", () => {
    const { trades } = freightAllocate(new Map([["other|MN|CA", 25]]));
    expect(unitsTo(trades, "ca-plant")).toBe(0);
  });
});

describe("group cross-state receipts under active freight", () => {
  const groupPolicies = resolveSupplyPolicies([
    ...owners.map((owner) =>
      owner.id === "parent"
        ? { ...owner, policy: { ...policy, ownFirstAcrossStates: true } }
        : owner
    ),
    { id: "sister", totalShares: 100, holders: [{ corporationId: "parent", shares: 100 }] },
  ]);
  const states = new Map([
    ["mine", "MN"],
    ["own", "CA"],
    ["child", "CA"],
    ["nested", "CA"],
    ["sister", "CA"],
    ["other-dest", "NV"],
  ]);
  const routeCap = (identity: string, destination = "CA", units = 40) =>
    new Map([[identity + "|MN|" + destination, units]]);

  it("keeps first-turn group cross-state reservations empty until a group haul is recorded", () => {
    const args = {
      sellers: [{ sectorId: "mine", corporationId: "parent", units: 40 }],
      buyers: [{ sectorId: "child", corporationId: "nested", demand: 40, availability: 0.5 }],
      policies: groupPolicies,
      supply: 40,
      demand: 40,
      reservationRoom: 40,
      deliveryStateBySector: states,
    };
    expect(allocateInternalSupply(args).trades).toEqual([]);
    expect(
      allocateInternalSupply({ ...args, ownRouteCaps: routeCap("group:parent") }).trades.map(
        (trade) => [trade.buyerSectorId, trade.units]
      )
    ).toEqual([["child", 40]]);
  });

  it("gives own plants the first share of a recorded group haul", () => {
    const { trades } = allocateInternalSupply({
      sellers: [{ sectorId: "mine", corporationId: "parent", units: 40 }],
      buyers: [
        { sectorId: "own", corporationId: "parent", demand: 30, availability: 0.5 },
        { sectorId: "child", corporationId: "nested", demand: 30, availability: 0.5 },
      ],
      policies: groupPolicies,
      supply: 40,
      demand: 60,
      reservationRoom: 40,
      deliveryStateBySector: states,
      ownRouteCaps: routeCap("group:parent"),
    });
    expect(trades.map((trade) => [trade.buyerSectorId, trade.units])).toEqual([
      ["own", 30],
      ["child", 10],
    ]);
  });

  it("does not spend a legacy own-only receipt on a subsidiary", () => {
    const { trades } = allocateInternalSupply({
      sellers: [{ sectorId: "mine", corporationId: "parent", units: 25 }],
      buyers: [{ sectorId: "child", corporationId: "nested", demand: 40, availability: 1 }],
      policies: groupPolicies,
      supply: 25,
      demand: 40,
      reservationRoom: 25,
      deliveryStateBySector: states,
      ownRouteCaps: routeCap("parent", "CA", 25),
    });
    expect(trades).toEqual([]);
  });

  it("rejects group reservations for minority, unrelated, sold and cyclic ownership", () => {
    const policies = resolveSupplyPolicies([
      {
        id: "parent",
        totalShares: 100,
        holders: [{ shares: 100 }],
        policy: { priority: "group", discount: 0.1, ownFirstAcrossStates: true },
      },
      { id: "child", totalShares: 100, holders: [{ corporationId: "parent", shares: 100 }] },
      {
        id: "minority",
        totalShares: 100,
        holders: [{ corporationId: "parent", shares: 99 }, { shares: 1 }],
      },
      { id: "unrelated", totalShares: 100, holders: [{ shares: 100 }] },
      { id: "sold", totalShares: 100, holders: [{ corporationId: "outside", shares: 100 }] },
      {
        id: "cycle-a",
        totalShares: 100,
        holders: [{ corporationId: "cycle-b", shares: 100 }],
        policy: { priority: "group", discount: 0.1, ownFirstAcrossStates: true },
      },
      {
        id: "cycle-b",
        totalShares: 100,
        holders: [{ corporationId: "cycle-a", shares: 100 }],
        policy: { priority: "group", discount: 0.1, ownFirstAcrossStates: true },
      },
    ]);
    const buyers = ["child", "minority", "unrelated", "sold", "cycle-a"].map((corporationId) => ({
      sectorId: corporationId,
      corporationId,
      demand: 10,
      availability: 1,
    }));
    const { trades } = allocateInternalSupply({
      sellers: [{ sectorId: "mine", corporationId: "parent", units: 100 }],
      buyers,
      policies,
      supply: 100,
      demand: 50,
      reservationRoom: 100,
      deliveryStateBySector: new Map([
        ["mine", "MN"],
        ...buyers.map((buyer) => [buyer.sectorId, "CA"] as const),
      ]),
      ownRouteCaps: routeCap("group:parent", "CA", 100),
    });

    expect(trades.map((trade) => [trade.buyerCorpId, trade.units])).toEqual([["child", 10]]);
  });

  it("shares a route cap across suppliers and destination plants without double-spending", () => {
    const { trades } = allocateInternalSupply({
      sellers: [
        { sectorId: "mine", corporationId: "parent", units: 30 },
        { sectorId: "nested-mine", corporationId: "nested", units: 30 },
      ],
      buyers: [
        { sectorId: "child", corporationId: "child", demand: 30, availability: 1 },
        { sectorId: "sister", corporationId: "sister", demand: 30, availability: 1 },
      ],
      policies: groupPolicies,
      supply: 60,
      demand: 60,
      reservationRoom: 60,
      deliveryStateBySector: new Map([...states, ["nested-mine", "MN"]]),
      ownRouteCaps: routeCap("group:parent", "CA", 25),
    });
    expect(trades.reduce((sum, trade) => sum + trade.units, 0)).toBeCloseTo(25);
    expect(trades.reduce((sum, trade) => sum + trade.units, 0)).toBeLessThanOrEqual(25);
    expect(trades.map((trade) => trade.buyerSectorId)).toContain("child");
    expect(trades.map((trade) => trade.buyerSectorId)).toContain("sister");
  });

  it("shares route caps across group suppliers and multiple destination states", () => {
    const { trades } = allocateInternalSupply({
      sellers: [
        { sectorId: "mine", corporationId: "parent", units: 30 },
        { sectorId: "nested-mine", corporationId: "nested", units: 30 },
      ],
      buyers: [
        { sectorId: "child", corporationId: "child", demand: 30, availability: 1 },
        { sectorId: "sister", corporationId: "sister", demand: 30, availability: 1 },
        { sectorId: "nested", corporationId: "nested", demand: 30, availability: 1 },
      ],
      policies: groupPolicies,
      supply: 60,
      demand: 90,
      reservationRoom: 60,
      deliveryStateBySector: new Map([...states, ["nested-mine", "MN"], ["nested", "NV"]]),
      ownRouteCaps: new Map([
        ["group:parent|MN|CA", 25],
        ["group:parent|MN|NV", 12],
      ]),
    });
    const byDestination = new Map<string, number>();
    for (const trade of trades) {
      const state = trade.buyerSectorId === "nested" ? "NV" : "CA";
      byDestination.set(state, (byDestination.get(state) ?? 0) + trade.units);
    }

    expect(byDestination.get("CA")).toBeCloseTo(25);
    expect(byDestination.get("NV")).toBeCloseTo(12);
    expect(trades.reduce((sum, trade) => sum + trade.units, 0)).toBeCloseTo(37);
  });

  it("decodes group haul identity for destination member billing", () => {
    expect(ownRouteGroupRoot("group:parent")).toBe("parent");
    expect(ownRouteGroupRoot("child")).toBeUndefined();
  });
});

it.each(["market", "own", "group"] as const)(
  "keeps recorded freight membership after switching to %s with shipping off",
  (priority) => {
    const changed = owners.map((owner) => ({
      ...owner,
      policy: { priority, discount: 0, ownFirstAcrossStates: false },
    }));
    expect([...recordedGroupRouteMembers(changed, ["group:parent"]).get("parent")!].sort()).toEqual(
      ["child", "nested", "parent"]
    );
    const sold = changed.map((owner) =>
      owner.id === "child" ? { ...owner, holders: [{ shares: 100 }] } : owner
    );
    expect([...recordedGroupRouteMembers(sold, ["group:parent"]).get("parent")!]).toEqual([
      "parent",
    ]);
    expect(recordedGroupRouteMembers(changed, []).size).toBe(0);
  }
);
