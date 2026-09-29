import { describe, expect, it } from "vitest";
import {
  computeCommodityOutputSharePercent,
  findCommodityOutputBasisChange,
} from "./corpCommoditySnapshot";

describe("computeCommodityOutputSharePercent", () => {
  it("returns share capped at 100", () => {
    expect(computeCommodityOutputSharePercent(25, 100)).toBe(25);
    expect(computeCommodityOutputSharePercent(200, 100)).toBe(100);
    expect(computeCommodityOutputSharePercent(0, 100)).toBe(0);
  });
});

describe("findCommodityOutputBasisChange", () => {
  it("marks the historical switch from the revenue proxy to measured plant output", () => {
    expect(
      findCommodityOutputBasisChange([
        { turn: 346, createdAt: "2026-08-24T02:00:06.291Z" },
        { turn: 347, createdAt: "2026-08-24T03:00:05.857Z" },
        { turn: 348, createdAt: "2026-08-24T04:00:01.742Z" },
      ])
    ).toEqual({
      turn: 347,
      from: "revenue-proxy-v1",
      to: "plants-ledger-v1",
    });
  });

  it("does not invent a cutover for a later world or an ordinary output change", () => {
    expect(
      findCommodityOutputBasisChange([
        { turn: 346, createdAt: "2026-09-01T02:00:00.000Z" },
        { turn: 347, createdAt: "2026-09-01T03:00:00.000Z" },
      ])
    ).toBeNull();
  });

  it("prefers an explicitly persisted basis", () => {
    expect(
      findCommodityOutputBasisChange([
        { turn: 10, commodityOutputBasis: "revenue-proxy-v1" },
        { turn: 11, commodityOutputBasis: "plants-ledger-v1" },
      ])
    ).toEqual({ turn: 11, from: "revenue-proxy-v1", to: "plants-ledger-v1" });
  });
});
