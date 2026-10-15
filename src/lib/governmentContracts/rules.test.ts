import { describe, it, expect } from "vitest";
import {
  tenderTab,
  canBid,
  canAward,
  visibleBids,
  compareBids,
  validDeadlines,
  normalizePage,
  CONTRACTS_PAGE_SIZE,
  officeContractType,
  defenceBidError,
} from "./rules";
import { boardFilter } from "./queries";
import { publishTenderSchema, bidSchema } from "./schemas";
import type { GovernmentTender, ContractBid } from "./types";
const tender = { status: "open", closesTurn: 12, awardDeadlineTurn: 15 } as GovernmentTender;
const bid = (id: string, amount: number, userId = "u"): ContractBid => ({
  corporationId: id,
  corporationName: id,
  userId,
  amount,
  submittedTurn: 1,
  revision: 1,
  withdrawn: false,
});
describe("government tender rules", () => {
  it("accepts bids before the exact closing turn and awards only afterward", () => {
    expect(canBid(tender, 11)).toBe(true);
    expect(canBid(tender, 12)).toBe(false);
    expect(canAward(tender, 11)).toBe(false);
    expect(canAward(tender, 12)).toBe(true);
    expect(canAward(tender, 15)).toBe(false);
  });
  it("places expiration in Canceled while retaining in-progress award recovery", () => {
    expect(tenderTab(tender, 11)).toBe("active");
    expect(tenderTab(tender, 12)).toBe("closed");
    expect(tenderTab(tender, 15)).toBe("canceled");
    expect(tenderTab({ ...tender, status: "awarding" }, 20)).toBe("closed");
    expect(tenderTab({ ...tender, status: "awarded" }, 20)).toBe("awarded");
  });
  it("never allows bids on terminal or publishing tenders", () => {
    for (const status of ["publishing", "awarding", "awarded", "canceled"] as const)
      expect(canBid({ ...tender, status }, 1)).toBe(false);
  });
  it("seals rival bid amounts, even from the publishing official, before closing", () => {
    const row = { ...tender, bids: { a: bid("a", 10, "alice"), b: bid("b", 20, "bob") } };
    expect(visibleBids(row, 11, "alice").map((b) => b.amount)).toEqual([10]);
    expect(visibleBids(row, 11, "minister")).toEqual([]);
    expect(visibleBids(row, 12, "minister").map((b) => b.amount)).toEqual([10, 20]);
  });
  it("keeps withdrawn revisions visible only to their owner", () => {
    const row = { ...tender, bids: { a: { ...bid("a", 10, "alice"), withdrawn: true } } };
    expect(visibleBids(row, 12, "bob")).toEqual([]);
    expect(visibleBids(row, 12, "alice")[0].revision).toBe(1);
  });
  it("compares defence bids by lowest price and concessions by highest fee", () => {
    expect(compareBids("defence", bid("a", 10), bid("b", 20))).toBeLessThan(0);
    expect(compareBids("extraction", bid("a", 10), bid("b", 20))).toBeGreaterThan(0);
    expect(compareBids("defence", bid("a", 10), bid("b", 10))).toBeLessThan(0);
  });
  it("requires a real bidding period and an award period within the defence window", () => {
    expect(validDeadlines(1, 3, 5, 12)).toBe(true);
    expect(validDeadlines(1, 1, 5)).toBe(false);
    expect(validDeadlines(1, 3, 3)).toBe(false);
    expect(validDeadlines(1, 3, 14, 12)).toBe(false);
    expect(validDeadlines(1, 3, 13, 12)).toBe(true);
    expect(validDeadlines(1, 3, 25)).toBe(true);
    expect(validDeadlines(1, 3, 26)).toBe(false);
  });
  it("requires both research and era eligibility for the equipment grade", () => {
    const input = {
      supplierGrade: 3,
      eraGrade: 1,
      requiredGrade: 2,
      amount: 100,
      maximum: 200,
      floor: 50,
      ceiling: 200,
      supplierRemainingLots: 10,
      lots: 1,
    };
    expect(defenceBidError(input)).toContain("grade");
    expect(defenceBidError({ ...input, eraGrade: 2 })).toBeNull();
    expect(defenceBidError({ ...input, eraGrade: 3, supplierGrade: 1 })).toContain("grade");
    expect(defenceBidError({ ...input, floor: NaN })).toContain("finite");
    expect(defenceBidError({ ...input, supplierGrade: Infinity })).toContain("finite");
  });
  it("fixes pagination at ten and rejects invalid/unsafe page inputs", () => {
    expect(CONTRACTS_PAGE_SIZE).toBe(10);
    for (const raw of [null, "0", "-1", "1.5", "NaN", "Infinity", "100001"])
      expect(normalizePage(raw)).toBe(1);
    expect(normalizePage("3")).toBe(3);
  });
  it("scopes all board tabs to one country and applies a type filter", () => {
    for (const tab of ["active", "closed", "awarded", "canceled"] as const) {
      const filter = boardFilter("JP", tab, 12, "defence");
      expect(filter.countryId).toBe("JP");
      expect(filter["terms.type"]).toBe("defence");
    }
  });
  it("assigns only existing defence and finance seats a default contract type", () => {
    expect(officeContractType("US", "defence", "finance", "defence")).toBe("defence");
    expect(officeContractType("JP", "finance", "finance", "defence")).toBe("extraction");
    expect(officeContractType("US", "education", "finance", "defence")).toBeNull();
  });
  it("does not accept a targeted corporation in a published tender", () => {
    const input = {
      title: "Equipment order",
      description: "Equipment for the national arsenal",
      closesTurn: 3,
      awardDeadlineTurn: 5,
      terms: { type: "defence", component: "ground", grade: 0, lots: 1, maximumPricePerLot: 100 },
    };
    expect(publishTenderSchema.safeParse(input).success).toBe(true);
    expect(publishTenderSchema.safeParse({ ...input, corporationId: "a".repeat(24) }).success).toBe(
      false
    );
    expect(
      publishTenderSchema.safeParse({
        ...input,
        terms: { ...input.terms, maximumPricePerLot: Infinity },
      }).success
    ).toBe(false);
  });
  it("validates bid revisions and forbids client-selected system bids", () => {
    const input = { corporationId: "a".repeat(24), amount: 100, expectedRevision: 0 };
    expect(bidSchema.safeParse(input).success).toBe(true);
    expect(bidSchema.safeParse({ ...input, system: true }).success).toBe(false);
    expect(bidSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
  });
});
