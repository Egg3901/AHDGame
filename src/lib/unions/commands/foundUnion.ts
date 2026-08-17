/**
 * Union dues v1, found a rival union.
 *
 * Before dues v1 there was exactly one union per (countryId, sectorType) pair,
 * seeded by the world. This is what makes a SECOND one possible: any character
 * in the target country may found a new union in an industry that already has
 * one, which is what gives {@link organizeSector}'s raid path something to
 * raid. A founded union starts with nothing, zero treasury, no represented
 * sectors, no services, and must organize its way into the industry exactly
 * like an NPP challenger would.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { BASE_APPROVAL } from "@/lib/unions/unionDues";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  MAX_UNION_NAME_LENGTH,
  MIN_UNION_NAME_LENGTH,
  UNION_FOUNDING_ACTION_COST,
  unionFoundingCostLocal,
} from "@/lib/unions/unionFounding";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";
import { rejectIfTurnProcessing } from "./unionActions";
import type { UnionActionResult } from "./unionActions";

export { MAX_UNION_NAME_LENGTH, MIN_UNION_NAME_LENGTH, UNION_FOUNDING_ACTION_COST };

export interface FoundUnionInput {
  countryId: CountryId;
  sectorType: CorporationType;
  name: string;
}

/**
 * Found a new union. The founding character must be present in the target
 * country, pays `UNION_FOUNDING_COST_ANCHOR` (era/FX scaled) out of CAMPAIGN
 * FUNDS plus `UNION_FOUNDING_ACTION_COST` action points, and cannot reuse a
 * name already taken by another union in the same (countryId, sectorType) pair.
 *
 * Both costs come out of ONE conditional `findOneAndUpdate` guarded on both
 * balances, the same shape `npps/commands/directAction` uses, so a founder can
 * never pay the funds and keep the action points (or the reverse) and two
 * concurrent foundings cannot both pass on a stale balance.
 */
export async function foundUnion(
  db: Db,
  character: Character,
  input: FoundUnionInput
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  if (character.countryId !== input.countryId) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this country to found a union here.",
    };
  }

  if (await isUnionsBanned(db, input.countryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  // One union per leader, the same invariant acceptUnionLeadership and
  // voteUnionLeader enforce. Without this a founder could lead every union
  // they could pay for, and reconcileUnionOwnerCache would flap the
  // `unionLeaderOf` cache between them on every page view.
  if (character.unionLeaderOf != null) {
    return {
      ok: false,
      status: 409,
      error: "You already lead a union. Step down before founding another.",
    };
  }

  const name = input.name.trim();
  if (name.length < MIN_UNION_NAME_LENGTH || name.length > MAX_UNION_NAME_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Union name must be between ${MIN_UNION_NAME_LENGTH} and ${MAX_UNION_NAME_LENGTH} characters.`,
    };
  }

  // Duplicate check is scoped to (countryId, sectorType): the same name is
  // fine in a different country or a different industry, but two rival
  // unions organizing the same industry in the same country cannot share one.
  const existingNames = await db
    .collection<Union>("unions")
    .find({ countryId: input.countryId, sectorType: input.sectorType }, { projection: { name: 1 } })
    .toArray();
  const nameLower = name.toLowerCase();
  if (existingNames.some((u) => (u.name ?? "").trim().toLowerCase() === nameLower)) {
    return {
      ok: false,
      status: 409,
      error: "A union with this name already exists in this country and industry.",
    };
  }

  const forexEnabled = await isForexEnabled();
  const preset = await getGameStatePresetOrDefault(db);
  const homeCurrency = getHomeCurrency(character);
  const costLocal = unionFoundingCostLocal({
    preset,
    countryId: input.countryId,
    forexEnabled,
  });

  // Campaign funds live in `currencyBalances.campaign` post-forex and on the
  // legacy `funds` field before it, the same resolution `directAction` does.
  const useForexCampaignBalance =
    forexEnabled && typeof character.currencyBalances?.campaign === "number";
  const campaignFundsField = useForexCampaignBalance ? "currencyBalances.campaign" : "funds";
  const availableFunds = useForexCampaignBalance
    ? (character.currencyBalances?.campaign ?? 0)
    : (character.funds ?? 0);
  const availableActions = character.actions ?? 0;

  // Reported up front rather than as a bare rejection, so the founder can see
  // which of the two costs they are short on before anything is spent.
  if (availableFunds < costLocal) {
    return {
      ok: false,
      status: 402,
      error: `Founding a union costs ${costLocal.toLocaleString()} ${homeCurrency} in campaign funds (you have ${Math.floor(availableFunds).toLocaleString()}).`,
    };
  }
  if (availableActions < UNION_FOUNDING_ACTION_COST) {
    return {
      ok: false,
      status: 402,
      error: `Founding a union costs ${UNION_FOUNDING_ACTION_COST} action points (you have ${availableActions}).`,
    };
  }

  // ONE guarded write for both costs: partial payment is unrepresentable, and
  // a concurrent spend that drains either balance loses the race outright.
  const spend = await db.collection<Character>("characters").findOneAndUpdate(
    {
      _id: character._id,
      actions: { $gte: UNION_FOUNDING_ACTION_COST },
      [campaignFundsField]: { $gte: costLocal },
    },
    {
      $inc: {
        actions: -UNION_FOUNDING_ACTION_COST,
        [campaignFundsField]: -costLocal,
      },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after" }
  );
  if (!spend) {
    return {
      ok: false,
      status: 409,
      error: "Your campaign funds or action points changed, reload and try again.",
    };
  }

  /** Undo the combined spend when a later step fails, so nothing is charged for nothing. */
  const refundFoundingCost = async () => {
    await db.collection<Character>("characters").updateOne(
      { _id: character._id },
      {
        $inc: {
          actions: UNION_FOUNDING_ACTION_COST,
          [campaignFundsField]: costLocal,
        },
      }
    );
  };

  const now = new Date();
  try {
    const insertResult = await db.collection<Union>("unions").insertOne({
      _id: new ObjectId(),
      countryId: input.countryId,
      sectorType: input.sectorType,
      name,
      ownerId: character._id,
      ownerType: "character",
      pendingLeaderCharacterId: null,
      treasury: 0,
      strength: 0,
      approval: BASE_APPROVAL,
      duesPerWorkerAnnual: 0,
      activeServices: [],
      foundedByCharacterId: character._id,
      lastCalledStrikeTurn: null,
      demandedWageLevel: null,
      createdAt: now,
      updatedAt: now,
    } as Union);

    // Claim leadership under the same guarded filter acceptUnionLeadership
    // uses, so a concurrent leadership win elsewhere cannot leave one
    // character heading two unions. A lost race unwinds the founding.
    const claim = await db.collection<Character>("characters").updateOne(
      {
        _id: character._id,
        $or: [{ unionLeaderOf: null }, { unionLeaderOf: { $exists: false } }],
      },
      { $set: { unionLeaderOf: insertResult.insertedId, updatedAt: now } }
    );
    if (claim.modifiedCount === 0) {
      await db.collection<Union>("unions").deleteOne({ _id: insertResult.insertedId });
      await refundFoundingCost();
      return {
        ok: false,
        status: 409,
        error: "You already lead a union. Step down before founding another.",
      };
    }

    return {
      ok: true,
      status: 200,
      unionId: insertResult.insertedId.toString(),
      name,
      countryId: input.countryId,
      sectorType: input.sectorType,
      campaignFundsSpent: costLocal,
      actionsSpent: UNION_FOUNDING_ACTION_COST,
      currency: homeCurrency,
    };
  } catch (error) {
    // The union document didn't land, refund rather than leave the founder
    // charged for nothing. Covers both genuine infra failures and a
    // duplicate-key race on a legacy (countryId, sectorType) unique index
    // some worlds may still carry from before rival unions existed.
    await refundFoundingCost();
    const message =
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === 11000
        ? "This country and industry already has a union blocking a second one at the database level, contact ops."
        : "Failed to found the union, you have been refunded.";
    return { ok: false, status: 409, error: message };
  }
}
