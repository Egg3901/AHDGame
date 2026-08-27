import { describe, expect, it, vi } from "vitest";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { getEventHandler } from "@/lib/events/substrate/registry";
import type { EventResolveContext } from "@/lib/events/substrate/types";
import { WORLD_EVENT_SEED_DEFINITIONS } from "../definitions";

vi.mock("@/lib/events/substrate/applyEffects", () => ({ applyDeclarativeEffects: vi.fn() }));

import "./highTensionEvents";

const expected = {
  "worldEvents.panicBuying": {
    defaultOptionId: "calm",
    optionIds: ["ration", "calm", "release"],
  },
  "worldEvents.bankRun": {
    defaultOptionId: "standBy",
    optionIds: ["guarantee", "holiday", "standBy"],
  },
  "worldEvents.civilDefenseFever": {
    defaultOptionId: "drills",
    optionIds: ["fund", "drills", "dismiss"],
  },
  "worldEvents.warScareProtests": {
    defaultOptionId: "acknowledge",
    optionIds: ["address", "acknowledge", "crackdown"],
  },
} as const;

describe("high-tension society event handlers", () => {
  it("registers every authored option and fallback outcome", () => {
    for (const [kind, contract] of Object.entries(expected)) {
      const handler = getEventHandler(kind);
      expect(handler?.defaultOptionId).toBe(contract.defaultOptionId);
      expect(handler?.options.map((option) => option.id)).toEqual(contract.optionIds);
      const definition = WORLD_EVENT_SEED_DEFINITIONS.find((candidate) => candidate.kind === kind)!;
      expect(
        handler?.options.map(({ id, label, description, isDefault }) => ({
          id,
          label,
          description,
          ...(isDefault ? { isDefault } : {}),
        }))
      ).toEqual(definition.options);
      for (const option of handler?.options ?? []) {
        expect(option.outcomeTable[0]?.minRoll).toBe(1);
        expect(option.outcomeTable.at(-1)?.maxRoll).toBe(100);
        expect(
          option.outcomeTable.every((tier) =>
            tier.effects.some((effect) => effect.type === "wireOnly")
          )
        ).toBe(true);
      }
    }
  });

  it("keeps every vacant-executive default free of treasury losses", () => {
    for (const kind of Object.keys(expected)) {
      const handler = getEventHandler(kind)!;
      const fallback = handler.options.find((option) => option.id === handler.defaultOptionId)!;
      const treasuryLoss = fallback.outcomeTable
        .flatMap((tier) => tier.effects)
        .some((effect) => effect.type === "treasuryDelta" && effect.deltaAnchor < 0);
      expect(treasuryLoss, kind).toBe(false);
    }
  });

  it("applies the selected declarative outcome exactly once", async () => {
    const handler = getEventHandler("worldEvents.bankRun")!;
    const option = handler.options.find((candidate) => candidate.id === "standBy")!;
    const tier = option.outcomeTable[0]!;
    expect(tier.effects.filter((effect) => effect.type === "approvalDelta")).toEqual([
      { type: "approvalDelta", delta: -4 },
    ]);
    const ctx = { option, tier } as EventResolveContext;

    await handler.applyEffects?.(ctx);

    expect(applyDeclarativeEffects).toHaveBeenCalledTimes(1);
    expect(applyDeclarativeEffects).toHaveBeenCalledWith(ctx, tier.effects);
  });
});
