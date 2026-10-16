import { describe, expect, it } from "vitest";
import { checkBalancedTransfer } from "@/lib/banking/rules/invariants";
import { producerCashTransition, type ProducerCashBinding } from "./cashSettlementRules";

const bindings: ProducerCashBinding[] = [
  {
    accountId: "buyer",
    kind: "economyAccount",
    economyAccountId: "households:example",
    currency: "USD",
    localPerAnchor: 2,
    openingCashLocal: 200,
  },
  {
    accountId: "seller",
    kind: "corporation",
    corporationId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    currency: "JPY",
    localPerAnchor: 100,
    openingCashLocal: 2000,
  },
];
const args = () => ({
  worldEpoch: "example",
  turn: 1,
  receiptDigest: "a".repeat(64),
  bindings,
  opening: [
    { id: "buyer", cash: 100 },
    { id: "seller", cash: 20 },
  ],
  closing: [
    { id: "buyer", cash: 70 },
    { id: "seller", cash: 50 },
  ],
});

describe("closed producer cash settlement", () => {
  it("debits and credits native balances at frozen rates without a mint or a bank-vault target", () => {
    const receipt = producerCashTransition(args());
    expect(receipt.legs.map((leg) => [leg.kind, leg.amount, leg.path])).toEqual([
      ["debit", 60, "cash"],
      ["credit", 3000, "liquidCapital"],
    ]);
    expect(checkBalancedTransfer(receipt.legs, receipt.key)).toEqual([]);
    expect(receipt.event.meta?.receiptDigest).toBe("a".repeat(64));
    expect(receipt.key).toBe("producer-economy:example:1");
  });

  it("refuses invented money, missing accounts, overlapping targets and changed participants", () => {
    expect(() =>
      producerCashTransition({
        ...args(),
        closing: [
          { id: "buyer", cash: 70 },
          { id: "seller", cash: 51 },
        ],
      })
    ).toThrow("conserve");
    expect(() => producerCashTransition({ ...args(), bindings: [bindings[0]] })).toThrow("Missing");
    expect(() =>
      producerCashTransition({
        ...args(),
        bindings: [bindings[0], { ...bindings[0], accountId: "seller", openingCashLocal: 40 }],
      })
    ).toThrow("same cash");
    expect(() =>
      producerCashTransition({ ...args(), closing: [{ id: "other", cash: 120 }] })
    ).toThrow("participants");
  });

  it("has no cash legs when within-corporation deliveries change no money", () => {
    const { opening } = args();
    expect(producerCashTransition({ ...args(), closing: opening }).legs).toEqual([]);
  });
});
