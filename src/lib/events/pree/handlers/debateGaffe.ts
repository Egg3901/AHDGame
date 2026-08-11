import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildElectionPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.debateGaffe";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "sayNothing",
  options: [
    {
      id: "ownIt",
      label: "Own it with humor",
      description: "Make the joke before anyone else can.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Self-deprecation wins the night",
        "Defused",
        "Joke lands flat",
        [
          { type: "campaignSupport", delta: 4 },
          { type: "favorability", delta: 3 },
        ],
        [{ type: "campaignSupport", delta: 1 }],
        [{ type: "campaignSupport", delta: -3 }]
      ),
    },
    {
      id: "apologize",
      label: "Issue a formal apology",
      description: "A sober statement from the campaign.",
      outcomeTable: threeTierTable(
        "Contrition respected",
        "Keeps the clip alive",
        "Apology becomes the headline",
        [{ type: "favorability", delta: 1 }],
        [{ type: "campaignSupport", delta: -1 }],
        [
          { type: "favorability", delta: -3 },
          { type: "campaignSupport", delta: -2 },
        ]
      ),
    },
    {
      id: "deny",
      label: "Deny everything",
      description: "Claim the audio was doctored.",
      outcomeTable: threeTierTable(
        "Doubt takes hold",
        "Nobody buys it",
        "Forensics prove it's real",
        [],
        [{ type: "favorability", delta: -4 }],
        [
          { type: "favorability", delta: -10 },
          { type: "campaignSupport", delta: -4 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "sayNothing",
      label: "Say nothing",
      description: "Refuse to dignify it.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Cycle moves on",
        "Slow drip",
        "Silence reads as guilt",
        [{ type: "campaignSupport", delta: -1 }],
        [{ type: "campaignSupport", delta: -2 }],
        [
          { type: "campaignSupport", delta: -4 },
          { type: "favorability", delta: -2 },
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

export { handler as debateGaffeHandler };
