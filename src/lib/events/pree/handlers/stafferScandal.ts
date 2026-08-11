import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildElectionPayload, pickStafferName } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.stafferScandal";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "apologize",
      label: "Go public and apologize",
      description: "Get ahead of the story with a press conference.",
      primaryStat: "charisma",
      outcomeTable: threeTierTable(
        "Contained damage",
        "Rough news cycle",
        "Campaign hemorrhaging",
        [{ type: "favorability", delta: -2 }],
        [{ type: "favorability", delta: -5 }],
        [
          { type: "favorability", delta: -10 },
          { type: "campaignSupport", delta: -3 },
        ]
      ),
    },
    {
      id: "contain",
      label: "Contain the press",
      description: "Limit access and hope it fades.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Story fades",
        "Persistent rumors",
        "Cover-up narrative",
        [{ type: "favorability", delta: -1 }],
        [{ type: "favorability", delta: -4 }],
        [{ type: "favorability", delta: -15 }]
      ),
    },
    {
      id: "fire",
      label: "Fire the staffer and pivot",
      description: "Cut ties and change the subject.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Decisive leadership",
        "Mixed reviews",
        "Chaos on staff",
        [{ type: "favorability", delta: 1 }],
        [{ type: "favorability", delta: -2 }],
        [{ type: "favorability", delta: -8 }]
      ),
    },
    {
      id: "ignore",
      label: "Ignore it",
      description: "Hope it blows over on its own.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Slow bleed",
        "Growing story",
        "Scandal dominates",
        [{ type: "favorability", delta: -3 }],
        [{ type: "favorability", delta: -6 }],
        [{ type: "favorability", delta: -12 }]
      ),
    },
  ],
  async buildPayload(ctx) {
    const base = await buildElectionPayload(ctx);
    return {
      ...base,
      stafferName: pickStafferName(ctx.character._id.toHexString(), ctx.currentTurn),
    };
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as stafferScandalHandler };
