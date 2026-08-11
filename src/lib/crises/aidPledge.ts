// src/lib/crises/aidPledge.ts
import { ObjectId, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CrisisInteraction } from "@/lib/db/types/crisis";
import type { CrisisAidCommitment } from "@/lib/db/types/crisisAid";
import { AID_MAX_PCT_GDP } from "@/lib/constants/crises";
import { badRequest, forbidden, conflict, notFound } from "@/lib/api/errors";
import { spendFromTreasury, type FiscalImpact } from "@/lib/budget/treasurySpend";
import { computeAidOutcome } from "@/lib/crises/aidScaling";
import { applyCrisisEffects } from "@/lib/crises/applyEffects";
import { applyEffectsForCrisis } from "@/lib/crises/interactionEngine";
import { proposeCrisisAidBill } from "@/lib/legislature/commands/proposeCrisisAidBill";
import { logWireEvent } from "@/lib/wireEvent";

export interface SubmitCrisisAidPledgeInput {
  interactionId: ObjectId;
  nodeId: string;
  pctGdp: number;
  characterId: ObjectId;
  characterName: string;
  senderCountryId: CountryId;
  characterParty?: string;
  characterRoles: string[];
}

const HEAD_OF_STATE_ROLE = "headOfState";

/**
 * Provisionally resolve an aid pledge "as if it passes": spend (surplus/debt),
 * apply scaled recovery to the crisis + a diplomatic bump to the sender, file an
 * appropriation bill in the sender's legislature, and record a commitment for
 * the resolution sweep to finalize or claw back. The crisis advances to terminal
 * independently of the bill's fate.
 */
export async function submitCrisisAidPledge(
  db: Db,
  input: SubmitCrisisAidPledgeInput
): Promise<{ commitmentId: ObjectId; billId: ObjectId; impact: FiscalImpact }> {
  const interaction = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .findOne({ _id: input.interactionId });
  if (!interaction) throw notFound("Crisis interaction not found");
  if (interaction.resolvedAt) throw conflict("Crisis already resolved");

  const node = interaction.decisionTree.find((n) => n.nodeId === input.nodeId);
  if (!node || node.type !== "aid") throw badRequest("Node is not an aid node");
  if (node.nodeId !== interaction.currentNodeId) throw badRequest("Aid node is not active");

  if (!input.characterRoles.includes(HEAD_OF_STATE_ROLE)) {
    throw forbidden("Only a head of state can pledge aid");
  }

  const already = await db
    .collection<CrisisAidCommitment>("crisisAidCommitments")
    .findOne({ crisisId: interaction.crisisId, senderCountryId: input.senderCountryId });
  if (already) throw conflict("Your country has already pledged aid to this crisis");

  const maxPct = node.aidMaxPctGdp ?? AID_MAX_PCT_GDP;
  if (!(input.pctGdp > 0) || input.pctGdp > maxPct) {
    throw badRequest("Invalid aid amount");
  }

  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: input.senderCountryId });
  const senderGdp =
    budget?.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : (budget?.gdp ?? 0);
  if (senderGdp <= 0) throw badRequest("Sender GDP unavailable");

  const { amountLocal, recoveryEffects, senderEffects } = computeAidOutcome(
    input.pctGdp,
    senderGdp
  );
  if (amountLocal <= 0) throw badRequest("Aid amount rounds to zero");

  // 1. Spend (surplus first, remainder = debt; derived fields resynced now).
  const impact = await spendFromTreasury(db, input.senderCountryId, amountLocal, {
    resyncDerived: true,
  });

  // 2. Provisionally apply benefits.
  await applyEffectsForCrisis(db, interaction.crisisId, recoveryEffects);
  await applyCrisisEffects(db, senderEffects, [], [input.senderCountryId]);

  // 3. File the appropriation bill.
  const commitmentId = new ObjectId();
  const crisis = await db.collection("crises").findOne({ _id: interaction.crisisId });
  const crisisName = (crisis as { name?: string } | null)?.name ?? "a foreign crisis";
  const billId = await proposeCrisisAidBill(db, {
    countryId: input.senderCountryId,
    crisisAidId: commitmentId,
    sponsorId: input.characterId,
    sponsorName: input.characterName,
    sponsorParty: input.characterParty,
    title: `Emergency Aid: ${crisisName}`,
    summary: `Appropriate ${amountLocal.toLocaleString()} in reconstruction aid for ${crisisName} (${(input.pctGdp * 100).toFixed(2)}% of GDP).`,
  });

  // 4. Record the commitment (exact effects for reversal).
  const now = new Date();
  await db.collection<CrisisAidCommitment>("crisisAidCommitments").insertOne({
    _id: commitmentId,
    crisisId: interaction.crisisId,
    billId,
    senderCountryId: input.senderCountryId,
    proposerCharacterId: input.characterId,
    proposerName: input.characterName,
    amountLocal,
    amountPctGdp: input.pctGdp,
    recoveryEffects,
    senderEffects,
    treasuryDebited: amountLocal,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  // 5. Advance the crisis to its terminal node (resolves the interaction).
  await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
    { _id: interaction._id },
    {
      $set: {
        currentNodeId: null,
        decisionDeadline: null,
        resolvedAt: now,
        resolutionOutcome: "success",
        updatedAt: now,
      },
      $push: { resolutionPath: input.nodeId },
    }
  );

  await logWireEvent("crisis_aid_pledged", `${input.characterName} pledged emergency aid.`, {
    href: `/world/crises/${interaction.crisisId.toString()}`,
  });

  return { commitmentId, billId, impact };
}
