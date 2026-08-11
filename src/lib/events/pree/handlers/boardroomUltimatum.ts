import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.boardroomUltimatum";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "sell",
      label: "Offer to sell shares",
      description: "Signal willingness to dilute your position voluntarily.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Crisis averted, goodwill earned",
        "Offer accepted, costs manageable",
        "Bloc demands more than you offered",
        [
          { type: "corpSentiment", delta: 5 },
          { type: "personalWealth", deltaAnchor: -30_000 },
          { type: "infamy", delta: -2 },
        ],
        [
          { type: "corpSentiment", delta: 1 },
          { type: "personalWealth", deltaAnchor: -30_000 },
        ],
        [{ type: "corpSentiment", delta: -3 }]
      ),
    },
    {
      id: "bluff",
      label: "Call their bluff",
      description: "Dare them to follow through on the proxy threat.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Bloc backs down entirely",
        "Uneasy standoff",
        "Proxy campaign launched",
        [{ type: "corpSentiment", delta: 3 }],
        [{ type: "corpSentiment", delta: -3 }],
        [
          { type: "corpSentiment", delta: -10 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the ultimatum",
      description: "Say nothing and wait for them to act.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "They blink first",
        "Proxy vote begins",
        "Full public campaign against you",
        [{ type: "corpSentiment", delta: -6 }],
        [
          { type: "corpSentiment", delta: -10 },
          { type: "infamy", delta: 3 },
        ],
        [
          { type: "corpSentiment", delta: -15 },
          { type: "infamy", delta: 6 },
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

export { handler as boardroomUltimatumHandler };
