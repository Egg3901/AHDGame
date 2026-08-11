import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { seededRoll } from "@/lib/events/substrate/rng";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const KIND = "pree.minorityStrategyPressure";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "ignore",
  options: [
    {
      id: "engage",
      label: "Engage the proposal",
      description: "Bring the shareholders to the table and negotiate the pivot.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Markets rally on the pivot",
        "Goodwill maintained",
        "Costly misfire",
        [
          { type: "corpSentiment", delta: 8 },
          { type: "personalWealth", deltaAnchor: -15_000 },
        ],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -4 }]
      ),
    },
    {
      id: "negotiate",
      label: "Negotiate a timeline",
      description: "Acknowledge their concerns and offer a phased review.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Shareholders satisfied with roadmap",
        "Temporary goodwill",
        "Seen as stalling",
        [{ type: "corpSentiment", delta: 4 }],
        [{ type: "corpSentiment", delta: -2 }],
        [{ type: "corpSentiment", delta: -6 }]
      ),
    },
    {
      id: "ignore",
      label: "Dismiss the demand",
      description: "File the letter and say nothing.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Bloc backs down",
        "Tension builds",
        "Public campaign launched",
        [{ type: "corpSentiment", delta: -4 }],
        [{ type: "corpSentiment", delta: -7 }],
        [
          { type: "corpSentiment", delta: -10 },
          { type: "infamy", delta: 2 },
        ]
      ),
    },
  ],
  async buildPayload(ctx) {
    const corp = await ctx.db
      .collection<Corporation>("corporations")
      .findOne({ ceoId: ctx.character._id }, { projection: { _id: 1, name: 1 } });
    if (!corp) return null;

    const sectors = await ctx.db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corp._id })
      .project({ sectorType: 1, strategyId: 1, revenue: 1 })
      .toArray();

    const eligible = (
      sectors as Array<Pick<CorporateSector, "sectorType" | "strategyId" | "revenue">>
    )
      .filter((s) => {
        const strats = SECTOR_STRATEGIES[s.sectorType as CorporationType];
        return strats && strats.length > 1;
      })
      .sort((a, b) => ((b.revenue as number) ?? 0) - ((a.revenue as number) ?? 0));

    if (eligible.length === 0) return null;

    const sector = eligible[0]!;
    const sectorType = sector.sectorType as CorporationType;
    const strats = SECTOR_STRATEGIES[sectorType]!;
    const currentId = (sector.strategyId as string | undefined) ?? "standard";
    const currentStrat = strats.find((s) => s.id === currentId) ?? strats[0]!;

    const alternatives = strats.filter((s) => s.id !== currentStrat.id);
    if (alternatives.length === 0) return null;

    const roll = seededRoll(ctx.character._id.toHexString(), ctx.currentTurn, KIND, "stratPick");
    const picked = alternatives[(roll - 1) % alternatives.length]!;

    return {
      corporationId: corp._id,
      corpName: corp.name,
      sectorLabel: CORPORATION_TYPE_LABELS[sectorType],
      currentStrategyName: currentStrat.name,
      demandedStrategyName: picked.name,
    };
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as minorityStrategyPressureHandler };
