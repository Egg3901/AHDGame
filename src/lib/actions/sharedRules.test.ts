/**
 * Shared action rules entry point (#1724): every catalog action resolves
 * through quoteAction, and the quote equals what execution charges
 * (ACTIONS[type].effect and getActionPointCost). The source guard keeps the
 * module host-independent.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { Character, State } from "@/lib/db/types";
import { ACTIONS, getActionPointCost } from "@/lib/actions";
import {
  RULES_VERSION,
  SHARED_ACTION_TYPES,
  getSharedActionPointCost,
  isSharedActionType,
  quoteAction,
  type SharedActionType,
} from "./sharedRules";

const character = {
  donorBaseLevel: 20,
  politicalInfluence: 40,
  favorability: 30,
  countryId: "US",
  cashOnHand: 1_000_000,
  funds: 5_000_000,
  stats: { fundraising: 12, charisma: 11, intellect: 13, debate: 10 },
} as unknown as Character;

const state = { name: "Ohio", gdp: 800_000, population: 11_000_000 } as unknown as State;
const target = { gdpMillions: 800_000, population: 11_000_000, countryId: "US" };

function quoteFor(type: SharedActionType, priceLevel?: number) {
  return quoteAction({
    actionType: type,
    actor: character,
    target,
    context: { priceLevel, convertAmount: 1_000_000, rpgStatsEnabled: true },
  });
}

describe("shared action rules entry point", () => {
  it("exposes a semver RULES_VERSION", () => {
    expect(RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("covers exactly the action catalog", () => {
    expect([...SHARED_ACTION_TYPES].sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const type of Object.keys(ACTIONS)) expect(isSharedActionType(type)).toBe(true);
    expect(isSharedActionType("notAnAction")).toBe(false);
  });

  it.each([...SHARED_ACTION_TYPES])("%s resolves through quoteAction", (type) => {
    const quote = quoteFor(type);
    expect(quote.ok).toBe(true);
    expect(quote.actionType).toBe(type);
    expect(quote.rulesVersion).toBe(RULES_VERSION);
  });

  describe.each([1, 0.4])("display quote equals execution charge at price level %s", (level) => {
    it.each([...SHARED_ACTION_TYPES])("%s", (type) => {
      const quote = quoteFor(type, level);
      if (!quote.ok) throw new Error(quote.error);
      // AP: the execute shell's cost and the AP-only helper both match the quote.
      expect(getActionPointCost(character, type)).toBe(quote.apCost);
      expect(getSharedActionPointCost(type, character)).toBe(quote.apCost);
      // Effect: the action's own effect applies exactly the quoted deltas.
      const effect = ACTIONS[type].effect(character, state, {
        formatFunds: (n: number) => String(n),
        priceLevel: level,
      });
      const q = quote.effect;
      if (type === "convertCash") {
        // The default effect converts all cash on hand; price the same amount.
        const all = quoteAction({
          actionType: type,
          actor: character,
          context: { convertAmount: character.cashOnHand },
        });
        if (!all.ok) throw new Error(all.error);
        expect(effect.fundsChange).toBe(all.effect.campaignCreditLocal);
        expect(effect.infamyChange).toBe(all.effect.infamyChange);
        expect(effect.cashOnHandChange).toBe(-(all.effect.cashDebitLocal ?? 0));
        return;
      }
      expect(effect.fundsChange ?? 0).toBe(q.fundsChangeAnchor);
      expect(effect.politicalInfluenceChange).toBe(q.politicalInfluenceChange);
      expect(effect.favorabilityChange).toBe(q.favorabilityChange);
      expect(effect.donorBaseLevelChange).toBe(q.donorBaseLevelChange);
      expect(quote.fundCostAnchor).toBe(Math.max(0, -q.fundsChangeAnchor));
    });
  });

  it("rejects instead of substituting neutral values", () => {
    const noStats = quoteAction({
      actionType: "campaign",
      actor: { politicalInfluence: 10 },
      target,
    });
    expect(noStats.ok).toBe(false);
    const noTarget = quoteAction({ actionType: "advertise", actor: character });
    expect(noTarget.ok).toBe(false);
    const noDonors = quoteAction({ actionType: "fundraise", actor: { donorBaseLevel: 0 } });
    expect(noDonors.ok).toBe(false);
    const noAmount = quoteAction({ actionType: "convertCash", actor: character });
    expect(noAmount.ok).toBe(false);
    if (!noAmount.ok) expect(noAmount.rulesVersion).toBe(RULES_VERSION);
    const flagOff = quoteAction({
      actionType: "debatePrep",
      actor: character,
      context: { rpgStatsEnabled: false },
    });
    expect(flagOff.ok).toBe(false);
  });

  it("stays host-independent", () => {
    const src = readFileSync(new URL("./sharedRules.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["./rules"]);
    expect(src).not.toMatch(/process\.env|Date\.now|Math\.random|new Date\(/);
  });
});
