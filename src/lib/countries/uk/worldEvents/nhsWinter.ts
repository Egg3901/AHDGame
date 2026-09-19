/**
 * UK NHS winter pressure — national wire + approval nudge.
 * Milder when acknowledged; sharper hit if the executive shrugs.
 */
import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";

const apply: EventHandler["applyEffects"] = async (ctx) => {
  await applyDeclarativeEffects(ctx, ctx.tier.effects);
};

registerEventHandler({
  kind: "worldEvents.ukNhsWinter",
  defaultOptionId: "acknowledge",
  options: [
    {
      id: "acknowledge",
      label: "Acknowledge the winter crisis",
      description: "Promise surge capacity and thank staff.",
      isDefault: true,
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Managed winter narrative",
          effects: [{ type: "approvalDelta", delta: -1 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "NHS Winter Pressure Grips {country}",
            template:
              "Ambulance queues and cancelled electives dominated the winter bulletins in {country}. {leader} promised surge capacity and thanked frontline staff.",
          },
        },
      ],
    },
    {
      id: "surge",
      label: "Announce an emergency surge package",
      description: "Throw money and beds at the problem.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Surge package lands",
          effects: [{ type: "approvalDelta", delta: 1 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "{country} Announces NHS Winter Surge",
            template:
              "{leader} unveiled an emergency NHS winter package as waiting times hit the headlines across {country}.",
          },
        },
      ],
    },
    {
      id: "shrug",
      label: "Call it seasonal and move on",
      description: "Downplay the crisis.",
      outcomeTable: [
        {
          minRoll: 1,
          maxRoll: 100,
          label: "Tone-deaf shrug",
          effects: [{ type: "approvalDelta", delta: -3 }, { type: "wireOnly" }],
          newsWire: {
            category: "general",
            title: "Anger at {country} NHS Winter Response",
            template:
              "{leader}'s suggestion that NHS winter pressure was 'just seasonal' went down badly with staff and patients alike.",
          },
        },
      ],
    },
  ],
  applyEffects: apply,
});
