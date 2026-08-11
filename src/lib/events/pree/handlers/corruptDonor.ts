import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { pickDonorAmountAnchor, pickDonorLabel } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.corruptDonor";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "noComment",
  options: [
    {
      id: "return",
      label: "Return the money and cooperate",
      description: "Give it back and promise transparency.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Credibility restored",
        "Mixed headlines",
        "Investigation opened",
        [
          { type: "favorability", delta: 4 },
          { type: "campaignFunds", deltaLocal: -50_000 },
        ],
        [{ type: "favorability", delta: 1 }],
        [
          { type: "favorability", delta: -5 },
          { type: "infamy", delta: 4 },
        ]
      ),
    },
    {
      id: "distance",
      label: "Distance yourself publicly",
      description: "Deny knowledge and blame staff.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Plausible denial",
        "Damaging story",
        "Career stain",
        [{ type: "favorability", delta: -2 }],
        [{ type: "favorability", delta: -6 }],
        [
          { type: "favorability", delta: -12 },
          { type: "infamy", delta: 5 },
        ]
      ),
    },
    {
      id: "attack",
      label: "Attack the source",
      description: "Go on offense against whoever leaked the story.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Counter-narrative lands or backfires",
        "Backfire",
        "Disaster",
        [{ type: "custom", handlerKey: "attackSourceHigh", payload: {} }],
        [{ type: "favorability", delta: -4 }],
        [
          { type: "favorability", delta: -15 },
          { type: "infamy", delta: 8 },
        ]
      ),
    },
    {
      id: "noComment",
      label: "No comment",
      description: "Refuse to engage with reporters.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Story simmers",
        "Pressure builds",
        "Scandal defines you",
        [{ type: "favorability", delta: -4 }],
        [{ type: "favorability", delta: -8 }],
        [
          { type: "favorability", delta: -14 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
  ],
  async buildPayload(ctx) {
    const id = ctx.character._id.toHexString();
    return {
      donorLabel: pickDonorLabel(id, ctx.currentTurn),
      amount: pickDonorAmountAnchor(id, ctx.currentTurn),
    };
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
  async onResolve(ctx) {
    if (ctx.option.id !== "attack" || ctx.instance.roll < 80) {
      return;
    }
    const delta = ctx.instance.roll >= 90 ? 2 : -8;
    await applyDeclarativeEffects(ctx, [{ type: "favorability", delta }]);
  },
};

registerEventHandler(handler);

export { handler as corruptDonorHandler };
