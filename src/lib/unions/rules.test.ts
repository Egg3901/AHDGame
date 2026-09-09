import { describe, expect, it } from "vitest";
import { paidUnionServices, purchaseUnionServices } from "./rules";

describe("prepaid union service rules", () => {
  it("bounds receipts and drops skipped, expired and future payments", () => {
    expect(
      purchaseUnionServices(
        [
          { turn: 9, services: ["training"] },
          { turn: 10, services: ["healthFund", "unknown"] },
          { turn: 30, services: ["training"] },
        ],
        10,
        ["legalAid"]
      )
    ).toEqual([
      { turn: 10, services: ["healthFund"] },
      { turn: 11, services: ["legalAid"] },
    ]);
  });

  it.each([{ ownerId: null }, { ownerId: "leader", suspended: true }])(
    "does not provide services from a suspended or vacant union",
    (union) => {
      expect(
        paidUnionServices(
          { ...union, serviceReceipts: [{ turn: 10, services: ["healthFund"] }] },
          10
        )
      ).toEqual([]);
    }
  );

  it("does not revive an expired receipt when labour processing resumes", () => {
    const union = { ownerId: "leader", serviceReceipts: [{ turn: 10, services: ["healthFund"] }] };
    expect(paidUnionServices(union, 12)).toEqual([]);
    expect(purchaseUnionServices(union.serviceReceipts, 12, [])).toEqual([
      { turn: 13, services: [] },
    ]);
  });
});
