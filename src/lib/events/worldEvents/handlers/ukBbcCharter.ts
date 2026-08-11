/**
 * UK BBC charter skirmish — media-governance flavor wire.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.ukBbcCharter",
  defaultOptionId: "steady",
  options: [
    {
      id: "steady",
      label: "Defend the charter settlement",
      description: "Keep the licence fee and editorial independence line.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Charter skirmish contained",
          effects: [{ type: "approvalDelta", delta: 0 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "BBC Charter Row Simmers in {country}",
            template:
              "A familiar row over the BBC charter and licence fee flared in {country}. {leader} stuck to the existing settlement and hoped the Sunday papers would move on.",
          },
        },
      ],
    },
    {
      id: "reform",
      label: "Open a reform review",
      description: "Threaten funding changes and governance tweaks.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Reform review announced",
          effects: [{ type: "approvalDelta", delta: 1 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Opens BBC Charter Review",
            template:
              "{leader} announced a review of BBC funding and governance, delighting critics of the corporation and alarming its defenders.",
          },
        },
      ],
    },
    {
      id: "clash",
      label: "Pick a public fight with the Director-General",
      description: "Escalate into a culture-war clip fight.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Culture-war clip fight",
          effects: [{ type: "approvalDelta", delta: -1 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{leader} Clashes with the BBC",
            template:
              "A public spat between {leader} and the BBC's leadership dominated the airwaves in {country}, generating more heat than charter substance.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
