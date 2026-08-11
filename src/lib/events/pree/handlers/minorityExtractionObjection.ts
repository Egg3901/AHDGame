import type { EventHandler } from "@/lib/events/substrate/types";
import { registerEventHandler } from "@/lib/events/substrate/registry";
import { applyDeclarativeEffects } from "@/lib/events/substrate/applyEffects";
import { threeTierTable } from "./tiers";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { seededRoll } from "@/lib/events/substrate/rng";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const KIND = "pree.minorityExtractionObjection";

const handler: EventHandler = {
  kind: KIND,
  defaultOptionId: "doubleDown",
  options: [
    {
      id: "pivot",
      label: "Commit to the pivot",
      description: "Announce the strategy shift and begin retooling.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "ESG credibility win",
        "Transition contained",
        "Retooling mishandled",
        [
          { type: "corpSentiment", delta: 9 },
          { type: "personalWealth", deltaAnchor: -20_000 },
        ],
        [{ type: "corpSentiment", delta: 2 }],
        [{ type: "corpSentiment", delta: -4 }]
      ),
    },
    {
      id: "study",
      label: "Commission an independent study",
      description: "Hire consultants and buy time.",
      primaryStat: "businessAcumen",
      outcomeTable: threeTierTable(
        "Study buys goodwill",
        "Minor delay in pressure",
        "Study seen as a stall",
        [{ type: "corpSentiment", delta: -2 }],
        [{ type: "corpSentiment", delta: -4 }],
        [
          { type: "corpSentiment", delta: -6 },
          { type: "infamy", delta: 1 },
        ]
      ),
    },
    {
      id: "doubleDown",
      label: "Double down on current strategy",
      description: "Defend the strategy to the board and press.",
      isDefault: true,
      outcomeTable: threeTierTable(
        "Bloc backs down temporarily",
        "Bloc intensifies campaign",
        "Divestment announced publicly",
        [{ type: "corpSentiment", delta: -5 }],
        [{ type: "corpSentiment", delta: -8 }],
        [
          { type: "corpSentiment", delta: -12 },
          { type: "infamy", delta: 3 },
        ]
      ),
    },
  ],
  async buildPayload(ctx) {
    const corp = await ctx.db
      .collection<Corporation>("corporations")
      .findOne({ ceoId: ctx.character._id }, { projection: { _id: 1, name: 1 } });
    if (!corp) return null;

    const extractionStrats = SECTOR_STRATEGIES["extraction"]!;
    if (extractionStrats.length <= 1) return null;

    const extractionSectors = await ctx.db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corp._id, sectorType: "extraction" })
      .project({ strategyId: 1, revenue: 1 })
      .toArray();

    if (extractionSectors.length === 0) return null;

    const sector = (
      extractionSectors as Array<Pick<CorporateSector, "strategyId" | "revenue">>
    ).sort((a, b) => ((b.revenue as number) ?? 0) - ((a.revenue as number) ?? 0))[0]!;

    const currentId = (sector.strategyId as string | undefined) ?? "standard";
    const currentStrat = extractionStrats.find((s) => s.id === currentId) ?? extractionStrats[0]!;

    const alternatives = extractionStrats.filter((s) => s.id !== currentStrat.id);
    if (alternatives.length === 0) return null;

    const roll = seededRoll(ctx.character._id.toHexString(), ctx.currentTurn, KIND, "extractPick");
    const picked = alternatives[(roll - 1) % alternatives.length]!;

    return {
      corporationId: corp._id,
      corpName: corp.name,
      currentExtractionName: currentStrat.name,
      demandedExtractionName: picked.name,
    };
  },
  async applyEffects(ctx) {
    await applyDeclarativeEffects(ctx, ctx.tier.effects);
  },
};

registerEventHandler(handler);

export { handler as minorityExtractionObjectionHandler };
