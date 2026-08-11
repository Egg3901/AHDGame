import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.productRecall";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "recall",
      label: "Issue a voluntary recall",
      description: "Pull the product before regulators force you to.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Textbook crisis management",
        "Costly but contained",
        "Recall botched",
        [
          { type: "corpSentiment", delta: 6 },
          { type: "favorability", delta: 2 },
        ],
        [{ type: "corpSentiment", delta: -2 }],
        [{ type: "corpSentiment", delta: -5 }]
      ),
    },
    {
      id: "silentFix",
      label: "Fix it quietly",
      description: "Patch the line and say nothing.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Nobody notices",
        "Trickle of complaints",
        "Cover-up exposed",
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -3 }],
        [
          { type: "corpSentiment", delta: -8 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "blameSuppliers",
      label: "Blame the suppliers",
      description: "Point the press at the component vendors.",
      outcomeTable: threeTierTable(
        "Narrative holds",
        "Suppliers fire back",
        "Paper trail says otherwise",
        [{ type: "corpSentiment", delta: -1 }],
        [
          { type: "corpSentiment", delta: -4 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "corpSentiment", delta: -10 },
          { type: "infamy", delta: 6 },
          { type: "favorability", delta: -4 },
        ]
      ),
    },
    {
      id: "ignore",
      label: "Ship it anyway",
      description: "The defect rate is within tolerance. Probably.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Defects stay rare",
        "Returns climb",
        "Injury lawsuit filed",
        [{ type: "corpSentiment", delta: -2 }],
        [{ type: "corpSentiment", delta: -5 }],
        [
          { type: "corpSentiment", delta: -9 },
          { type: "favorability", delta: -3 },
        ]
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

export { handler as productRecallHandler };
