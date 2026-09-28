import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import type { Crisis, CrisisInteraction, GlobalResponseOutcome } from "@/lib/db/types/crisis";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import { planCrisisSanctions } from "./rules";

/** Idempotent materialization; expired or repealed rows remain replay tombstones. */
export async function applyCrisisTradeSanctions(
  db: Db,
  crisis: Pick<Crisis, "_id" | "globalResponse" | "startTurn" | "endTurn" | "durationTurns">,
  interaction: Pick<CrisisInteraction, "leaderResponses">,
  outcome: GlobalResponseOutcome
): Promise<void> {
  if (!outcome.tradeSanction || !crisis.globalResponse) return;
  const plans = planCrisisSanctions(
    outcome.tradeSanction,
    crisis.globalResponse.roleByCountry,
    (interaction.leaderResponses ?? []).map((response) => ({
      countryId: response.countryId,
      actorId: response.characterId.toString(),
      responseScores: response.responseScores,
    })),
    new Set(COUNTRY_ORDER),
    crisis.endTurn ?? crisis.startTurn + (crisis.durationTurns ?? 0)
  );
  for (const plan of plans) {
    const identity = `${crisis._id}:${outcome.outcomeId}:${plan.sourceCountry}:${plan.targetCountry}:${plan.commodity}`;
    const _id = new ObjectId(createHash("sha256").update(identity).digest("hex").slice(0, 24));
    const embargo: TradeEmbargo = {
      _id,
      sourceCountry: plan.sourceCountry as CountryId,
      targetCountry: plan.targetCountry as CountryId,
      commodity: plan.commodity,
      direction: "both",
      mode: "block",
      origin: "crisis",
      createdBy: new ObjectId(plan.createdBy),
      createdTurn: plan.createdTurn,
      expiresTurn: plan.expiresTurn,
      sourceCrisisId: crisis._id,
      sourceOutcomeId: outcome.outcomeId,
    };
    await db
      .collection<TradeEmbargo>("tradeEmbargoes")
      .updateOne({ _id }, { $setOnInsert: embargo }, { upsert: true });
  }
}
