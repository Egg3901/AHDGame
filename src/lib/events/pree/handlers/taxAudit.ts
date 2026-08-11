import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.taxAudit";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "cooperate",
      label: "Cooperate fully",
      description: "Open the books and answer every question.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Clean bill of health",
        "Minor discrepancies",
        "Back taxes owed",
        [{ type: "favorability", delta: 2 }],
        [{ type: "personalWealth", deltaAnchor: -50_000 }],
        [
          { type: "personalWealth", deltaAnchor: -150_000 },
          { type: "favorability", delta: -2 },
        ]
      ),
    },
    {
      id: "lawyers",
      label: "Hire elite tax attorneys",
      description: "Pay top counsel to fight every line item.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Loopholes hold",
        "Settled with fees",
        "Optics disaster",
        [{ type: "personalWealth", deltaAnchor: -25_000 }],
        [{ type: "personalWealth", deltaAnchor: -75_000 }],
        [
          { type: "personalWealth", deltaAnchor: -100_000 },
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "stonewall",
      label: "Stonewall the auditors",
      description: "Slow-walk every request and concede nothing.",
      outcomeTable: threeTierTable(
        "Auditors move on",
        "Penalties pile up",
        "Criminal referral",
        [],
        [
          { type: "personalWealth", deltaAnchor: -200_000 },
          { type: "infamy", delta: 2 },
        ],
        [
          { type: "personalWealth", deltaAnchor: -400_000 },
          { type: "favorability", delta: -8 },
          { type: "infamy", delta: 6 },
        ]
      ),
    },
    {
      id: "ignore",
      label: "Ignore the notice",
      description: "Toss the letter in a drawer and hope.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Lost in the backlog",
        "Default judgment",
        "Liens filed",
        [],
        [{ type: "personalWealth", deltaAnchor: -120_000 }],
        [
          { type: "personalWealth", deltaAnchor: -250_000 },
          { type: "favorability", delta: -3 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as taxAuditHandler };
