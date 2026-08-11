import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { buildElectionPayload } from "../payload";
import { threeTierTable } from "./tiers";

const KIND = "pree.canvassWeekend";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "dayOff",
  options: [
    {
      id: "knockYourself",
      label: "Knock doors yourself",
      description: "Hit the pavement with the walk lists.",
      primaryStat: "energy",
      outcomeTable: threeTierTable(
        "Voters love the personal touch",
        "Good conversations",
        "Long day, few homes",
        [
          { type: "campaignSupport", delta: 5 },
          { type: "favorability", delta: 1 },
        ],
        [{ type: "campaignSupport", delta: 2 }],
        [{ type: "campaignSupport", delta: 1 }]
      ),
    },
    {
      id: "sendVolunteers",
      label: "Send volunteers to swing precincts",
      description: "Point the field team where it counts.",
      outcomeTable: threeTierTable(
        "Swing precincts covered",
        "Decent coverage",
        "Volunteers fizzle",
        [{ type: "campaignSupport", delta: 4 }],
        [{ type: "campaignSupport", delta: 2 }],
        []
      ),
    },
    {
      id: "phoneBank",
      label: "Phone bank instead",
      description: "Work the call lists from HQ.",
      outcomeTable: threeTierTable(
        "Efficient outreach",
        "Steady dials",
        "Mostly voicemails",
        [{ type: "campaignSupport", delta: 3 }],
        [{ type: "campaignSupport", delta: 1 }],
        []
      ),
    },
    {
      id: "dayOff",
      label: "Take the day off",
      description: "Rest the team and yourself.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Rested and sharp",
        "Quiet weekend",
        "Opponent out-hustles you",
        [{ type: "favorability", delta: 1 }],
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

export { handler as canvassWeekendHandler };
