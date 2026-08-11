import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { deriveLedgerEntry } from "@/lib/ledger/deriveFromTx";
import { isAnchorBalanced, nativeImbalance } from "@/lib/ledger/epsilon";
import type { DerivableTx } from "@/lib/ledger/deriveFromTx";

function tx(overrides: Partial<DerivableTx>): DerivableTx {
  return {
    type: "wire_transfer_out",
    turn: 5,
    createdAt: new Date("2026-07-06T00:00:00Z"),
    subjectType: "character",
    subjectId: new ObjectId(),
    amount: -1000,
    currencyCode: "GBP",
    anchorAmount: -1250,
    ...overrides,
  };
}

describe("deriveLedgerEntry (Phase 1 shim)", () => {
  it("derives a balanced 2-leg entry: subject primary + counterparty contra", () => {
    const counterpartyId = new ObjectId();
    const entry = deriveLedgerEntry(tx({ counterpartyType: "character", counterpartyId }));
    expect(entry).not.toBeNull();
    expect(entry!.legs).toHaveLength(2);
    const [primary, contra] = entry!.legs;
    expect(primary.role).toBe("primary");
    expect(primary.account).toMatch(/^character:.*:GBP$/);
    expect(contra.role).toBe("contra");
    expect(contra.account).toBe(`character:${counterpartyId.toString()}:GBP`);
    // Derived entries ALWAYS satisfy Invariant #1 (the "derivable subset" green).
    expect(isAnchorBalanced(entry!.legs)).toBe(true);
    expect(nativeImbalance(entry!.legs)).toBeNull();
  });

  it("books single-sided rows against a sink:unattributed contra leg (debit)", () => {
    const entry = deriveLedgerEntry(tx({ counterpartyType: "system", amount: -1000 }));
    expect(entry).not.toBeNull();
    const contra = entry!.legs[1];
    // Debit ⇒ money leaves ⇒ the balancing leg is a positive sink.
    expect(contra.account).toBe("sink:unattributed:GBP");
    expect(contra.anchorAmount).toBe(1250);
    expect(isAnchorBalanced(entry!.legs)).toBe(true);
  });

  it("books an unmapped credit single-sided row against mint:unattributed", () => {
    const entry = deriveLedgerEntry(
      tx({
        counterpartyType: "system",
        amount: 2000,
        anchorAmount: 2500,
        type: "wire_transfer_in",
        subjectType: "corporation",
      })
    );
    expect(entry!.legs[1].account).toBe("mint:unattributed:GBP");
    expect(entry!.legs[1].anchorAmount).toBe(-2500);
    expect(isAnchorBalanced(entry!.legs)).toBe(true);
  });

  it("returns null when the anchor value is missing (never guesses a rate)", () => {
    expect(deriveLedgerEntry(tx({ anchorAmount: undefined }))).toBeNull();
  });

  it("maps a government subject to a government:<countryId> account", () => {
    const entry = deriveLedgerEntry(
      tx({
        subjectType: "government",
        subjectId: undefined,
        countryId: "US",
        currencyCode: "USD",
        anchorAmount: -500,
      })
    );
    expect(entry!.legs[0].account).toBe("government:US:USD");
  });
});

describe("Phase 3 coverage — semantic mint/sink reasons", () => {
  it("gives sovereign bond payouts a sink:bond_settlement contra (not unattributed)", () => {
    const entry = deriveLedgerEntry(
      tx({
        type: "gov_bond_maturity_payment",
        subjectType: "government",
        subjectId: undefined,
        countryId: "US",
        currencyCode: "USD",
        amount: -1000,
        anchorAmount: -1000,
      })
    );
    expect(entry!.legs[1].account).toBe("sink:bond_settlement:USD");
    expect(isAnchorBalanced(entry!.legs)).toBe(true);
  });

  it("gives holder bond maturity receipts the paired mint:bond_settlement contra", () => {
    const entry = deriveLedgerEntry(
      tx({ type: "bond_maturity", amount: 1000, anchorAmount: 1000, currencyCode: "USD" })
    );
    // Same reason as the gov payout so the money-supply check nets the transfer.
    expect(entry!.legs[1].account).toBe("mint:bond_settlement:USD");
  });

  it("pairs coupon payout and receipt under bond_coupon_settlement", () => {
    const govCoupon = deriveLedgerEntry(
      tx({
        type: "gov_coupon_payment",
        subjectType: "government",
        subjectId: undefined,
        countryId: "US",
        currencyCode: "USD",
        amount: -50,
        anchorAmount: -50,
      })
    );
    const holderCoupon = deriveLedgerEntry(
      tx({ type: "bond_coupon", amount: 50, anchorAmount: 50, currencyCode: "USD" })
    );
    expect(govCoupon!.legs[1].account).toBe("sink:bond_coupon_settlement:USD");
    expect(holderCoupon!.legs[1].account).toBe("mint:bond_coupon_settlement:USD");
  });

  it("pairs corp_tax_paid and gov_tax_revenue under taxation", () => {
    const paid = deriveLedgerEntry(
      tx({ type: "corp_tax_paid", subjectType: "corporation", amount: -300, anchorAmount: -300 })
    );
    const revenue = deriveLedgerEntry(
      tx({
        type: "gov_tax_revenue",
        subjectType: "government",
        subjectId: undefined,
        countryId: "US",
        currencyCode: "GBP",
        amount: 300,
        anchorAmount: 300,
      })
    );
    expect(paid!.legs[1].account).toBe("sink:taxation:GBP");
    expect(revenue!.legs[1].account).toBe("mint:taxation:GBP");
  });

  it("labels corp_revenue as a sector_revenue mint (genuine one-directional inflow)", () => {
    const entry = deriveLedgerEntry(
      tx({ type: "corp_revenue", subjectType: "corporation", amount: 2000, anchorAmount: 2000 })
    );
    expect(entry!.legs[1].account).toBe("mint:sector_revenue:GBP");
  });

  it("routes a state-party dues row (no subjectId) to a state_party account via meta", () => {
    const entry = deriveLedgerEntry(
      tx({
        type: "party_dues_received",
        subjectType: "party",
        subjectId: undefined,
        currencyCode: "USD",
        amount: 500,
        anchorAmount: 500,
        meta: { scope: "state", statePartyKey: "CA:dem" },
      })
    );
    expect(entry).not.toBeNull();
    expect(entry!.legs[0].account).toBe("state_party:CA:dem:USD");
    // Inbound dues → mint:party_dues contra; entry balances.
    expect(entry!.legs[1].account).toBe("mint:party_dues:USD");
    expect(isAnchorBalanced(entry!.legs)).toBe(true);
  });

  it("national party dues (with ObjectId subjectId) still map to a party account", () => {
    const partyId = new ObjectId();
    const entry = deriveLedgerEntry(
      tx({
        type: "party_dues_received",
        subjectType: "party",
        subjectId: partyId,
        currencyCode: "USD",
        amount: 500,
        anchorAmount: 500,
        meta: { scope: "national" },
      })
    );
    expect(entry!.legs[0].account).toBe(`party:${partyId.toString()}:USD`);
  });

  it("still routes a real counterparty to its account, ignoring the reason map", () => {
    const counterpartyId = new ObjectId();
    const entry = deriveLedgerEntry(
      tx({ type: "corp_tax_paid", counterpartyType: "corporation", counterpartyId })
    );
    // A derivable counterparty always wins over the mint/sink fallback.
    expect(entry!.legs[1].account).toBe(`corporation:${counterpartyId.toString()}:GBP`);
  });
});
