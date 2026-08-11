import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildElectionPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.endorsementDilemma";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "noComment",
  options: [
    {
      id: "embrace",
      label: "Embrace the endorsement",
      description: "Share the stage and own the association.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Their base shows up for you",
        "Modest boost",
        "Backlash sticks to you",
        [
          { type: "campaignSupport", delta: 5 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "campaignSupport", delta: 2 }],
        [
          { type: "campaignSupport", delta: -4 },
          { type: "favorability", delta: -3 },
        ]
      ),
    },
    {
      id: "quietAccept",
      label: "Accept quietly",
      description: "Take the support, skip the photo op.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Best of both worlds",
        "Small lift",
        "Leaked anyway",
        [{ type: "campaignSupport", delta: 3 }],
        [{ type: "campaignSupport", delta: 1 }],
        [{ type: "campaignSupport", delta: -2 }]
      ),
    },
    {
      id: "reject",
      label: "Publicly reject it",
      description: "Distance yourself on principle.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Principled stand lands",
        "A wash",
        "Their fans turn on you",
        [
          { type: "favorability", delta: 2 },
          { type: "campaignSupport", delta: 1 },
        ],
        [],
        [{ type: "campaignSupport", delta: -3 }]
      ),
    },
    {
      id: "noComment",
      label: "Say nothing",
      description: "Let the news cycle decide.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Quiet net positive",
        "No movement",
        "Indecision becomes the story",
        [{ type: "campaignSupport", delta: 1 }],
        [],
        [
          { type: "campaignSupport", delta: -2 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
  ],
  async buildPayload(ctx) {
    return buildElectionPayload(ctx);
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as endorsementDilemmaHandler };
