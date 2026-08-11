import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.lotteryWin";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "lumpSum",
      label: "Take the lump sum",
      description: "Collect the jackpot now, minus taxes.",
      outcomeTable: threeTierTable(
        "Jackpot after tax",
        "Solid payout",
        "Modest winnings",
        [{ type: "personalWealth", deltaAnchor: 500_000 }],
        [{ type: "personalWealth", deltaAnchor: 200_000 }],
        [{ type: "personalWealth", deltaAnchor: 50_000 }]
      ),
    },
    {
      id: "annuity",
      label: "Take the annuity",
      description: "Steady political influence payments over the next several turns.",
      outcomeTable: threeTierTable(
        "Strong annuity",
        "Modest annuity",
        "Small cash consolation",
        [{ type: "custom", handlerKey: "lotteryAnnuity", payload: { piPerTurn: 3, turns: 8 } }],
        [{ type: "custom", handlerKey: "lotteryAnnuity", payload: { piPerTurn: 1, turns: 8 } }],
        [{ type: "personalWealth", deltaAnchor: 25_000 }]
      ),
    },
    {
      id: "donate",
      label: "Donate to charity",
      description: "Announce a charitable gift and ride the goodwill.",
      outcomeTable: threeTierTable(
        "National headlines",
        "Positive local coverage",
        "Quiet thank-you",
        [
          { type: "favorability", delta: 8 },
          { type: "infamy", delta: 2 },
        ],
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }]
      ),
    },
    {
      id: "ignore",
      label: "Let the ticket expire",
      description: "Do nothing — the window to claim may close.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Found unclaimed later",
        "Ticket expires",
        "Missed chance",
        [{ type: "personalWealth", deltaAnchor: 10_000 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
  async onResolve(ctx) {
    const annuityEffect = ctx.tier.effects.find(
      (e) => e.type === "custom" && e.handlerKey === "lotteryAnnuity"
    );
    if (!annuityEffect || annuityEffect.type !== "custom") {
      return;
    }
    const piPerTurn = Number(annuityEffect.payload.piPerTurn ?? 0);
    const turns = Number(annuityEffect.payload.turns ?? 0);
    if (piPerTurn <= 0 || turns <= 0) {
      return;
    }
    await ctx.db.collection("characters").updateOne(
      { _id: ctx.instance.scopeId },
      {
        $set: {
          preeLotteryAnnuity: { piPerTurn, turnsRemaining: turns },
          updatedAt: new Date(),
        },
      }
    );
  },
};

registerEventHandler(handler);

export { handler as lotteryWinHandler };
