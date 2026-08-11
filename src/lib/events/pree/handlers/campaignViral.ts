import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildElectionPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.campaignViral";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "nothing",
  options: [
    {
      id: "leanIn",
      label: "Lean in — post more",
      description: "Ride the wave with more content.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Viral surge",
        "Solid bump",
        "Cringe backlash",
        [
          { type: "campaignSupport", delta: 6 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "campaignSupport", delta: 2 }],
        [{ type: "favorability", delta: -3 }]
      ),
    },
    {
      id: "disciplined",
      label: "Stay disciplined",
      description: "Stick to the message and avoid feeding the clip.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Measured gain",
        "Small lift",
        "Flat reception",
        [{ type: "campaignSupport", delta: 3 }],
        [{ type: "campaignSupport", delta: 1 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "delete",
      label: "Delete and move on",
      description: "Scrub the post and change topics.",
      outcomeTable: threeTierTable(
        "Narrative control",
        "Awkward silence",
        "Streisand effect",
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -5 },
          { type: "campaignSupport", delta: -2 },
        ]
      ),
    },
    {
      id: "nothing",
      label: "Do nothing",
      description: "Let the internet decide your fate.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Organic lift",
        "No change",
        "Support slips",
        [{ type: "campaignSupport", delta: 1 }],
        [],
        [{ type: "campaignSupport", delta: -2 }]
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

export { handler as campaignViralHandler };
