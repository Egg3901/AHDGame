import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.juryDuty";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "serve",
      label: "Serve like everyone else",
      description: "Report for duty and sit the trial.",
      primaryStat: "intellect",
      outcomeTable: threeTierTable(
        "Man-of-the-people coverage",
        "Civic duty done",
        "Tedious week, no upside",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 1 }],
        []
      ),
    },
    {
      id: "deferral",
      label: "Request a hardship deferral",
      description: "Ask the clerk to push it back.",
      outcomeTable: threeTierTable(
        "Reasonable accommodation",
        "Granted without fuss",
        "Clerk unimpressed",
        [],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "getExcused",
      label: "Have a lawyer get you excused",
      description: "Make it quietly go away.",
      outcomeTable: threeTierTable(
        "Quietly excused",
        "Lawyered out",
        "'Too important for jury duty'",
        [],
        [{ type: "infamy", delta: 1 }],
        [
          { type: "favorability", delta: -3 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
    {
      id: "ignore",
      label: "Toss the letter",
      description: "Pretend it never arrived.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Slips through the cracks",
        "Stern reminder letter",
        "Contempt citation",
        [],
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -4 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as juryDutyHandler };
