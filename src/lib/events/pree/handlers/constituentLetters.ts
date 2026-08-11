import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";

const KIND = "pree.constituentLetters";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "staffHandle",
  options: [
    {
      id: "personalReply",
      label: "Personally respond",
      description: "Write back to constituents yourself.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Replies shared far and wide",
        "Constituents feel heard",
        "Can't keep up with the volume",
        [{ type: "favorability", delta: 5 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -1 }]
      ),
    },
    {
      id: "formLetter",
      label: "Send a form-letter reply",
      description: "Acknowledge everyone with a template.",
      outcomeTable: threeTierTable(
        "Efficient and fine",
        "Generic but acceptable",
        "'Form letter' backlash",
        [{ type: "favorability", delta: 1 }],
        [],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "listeningSession",
      label: "Hold a listening session",
      description: "Invite them in to be heard in person.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Town becomes a fan",
        "Good faith noted",
        "Turns into a gripe-fest",
        [{ type: "favorability", delta: 6 }],
        [{ type: "favorability", delta: 2 }],
        [{ type: "favorability", delta: -2 }]
      ),
    },
    {
      id: "staffHandle",
      label: "Let staff handle it",
      description: "Route it to the district office.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Handled smoothly",
        "Quietly processed",
        "Constituents feel ignored",
        [],
        [],
        [{ type: "favorability", delta: -2 }]
      ),
    },
  ],
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as constituentLettersHandler };
