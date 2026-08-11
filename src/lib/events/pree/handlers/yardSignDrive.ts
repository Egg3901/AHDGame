import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildElectionPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.yardSignDrive";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "letCool",
  options: [
    {
      id: "bigBatch",
      label: "Order a big batch",
      description: "Spend campaign funds to flood the district.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Signs everywhere",
        "Good visibility",
        "Signs sit in storage",
        [
          { type: "campaignSupport", delta: 4 },
          { type: "campaignFunds", deltaLocal: -10_000 },
        ],
        [
          { type: "campaignSupport", delta: 2 },
          { type: "campaignFunds", deltaLocal: -10_000 },
        ],
        [{ type: "campaignFunds", deltaLocal: -10_000 }]
      ),
    },
    {
      id: "conservativePrint",
      label: "Print conservatively",
      description: "Order a measured run of signs.",
      outcomeTable: threeTierTable(
        "Right-sized order",
        "Adequate supply",
        "Ran out fast",
        [
          { type: "campaignSupport", delta: 2 },
          { type: "campaignFunds", deltaLocal: -3_000 },
        ],
        [
          { type: "campaignSupport", delta: 1 },
          { type: "campaignFunds", deltaLocal: -3_000 },
        ],
        [{ type: "campaignFunds", deltaLocal: -3_000 }]
      ),
    },
    {
      id: "digitalOnly",
      label: "Go digital-only",
      description: "Skip the signs, push online instead.",
      outcomeTable: threeTierTable(
        "Online buzz beats lawns",
        "Modest digital reach",
        "Lost the yard-sign war",
        [{ type: "campaignSupport", delta: 3 }],
        [{ type: "campaignSupport", delta: 1 }],
        [{ type: "campaignSupport", delta: -1 }]
      ),
    },
    {
      id: "letCool",
      label: "Let demand cool",
      description: "Tell supporters to sit tight.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Demand was overstated",
        "Supporters shrug",
        "Looks disorganized",
        [],
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

export { handler as yardSignDriveHandler };
