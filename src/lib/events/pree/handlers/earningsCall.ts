import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.earningsCall";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "cfoRuns",
  options: [
    {
      id: "projectConfidence",
      label: "Project confidence",
      description: "Talk up the quarter and the outlook.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Stock pops",
        "Market mildly pleased",
        "Overpromised, analysts wary",
        [{ type: "corpSentiment", delta: 6 }],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -3 }]
      ),
    },
    {
      id: "cautiousGuidance",
      label: "Set cautious guidance",
      description: "Under-promise so you can over-deliver.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Credibility rewarded",
        "Steady as she goes",
        "Read as weakness",
        [{ type: "corpSentiment", delta: 3 }],
        [{ type: "corpSentiment", delta: 1 }],
        [{ type: "corpSentiment", delta: -2 }]
      ),
    },
    {
      id: "stickScript",
      label: "Stick to the script",
      description: "Read the prepared remarks, nothing more.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "No surprises, fine",
        "Flat reaction",
        "Seen as evasive",
        [{ type: "corpSentiment", delta: 1 }],
        [],
        [{ type: "corpSentiment", delta: -2 }]
      ),
    },
    {
      id: "cfoRuns",
      label: "Let the CFO run it",
      description: "Hand the call to your finance chief.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "CFO nails it",
        "Uneventful",
        "Absence raises questions",
        [{ type: "corpSentiment", delta: 1 }],
        [],
        [{ type: "corpSentiment", delta: -2 }]
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

export { handler as earningsCallHandler };
