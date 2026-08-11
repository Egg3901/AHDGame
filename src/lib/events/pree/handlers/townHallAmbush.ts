import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.townHallAmbush";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "walkAway",
  options: [
    {
      id: "engage",
      label: "Engage honestly",
      description: "Take the question head-on, unscripted.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Authenticity goes viral",
        "Solid exchange",
        "Fumbled answer",
        [{ type: "favorability", delta: 6 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -4 }]
      ),
    },
    {
      id: "deflect",
      label: "Deflect with talking points",
      description: "Pivot to the prepared message.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Smooth pivot",
        "Visibly evasive",
        "Dodge becomes the story",
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -2 }],
        [{ type: "favorability", delta: -6 }]
      ),
    },
    {
      id: "mock",
      label: "Mock the questioner",
      description: "Play to the room at their expense.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Crowd loves it",
        "Reads as a bully",
        "Clip plays for weeks",
        [
          { type: "favorability", delta: 4 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "favorability", delta: -5 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "favorability", delta: -12 },
          { type: "infamy", delta: 5 },
        ]
      ),
    },
    {
      id: "walkAway",
      label: "Walk away",
      description: "End the event early and leave.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Barely noticed",
        "Looks dismissive",
        "Empty podium photo spreads",
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -3 }],
        [{ type: "favorability", delta: -7 }]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as townHallAmbushHandler };
