import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildCeoCorpPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.vendorRenewal";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "autoRenew",
  options: [
    {
      id: "squeeze",
      label: "Squeeze them hard",
      description: "Demand a steep discount to renew.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Big savings locked in",
        "Modest concession",
        "Vendor walks",
        [{ type: "corpSentiment", delta: 4 }],
        [{ type: "corpSentiment", delta: 1 }],
        [{ type: "corpSentiment", delta: -4 }]
      ),
    },
    {
      id: "fairTerms",
      label: "Renew at fair terms",
      description: "Split the difference and move on.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Loyal partner secured",
        "Clean renewal",
        "Slightly overpaid",
        [{ type: "corpSentiment", delta: 3 }],
        [{ type: "corpSentiment", delta: 1 }],
        [{ type: "corpSentiment", delta: -1 }]
      ),
    },
    {
      id: "shopAround",
      label: "Shop for alternatives",
      description: "Put the contract out to bid.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Found a better deal",
        "Comparable options",
        "Wasted weeks, came back",
        [{ type: "corpSentiment", delta: 5 }],
        [],
        [{ type: "corpSentiment", delta: -2 }]
      ),
    },
    {
      id: "autoRenew",
      label: "Auto-renew",
      description: "Let the contract roll over as-is.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Frictionless",
        "Status quo",
        "Locked into a bad rate",
        [{ type: "corpSentiment", delta: 1 }],
        [],
        [{ type: "corpSentiment", delta: -3 }]
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

export { handler as vendorRenewalHandler };
