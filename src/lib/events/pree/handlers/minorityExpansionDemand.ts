import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";
import { seededRoll } from "@/lib/events/substrate/rng";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";

const KIND = "pree.minorityExpansionDemand";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "decline",
  options: [
    {
      id: "agree",
      label: "Agree to explore it",
      description: "Commission a market assessment for the state.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Shareholder thrilled, goodwill spreads",
        "Credibility maintained",
        "Expansion flops, shareholder sour",
        [
          { type: "corpSentiment", delta: 6 },
          { type: "personalWealth", deltaAnchor: -20_000 },
        ],
        [
          { type: "corpSentiment", delta: 1 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ],
        [
          { type: "corpSentiment", delta: -3 },
          { type: "personalWealth", deltaAnchor: -10_000 },
        ]
      ),
    },
    {
      id: "stall",
      label: "Promise a feasibility study",
      description: "Buy time with a vague commitment.",
      primaryStat: "statecraft",
      outcomeTable: threeTierTable(
        "Shareholder mollified for now",
        "Skepticism grows",
        "Seen as an empty promise",
        [{ type: "corpSentiment", delta: 3 }],
        [{ type: "corpSentiment", delta: -1 }],
        [
          { type: "corpSentiment", delta: -5 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "decline",
      label: "Decline outright",
      description: "Inform them the expansion isn't viable.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Shareholder accepts it",
        "Relationship strained",
        "Shareholder threatens to exit",
        [{ type: "corpSentiment", delta: -4 }],
        [{ type: "corpSentiment", delta: -7 }],
        [
          { type: "corpSentiment", delta: -10 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
  ],
  async buildPayload(ctx) {
    const corp = await ctx.db
      .collection<Corporation>("corporations")
      .findOne({ ceoId: ctx.character._id }, { projection: { _id: 1, name: 1, shareholders: 1 } });
    if (!corp) return null;

    const ceoIdStr = ctx.character._id.toString();
    const minorityCharacterIds = (
      (corp.shareholders as Array<{
        characterId?: ObjectId;
        shares: number;
      }>) ?? []
    )
      .filter((s) => s.characterId && s.characterId.toString() !== ceoIdStr && s.shares > 0)
      .map((s) => s.characterId as ObjectId);

    if (minorityCharacterIds.length === 0) return null;

    const roll = seededRoll(
      ctx.character._id.toHexString(),
      ctx.currentTurn,
      KIND,
      "shareholderPick"
    );
    const picked = minorityCharacterIds[(roll - 1) % minorityCharacterIds.length]!;

    const shareholder = await ctx.db
      .collection<Character>("characters")
      .findOne({ _id: picked }, { projection: { name: 1, homeState: 1 } });
    if (!shareholder) return null;

    return {
      corporationId: corp._id,
      corpName: corp.name,
      shareholderName: shareholder.name,
      stateName: shareholder.homeState,
    };
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as minorityExpansionDemandHandler };
