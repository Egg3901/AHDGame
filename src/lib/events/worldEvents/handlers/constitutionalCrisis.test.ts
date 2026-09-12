import { describe, expect, it, vi } from "vitest";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { getEventHandler } from "@/lib/events/substrate/registry";
import type { EventResolveContext } from "@/lib/events/substrate/types";
import { WORLD_EVENT_SEED_DEFINITIONS } from "../definitions";

vi.mock("@/lib/events/substrate/applyEffects", () => ({ applyDeclarativeEffects: vi.fn() }));

import "./constitutionalCrisis";

describe("constitutional crisis event", () => {
  it("registers the lawful constitutional options in the seed definition", () => {
    const handler = getEventHandler("worldEvents.constitutionalCrisis")!;
    const definition = WORLD_EVENT_SEED_DEFINITIONS.find(
      (candidate) => candidate.kind === "worldEvents.constitutionalCrisis"
    )!;

    expect(handler.defaultOptionId).toBe("judicialReview");
    expect(handler.options.map((option) => option.id)).toEqual([
      "judicialReview",
      "continuityProtocol",
      "crossPartyConference",
    ]);
    expect(
      handler.options.map(({ id, label, description, isDefault }) => ({
        id,
        label,
        description,
        ...(isDefault ? { isDefault } : {}),
      }))
    ).toEqual(definition.options);
  });

  it("uses random outcome tiers that cover the complete roll", () => {
    const handler = getEventHandler("worldEvents.constitutionalCrisis")!;
    const continuity = handler.options.find((option) => option.id === "continuityProtocol")!;

    expect(continuity.outcomeTable[0]).toMatchObject({ minRoll: 1, maxRoll: 45 });
    expect(continuity.outcomeTable.at(-1)).toMatchObject({ minRoll: 46, maxRoll: 100 });
    expect(
      continuity.outcomeTable.every((tier) =>
        tier.effects.some((effect) => effect.type === "democraticHealthDelta")
      )
    ).toBe(true);
    expect(
      continuity.outcomeTable.every((tier) =>
        tier.effects.some((effect) => effect.type === "presidentialHealthRelief")
      )
    ).toBe(true);
  });

  it("applies the selected declarative outcome once", async () => {
    const handler = getEventHandler("worldEvents.constitutionalCrisis")!;
    const option = handler.options.find((candidate) => candidate.id === "continuityProtocol")!;
    const tier = option.outcomeTable[0]!;
    const ctx = { option, tier } as EventResolveContext;

    await handler.applyEffects?.(ctx);

    expect(applyDeclarativeEffects).toHaveBeenCalledTimes(1);
    expect(applyDeclarativeEffects).toHaveBeenCalledWith(ctx, tier.effects);
  });
});
