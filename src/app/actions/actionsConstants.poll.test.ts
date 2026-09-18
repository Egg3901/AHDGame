import { describe, it, expect, vi, afterEach } from "vitest";
import { formatFundsCompact } from "@/lib/utils/formatters";
import { getPollActionCost, getPollBaseFundCost } from "@/lib/actions";
import type { Character } from "@/lib/db/types";
import { CARDS } from "./actionsConstants";

const noCharacter = {} as Character;

function pollCard(type: "poll" | "pollLarge") {
  const card = CARDS.find((c) => c.type === type);
  if (!card) throw new Error(`missing ${type} card`);
  return card;
}

describe("poll cards consume the canonical Poll rules", () => {
  it("quick poll card matches the canonical small-tier costs", () => {
    const card = pollCard("poll");
    expect(card.actionCost).toBe(getPollActionCost("small"));
    expect(card.fundCost(noCharacter)).toBe(getPollBaseFundCost("small"));
    expect(card.fundLabel(noCharacter)).toBe(formatFundsCompact(getPollBaseFundCost("small")));
  });

  it("full poll card matches the canonical large-tier costs", () => {
    const card = pollCard("pollLarge");
    expect(card.actionCost).toBe(getPollActionCost("large"));
    expect(card.fundCost(noCharacter)).toBe(getPollBaseFundCost("large"));
    expect(card.fundLabel(noCharacter)).toBe(formatFundsCompact(getPollBaseFundCost("large")));
  });
});

describe("poll cards follow a canonical cost move with no second edit", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/actions");
  });

  it("a test-only canonical move flows through to both cards", async () => {
    vi.resetModules();
    vi.doMock("@/lib/actions", async (importOriginal) => {
      const actual = (await (importOriginal as () => Promise<Record<string, unknown>>)()) as Record<
        string,
        (...args: never[]) => unknown
      >;
      return {
        ...actual,
        getPollActionCost: (tier: string) => (tier === "large" ? 22 : 11),
        getPollBaseFundCost: (tier: string) => (tier === "large" ? 43000 : 41000),
      };
    });
    const { CARDS: moved } = await import("./actionsConstants");
    const small = moved.find((c) => c.type === "poll");
    const large = moved.find((c) => c.type === "pollLarge");
    if (!small || !large) throw new Error("missing poll cards");

    // Against hardcoded actionCost: 2 / 6 and fundCost 25_000 / 75_000 these
    // assertions fail; through the canonical getters they track the move.
    expect(small.actionCost).toBe(11);
    expect(large.actionCost).toBe(22);
    expect(small.fundCost(noCharacter)).toBe(41000);
    expect(large.fundCost(noCharacter)).toBe(43000);
    expect(small.fundLabel(noCharacter)).toBe(formatFundsCompact(41000));
    expect(large.fundLabel(noCharacter)).toBe(formatFundsCompact(43000));
  });
});
