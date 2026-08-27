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

const expectedEffects: Record<string, Record<string, unknown[][]>> = {
  "worldEvents.panicBuying": {
    ration: [
      [
        { type: "approvalDelta", delta: -3 },
        { type: "warEmergencyMitigation", pct: 12, durationTurns: 18 },
        { type: "civilLibertiesDelta", delta: -2 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: -8, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "entertainment", pct: -5, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "manufacturing", pct: 6, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "defense", pct: 8, durationTurns: 8 },
        { type: "wireOnly" },
      ],
    ],
    calm: [
      [
        { type: "approvalDelta", delta: -3 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: 10, durationTurns: 4 },
        { type: "sectorDemandModifier", sectorType: "agriculture", pct: 8, durationTurns: 4 },
        { type: "wireOnly" },
      ],
      [
        { type: "approvalDelta", delta: 1 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: 4, durationTurns: 4 },
        { type: "wireOnly" },
      ],
    ],
    release: [
      [
        { type: "approvalDelta", delta: 2 },
        { type: "treasuryDelta", deltaAnchor: -10_000 },
        { type: "warEmergencyMitigation", pct: 8, durationTurns: 10 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: 2, durationTurns: 4 },
        { type: "sectorDemandModifier", sectorType: "manufacturing", pct: 3, durationTurns: 6 },
        { type: "sectorDemandModifier", sectorType: "defense", pct: 2, durationTurns: 6 },
        { type: "wireOnly" },
      ],
    ],
  },
  "worldEvents.bankRun": {
    guarantee: [
      [
        { type: "approvalDelta", delta: 3 },
        { type: "treasuryDelta", deltaAnchor: -20_000 },
        { type: "warEmergencyMitigation", pct: 10, durationTurns: 12 },
        { type: "sectorDemandModifier", sectorType: "financial", pct: 3, durationTurns: 6 },
        { type: "wireOnly" },
      ],
    ],
    holiday: [
      [
        { type: "approvalDelta", delta: -4 },
        { type: "warEmergencyMitigation", pct: 14, durationTurns: 18 },
        { type: "civilLibertiesDelta", delta: -3 },
        { type: "sectorDemandModifier", sectorType: "financial", pct: -8, durationTurns: 6 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: -6, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "manufacturing", pct: 6, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "defense", pct: 7, durationTurns: 8 },
        { type: "wireOnly" },
      ],
    ],
    standBy: [
      [
        { type: "approvalDelta", delta: -4 },
        { type: "sectorDemandModifier", sectorType: "financial", pct: -10, durationTurns: 8 },
        { type: "wireOnly" },
      ],
      [
        { type: "sectorDemandModifier", sectorType: "financial", pct: -3, durationTurns: 4 },
        { type: "wireOnly" },
      ],
    ],
  },
  "worldEvents.civilDefenseFever": {
    fund: [
      [
        { type: "approvalDelta", delta: 2 },
        { type: "treasuryDelta", deltaAnchor: -15_000 },
        { type: "warEmergencyMitigation", pct: 10, durationTurns: 14 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: -3, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "construction", pct: 8, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "manufacturing", pct: 6, durationTurns: 8 },
        { type: "sectorDemandModifier", sectorType: "defense", pct: 8, durationTurns: 8 },
        { type: "wireOnly" },
      ],
    ],
    drills: [
      [
        { type: "approvalDelta", delta: 1 },
        { type: "warEmergencyMitigation", pct: 8, durationTurns: 12 },
        { type: "civilLibertiesDelta", delta: -1 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: -2, durationTurns: 6 },
        { type: "sectorDemandModifier", sectorType: "construction", pct: 3, durationTurns: 6 },
        { type: "sectorDemandModifier", sectorType: "manufacturing", pct: 3, durationTurns: 6 },
        { type: "sectorDemandModifier", sectorType: "defense", pct: 4, durationTurns: 6 },
        { type: "wireOnly" },
      ],
    ],
    dismiss: [[{ type: "approvalDelta", delta: -2 }, { type: "wireOnly" }]],
  },
  "worldEvents.warScareProtests": {
    address: [
      [
        { type: "approvalDelta", delta: -2 },
        { type: "warEmergencyMitigation", pct: 4, durationTurns: 8 },
        { type: "wireOnly" },
      ],
      [
        { type: "approvalDelta", delta: 3 },
        { type: "warEmergencyMitigation", pct: 4, durationTurns: 8 },
        { type: "wireOnly" },
      ],
    ],
    acknowledge: [[{ type: "approvalDelta", delta: -2 }, { type: "wireOnly" }]],
    crackdown: [
      [
        { type: "approvalDelta", delta: -6 },
        { type: "warEmergencyMitigation", pct: 18, durationTurns: 24 },
        { type: "civilLibertiesDelta", delta: -7 },
        { type: "sectorDemandModifier", sectorType: "retail", pct: -8, durationTurns: 10 },
        {
          type: "sectorDemandModifier",
          sectorType: "entertainment",
          pct: -10,
          durationTurns: 10,
        },
        { type: "sectorDemandModifier", sectorType: "manufacturing", pct: 8, durationTurns: 10 },
        { type: "sectorDemandModifier", sectorType: "defense", pct: 10, durationTurns: 10 },
        { type: "wireOnly" },
      ],
    ],
  },
};

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
        expect(
          option.outcomeTable.map((tier) => tier.effects),
          `${kind}:${option.id}`
        ).toEqual(expectedEffects[kind]?.[option.id]);
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
