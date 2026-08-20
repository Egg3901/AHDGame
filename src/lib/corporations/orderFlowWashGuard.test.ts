import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  buildOrderFlowWindowInc,
  buildOrderFlowWindowIncReversal,
  isOppositeSideTradeByActor,
  ORDER_FLOW_WASH_WINDOW_MS,
} from "./orderFlowWashGuard";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";

const now = new Date("2026-08-20T14:10:00Z");
const actorId = new ObjectId();

function trade(
  over: Partial<ShareTradeHistory>
): Pick<ShareTradeHistory, "kind" | "from" | "to" | "createdAt"> {
  return {
    kind: "market_buy",
    from: null,
    to: { characterId: actorId, name: "Actor" },
    createdAt: new Date(now.getTime() - 10_000),
    ...over,
  };
}

describe("isOppositeSideTradeByActor", () => {
  it("matches a sell against the actor's recent buy (incident: 10s round trip)", () => {
    expect(isOppositeSideTradeByActor(trade({}), { characterId: actorId }, "sell", now)).toBe(true);
  });

  it("matches a buy against the actor's recent sell", () => {
    const prior = trade({
      kind: "market_sell",
      from: { characterId: actorId, name: "Actor" },
      to: null,
    });
    expect(isOppositeSideTradeByActor(prior, { characterId: actorId }, "buy", now)).toBe(true);
  });

  it("does not match the same side, another actor, or outside the window", () => {
    // Same side: a second buy by the actor is not a round trip.
    expect(isOppositeSideTradeByActor(trade({}), { characterId: actorId }, "buy", now)).toBe(false);
    // Different actor.
    expect(
      isOppositeSideTradeByActor(trade({}), { characterId: new ObjectId() }, "sell", now)
    ).toBe(false);
    // Outside the window.
    const stale = trade({ createdAt: new Date(now.getTime() - ORDER_FLOW_WASH_WINDOW_MS - 1000) });
    expect(isOppositeSideTradeByActor(stale, { characterId: actorId }, "sell", now)).toBe(false);
  });

  it("ignores non-position kinds (splits, issuance, corrections)", () => {
    const split = trade({ kind: "reverse_split" });
    expect(isOppositeSideTradeByActor(split, { characterId: actorId }, "sell", now)).toBe(false);
  });

  it("matches corporation and imperial actors in the correct party slot", () => {
    const corpId = new ObjectId();
    const prior = trade({ to: { corporationId: corpId, name: "Corp" } });
    expect(isOppositeSideTradeByActor(prior, { corporationId: corpId }, "sell", now)).toBe(true);
    expect(isOppositeSideTradeByActor(prior, { characterId: corpId }, "sell", now)).toBe(false);
  });
});

describe("buildOrderFlowWindowInc", () => {
  it("accumulates the own-side window for a normal leg", () => {
    expect(buildOrderFlowWindowInc(true, "buy", 1000, false)).toEqual({
      orderFlowWindowBuyValue: 1000,
    });
    expect(buildOrderFlowWindowInc(true, "sell", 1000, false)).toEqual({
      orderFlowWindowSellValue: 1000,
    });
  });

  it("a wash leg neutralizes the opposite window instead", () => {
    // Buy then wash-sell: the sell contributes nothing to sells and subtracts
    // the notional from buys, netting the round trip to zero.
    expect(buildOrderFlowWindowInc(true, "sell", 1000, true)).toEqual({
      orderFlowWindowBuyValue: -1000,
    });
    expect(buildOrderFlowWindowInc(true, "buy", 1000, true)).toEqual({
      orderFlowWindowSellValue: -1000,
    });
  });

  it("empty when ineligible or non-positive notional", () => {
    expect(buildOrderFlowWindowInc(false, "buy", 1000, false)).toEqual({});
    expect(buildOrderFlowWindowInc(true, "buy", 0, false)).toEqual({});
  });

  it("a full round trip nets the windows to zero", () => {
    const buyLeg = buildOrderFlowWindowInc(true, "buy", 1000, false);
    const sellLeg = buildOrderFlowWindowInc(true, "sell", 1000, true);
    const buyWindow =
      (buyLeg.orderFlowWindowBuyValue ?? 0) + (sellLeg.orderFlowWindowBuyValue ?? 0);
    const sellWindow =
      (buyLeg.orderFlowWindowSellValue ?? 0) + (sellLeg.orderFlowWindowSellValue ?? 0);
    expect(buyWindow).toBe(0);
    expect(sellWindow).toBe(0);
  });
});

describe("buildOrderFlowWindowIncReversal", () => {
  it("exactly inverts the inc for both normal and wash legs", () => {
    expect(buildOrderFlowWindowIncReversal(true, "sell", 1000, false)).toEqual({
      orderFlowWindowSellValue: -1000,
    });
    expect(buildOrderFlowWindowIncReversal(true, "sell", 1000, true)).toEqual({
      orderFlowWindowBuyValue: 1000,
    });
    expect(buildOrderFlowWindowIncReversal(false, "sell", 1000, true)).toEqual({});
  });
});
