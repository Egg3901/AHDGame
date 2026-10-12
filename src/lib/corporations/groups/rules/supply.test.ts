import { describe, it, expect } from "vitest";
import {
  allocateGroupSupply,
  groupSupplyLane,
  type GroupSupplyInput,
  type SupplyMember,
} from "./supply";
import { scheduleGroupReceiving } from "./participation";
const seller: SupplyMember = {
  id: "npp",
  rootId: "group",
  ceoId: "operator",
  operator: "npp",
  vacant: false,
  stateOwned: false,
  cashAvailableAnchor: 100,
};
const player: SupplyMember = {
  id: "player",
  rootId: "group",
  ceoId: "ceo",
  userId: "user",
  operator: "player",
  vacant: false,
  stateOwned: false,
  cashAvailableAnchor: 100,
};
const peer: SupplyMember = { ...seller, id: "peer" };
function fixture(): GroupSupplyInput {
  return {
    turn: 20,
    policy: "members",
    members: [seller, player, peer],
    offers: [{ memberId: seller.id, scope: "steel:US-PA", producedUnits: 100, committedUnits: 40 }],
    needs: [
      { memberId: peer.id, scope: "steel:US-PA", requiredUnits: 100, contractedUnits: 20 },
      { memberId: player.id, scope: "steel:US-PA", requiredUnits: 100, contractedUnits: 0 },
    ],
    marketPriceByScope: new Map([["steel:US-PA", 2]]),
    legalLanes: new Set([
      groupSupplyLane(seller.id, player.id, "steel:US-PA"),
      groupSupplyLane(seller.id, peer.id, "steel:US-PA"),
    ]),
  };
}
describe("NPP group supply reservations", () => {
  it("honors existing contracts and keeps player receivers out by default", () => {
    const result = allocateGroupSupply(fixture());
    expect(result).toEqual([
      {
        supplierId: "npp",
        buyerId: "peer",
        scope: "steel:US-PA",
        units: 50,
        unitPriceAnchor: 2,
        amountAnchor: 100,
      },
    ]);
  });
  it("prices every allocation at the benchmark and limits total production and cash", () => {
    const input = fixture();
    input.members = [
      seller,
      { ...player, preference: scheduleGroupReceiving(player, undefined, true, 19) },
      peer,
    ];
    const result = allocateGroupSupply(input);
    expect(result.reduce((n, r) => n + r.units, 0)).toBeCloseTo(60);
    for (const r of result) {
      expect(r.amountAnchor).toBe(r.units * 2);
      expect(r.amountAnchor).toBeLessThanOrEqual(100);
    }
    expect(result.find((r) => r.buyerId === "player")?.units).toBeCloseTo(30);
  });
  it("never automatically reserves player output", () => {
    const input = fixture();
    input.offers = [
      { memberId: "player", scope: "steel:US-PA", producedUnits: 100, committedUnits: 0 },
    ];
    expect(allocateGroupSupply(input)).toEqual([]);
  });
  it("does no work under commercial independence", () => {
    expect(allocateGroupSupply({ ...fixture(), policy: "independent" })).toEqual([]);
  });
  it("rejects closed lanes, nonmembers and mismatched markets", () => {
    expect(allocateGroupSupply({ ...fixture(), legalLanes: new Set() })).toEqual([]);
    const input = fixture();
    input.members = [seller, player, { ...peer, rootId: "other" }];
    expect(allocateGroupSupply(input)).toEqual([]);
    input.members = [seller, player, peer];
    input.needs = input.needs.map((n) => ({ ...n, scope: "steel:US-OH" }));
    expect(allocateGroupSupply(input)).toEqual([]);
  });
  it("bounds one buyer's spend across different commodities", () => {
    const input = fixture();
    input.offers = [
      { memberId: "npp", scope: "steel:US-PA", producedUnits: 100, committedUnits: 0 },
      { memberId: "npp", scope: "power:US-PA", producedUnits: 100, committedUnits: 0 },
    ];
    input.needs = [
      { memberId: "peer", scope: "steel:US-PA", requiredUnits: 100, contractedUnits: 0 },
      { memberId: "peer", scope: "power:US-PA", requiredUnits: 100, contractedUnits: 0 },
    ];
    input.marketPriceByScope = new Map([
      ["steel:US-PA", 2],
      ["power:US-PA", 1],
    ]);
    input.legalLanes = new Set([
      groupSupplyLane("npp", "peer", "steel:US-PA"),
      groupSupplyLane("npp", "peer", "power:US-PA"),
    ]);
    expect(allocateGroupSupply(input).reduce((sum, r) => sum + r.amountAnchor, 0)).toBeCloseTo(100);
  });
  it("is deterministic when offers and buyers arrive in a different order", () => {
    const a = fixture(),
      b = fixture();
    b.offers = [...b.offers].reverse();
    b.needs = [...b.needs].reverse();
    expect(allocateGroupSupply(a)).toEqual(allocateGroupSupply(b));
  });
  it("produces no volume from invalid physical quantities", () => {
    const input = fixture();
    input.offers = [
      { memberId: "npp", scope: "steel:US-PA", producedUnits: NaN, committedUnits: 0 },
    ];
    expect(allocateGroupSupply(input)).toEqual([]);
  });
});

describe("unknown physical obligations", () => {
  it("does not release output whose prior commitments are unknown", () => {
    const input = fixture();
    input.offers = [{ ...input.offers[0], committedUnits: NaN }];
    expect(allocateGroupSupply(input)).toEqual([]);
  });
  it("does not allocate to a buyer whose contracted input is unknown", () => {
    const input = fixture();
    input.needs = [{ ...input.needs[0], contractedUnits: NaN }];
    expect(allocateGroupSupply(input)).toEqual([]);
  });
});
