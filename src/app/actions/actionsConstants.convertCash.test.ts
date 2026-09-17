/**
 * ConvertCash card parity (Game1724): the Personal Campaign Donation card
 * advertises the flat AP cost the shared rules quote execution debits, so a
 * canonical cost change moves the card with no second edit. Against a stale
 * hardcoded literal the canonical-move test below fails.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CARDS } from "./actionsConstants";
import { CONVERT_CASH_ACTION_COST, quoteConvertCashAction } from "@/lib/actions/rules";

function convertCashCard() {
  const card = CARDS.find((c) => c.type === "convertCash");
  if (!card) throw new Error("missing convertCash card");
  return card;
}

describe("convertCash card consumes the canonical ConvertCash rules", () => {
  it("advertises the canonical flat AP cost the quote debits", () => {
    const card = convertCashCard();
    expect(card.actionCost).toBe(CONVERT_CASH_ACTION_COST);
    const quote = quoteConvertCashAction({ amount: 1_000_000 });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(card.actionCost).toBe(quote.apCost);
  });
});

describe("convertCash card follows a canonical cost move with no second edit", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/actions/rules");
  });

  it("a test-only canonical move flows through to the card", async () => {
    vi.resetModules();
    vi.doMock("@/lib/actions/rules", async (importOriginal) => {
      const actual = await (importOriginal as () => Promise<Record<string, unknown>>)();
      return { ...actual, CONVERT_CASH_ACTION_COST: 9 };
    });
    const { CARDS: moved } = await import("./actionsConstants");
    const card = moved.find((c) => c.type === "convertCash");
    if (!card) throw new Error("missing convertCash card");

    // Against a hardcoded actionCost: 2 this assertion fails; through the
    // canonical const it tracks the move.
    expect(card.actionCost).toBe(9);
  });
});
