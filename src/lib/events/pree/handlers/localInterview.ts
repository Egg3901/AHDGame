import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.localInterview";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "fullInterview",
      label: "Sit for the full interview",
      description: "Give them your time on camera.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Charming segment",
        "Solid hit",
        "Stumbled on a question",
        [{ type: "favorability", delta: 4 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "statement",
      label: "Email a statement",
      description: "Send a few quotable lines instead.",
      outcomeTable: threeTierTable(
        "Clean quote runs",
        "Buried on page six",
        "Quote taken out of context",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "decline",
      label: "Decline politely",
      description: "Thank them but pass.",
      outcomeTable: threeTierTable(
        "No story without you",
        "Mild grumbling",
        "Ran an unflattering angle",
        [],
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "ignore",
      label: "Don't reply",
      description: "Let the request go cold.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Deadline passes quietly",
        "Ran as 'did not respond'",
        "Looks evasive",
        [],
        [{ type: "favorability", delta: -1 }],
        [
          { type: "favorability", delta: -2 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as localInterviewHandler };
