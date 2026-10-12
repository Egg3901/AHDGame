import { describe, expect, it } from "vitest";
import {
  allocateInternalSupply,
  internalSupplyAvailability,
  internalSupplyDiscounts,
  settleConsumedInternalDiscounts,
  resolveSupplyPolicies,
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
