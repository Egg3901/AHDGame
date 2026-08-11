/**
 * World Events: richer UK royal occasion variants (jubilee / wedding / funeral).
 * Same handler kind as before — outcome tier is picked by roll so copy varies.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.royalEvent",
  defaultOptionId: "acknowledge",
  options: [
    {
      id: "acknowledge",
      label: "National celebration",
      description: "The nation marks the occasion.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 67,
          maxRoll: 100,
          label: "Jubilee crowds fill the Mall",
          effects: [
            { type: "approvalDelta", delta: 3 },
            { type: "sectorDemandModifier", sectorType: "entertainment", pct: 6, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Jubilee Crowds Fill the Mall in {country}",
            template:
              "A jubilee-style royal occasion in {country} drew packed crowds along ceremonial routes. {leader} joined the festivities as tourism and hospitality bookings surged.",
          },
        },
        {
          minRoll: 34,
          maxRoll: 66,
          label: "A royal wedding lifts the mood",
          effects: [
            { type: "approvalDelta", delta: 2 },
            { type: "sectorDemandModifier", sectorType: "entertainment", pct: 5, durationTurns: 6 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "Royal Wedding Captivates {country}",
            template:
              "A royal wedding in {country} dominated the news cycle and lifted the national mood. {leader} attended the ceremony as street parties spilled into the evening.",
          },
        },
        {
          minRoll: 1,
          maxRoll: 33,
          label: "The nation marks a solemn royal funeral",
          effects: [
            { type: "approvalDelta", delta: 1 },
            { type: "sectorDemandModifier", sectorType: "entertainment", pct: 2, durationTurns: 3 },
            { type: "wireOnly" },
          ],
          newsWire: {
            category: "general",
            title: "{country} Observes a Royal Funeral",
            template:
              "A solemn royal funeral in {country} brought quiet crowds and wall-to-wall coverage. {leader} represented the government at the service.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
