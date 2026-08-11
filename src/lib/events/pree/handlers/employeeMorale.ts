import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.employeeMorale";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "fileAway",
  options: [
    {
      id: "townHall",
      label: "Town hall and visible changes",
      description: "Address the staff and act on the feedback.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Morale rebounds",
        "Staff appreciate it",
        "Seen as theater",
        [{ type: "corpSentiment", delta: 5 }],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -1 }]
      ),
    },
    {
      id: "perks",
      label: "Targeted perks",
      description: "Spend a little to keep people happy.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Retention improves",
        "Modest lift",
        "Perks fall flat",
        [
          { type: "corpSentiment", delta: 3 },
          { type: "personalWealth", deltaAnchor: -20_000 },
        ],
        [
          { type: "corpSentiment", delta: 1 },
          { type: "personalWealth", deltaAnchor: -20_000 },
        ],
        [{ type: "personalWealth", deltaAnchor: -20_000 }]
      ),
    },
    {
      id: "memo",
      label: "Memo from the top",
      description: "Send an all-hands message.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Words land well",
        "Read and forgotten",
        "Tone-deaf memo leaks",
        [{ type: "corpSentiment", delta: 1 }],
        [],
        [{ type: "corpSentiment", delta: -3 }]
      ),
    },
    {
      id: "fileAway",
      label: "File it away",
      description: "Note the numbers and move on.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "No fallout",
        "Slow drift",
        "Talent starts leaving",
        [],
        [{ type: "corpSentiment", delta: -1 }],
        [{ type: "corpSentiment", delta: -4 }]
      ),
    },
  ],
  async buildPayload(ctx) {
    return buildCeoCorpPayload(ctx);
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as employeeMoraleHandler };
