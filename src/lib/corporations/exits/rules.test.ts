import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { buildCorporationExit, exitOwnerKind, type CorporationExitSnapshot } from "./rules";

const NOW = new Date("2026-10-08T12:00:00-04:00");

function corp(overrides: Partial<CorporationExitSnapshot> = {}): CorporationExitSnapshot {
  return {
    _id: new ObjectId(),
    name: "Acme",
    countryId: "US",
    type: "manufacturing",
    liquidCapital: 1_500,
    sharePrice: 2,
    totalShares: 50,
    ...overrides,
  } as CorporationExitSnapshot;
}

describe("exitOwnerKind", () => {
  it("is player for a character or imperial CEO", () => {
    expect(exitOwnerKind(corp({ ceoType: "character" }))).toBe("player");
    expect(exitOwnerKind(corp({ ceoType: undefined }))).toBe("player");
  });

  it("is npp for an NPP-run corporation", () => {
    expect(exitOwnerKind(corp({ ceoType: "npp" }))).toBe("npp");
  });

  it("is state for a National Corporation, whoever the CEO type says", () => {
    expect(exitOwnerKind(corp({ countryOwnerId: "US", ceoType: "npp" }))).toBe("state");
    expect(exitOwnerKind(corp({ ownershipState: "stateOwned" }))).toBe("state");
  });
});

describe("buildCorporationExit", () => {
  it("keys the row by the corporation id and captures the final books", () => {
    const c = corp({ sequentialId: 12, liquidCurrencyCode: "USD" as never });
    const exit = buildCorporationExit({
      corporation: c,
      reason: "voluntary_closure",
      turn: 40,
      lastRevenue: 900,
      now: NOW,
    });
    expect(exit).toEqual({
      _id: c._id,
      corporationId: c._id,
      name: "Acme",
      sequentialId: 12,
      countryId: "US",
      corporationType: "manufacturing",
      ownerKind: "player",
      turn: 40,
      reason: "voluntary_closure",
      currencyCode: "USD",
      finalCash: 1_500,
      finalMarketCap: 100,
      finalRevenue: 900,
      createdAt: NOW,
    });
  });

  it("carries the successor on a merger and omits it otherwise", () => {
    const successorId = new ObjectId();
    const merged = buildCorporationExit({
      corporation: corp(),
      reason: "acquired",
      turn: 1,
      successorId,
      now: NOW,
    });
    expect(merged.successorId).toEqual(successorId);
    const closed = buildCorporationExit({
      corporation: corp(),
      reason: "bond_default",
      turn: 1,
      now: NOW,
    });
    expect("successorId" in closed).toBe(false);
  });

  it("treats missing or non-finite money as zero", () => {
    const exit = buildCorporationExit({
      corporation: corp({ liquidCapital: NaN, sharePrice: undefined as never }),
      reason: "npp_insolvency",
      turn: 3,
      lastRevenue: null,
      now: NOW,
    });
    expect(exit.finalCash).toBe(0);
    expect(exit.finalMarketCap).toBe(0);
    expect(exit.finalRevenue).toBe(0);
  });
});
