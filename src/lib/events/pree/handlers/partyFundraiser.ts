import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.partyFundraiser";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "noShow",
  options: [
    {
      id: "headline",
      label: "Headline the dinner",
      description: "Be the main draw of the evening.",
      primaryStat: "fundraising",
      outcomeTable: threeTierTable(
        "Big haul, party grateful",
        "Solid evening",
        "Thin crowd",
        [
          { type: "politicalInfluence", delta: 4 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "politicalInfluence", delta: 2 }],
        [{ type: "politicalInfluence", delta: 1 }]
      ),
    },
    {
      id: "dropBy",
      label: "Drop by briefly",
      description: "Shake hands and slip out.",
      primaryStat: "fundraising",
      outcomeTable: threeTierTable(
        "Right amount of face time",
        "Showed up, said hi",
        "Felt like a cameo",
        [{ type: "politicalInfluence", delta: 2 }],
        [{ type: "politicalInfluence", delta: 1 }],
        []
      ),
    },
    {
      id: "videoMessage",
      label: "Send a video message",
      description: "Tape some warm remarks instead.",
      outcomeTable: threeTierTable(
        "Slick clip plays well",
        "Adequate stand-in",
        "Seen as phoning it in",
        [{ type: "politicalInfluence", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "noShow",
      label: "No-show",
      description: "Skip it entirely.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Nobody keeps score",
        "Party notes the absence",
        "Donors feel snubbed",
        [],
        [{ type: "politicalInfluence", delta: -1 }],
        [
          { type: "politicalInfluence", delta: -2 },
          { type: "favorability", delta: -1 },
        ]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as partyFundraiserHandler };
