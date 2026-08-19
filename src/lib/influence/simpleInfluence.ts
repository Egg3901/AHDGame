/**
 * Simple Influence System
 * Handles +1/-1 influence actions on characters and NPPs
 * Used by legacy influence routes (characters/[id]/influence and npps/[id]/boost)
 */

import { ObjectId, Db } from "mongodb";
import type { Campaign, Character, Election, NPP } from "@/lib/db/types";
import { getGameState } from "@/lib/gameState";
import { calculateActionCost, getActionCostMultiplier } from "@/lib/states/adjacency";
import { createNotification } from "@/lib/notifications";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getMediaFavPerTurn } from "@/lib/campaigns/opsEffects";

// Base cost for influence/boost actions
export const BASE_INFLUENCE_COST = 2;

/**
 * Maximum NET favorability any one target can be moved by player support/attack
 * in a single turn, in either direction.
 *
 * Root cause this closes: `supportPlayer` / `attackPlayer` move favorability by
 * a flat ±1 with no cooldown, no dedupe and no per-turn cap — the only limiter
 * was the actor's own action points and infamy. Those limits are per-ACTOR, so
 * they do not bind in aggregate: a coordinated party simply spreads the cost.
 *
 * Measured on the live 1956 US presidential race (turn 227, harness
 * `scripts/sim/favorability-bomb-replay.ts`, real engine in dry-run):
 * favorability is worth ~0.45 points of vote share per point, because
 * `approvalScalar` multiplies the candidate's ENTIRE vote. Forcing the
 * incumbent from 100 → 20 moved his projected national share 64.8% → 46.6% and
 * the electoral college 531-0 → 141-390. That is 80 landed attacks: two per
 * head across a 42-member party, ~168 action points out of the 3,715 they had
 * banked. Under 5% of one party's reserves bought the presidency.
 *
 * For comparison the approval-scaled incumbency channel measures 0.04 share
 * points per point — favorability is ~11x stronger, and was the only one of the
 * two with no aggregate limit at all.
 *
 * 3/turn is deliberately non-trivial: a coordinated party still moves a target
 * faster than any individual can, and can still swing 30+ points over a
 * campaign. It just cannot delete a candidate between two turns. Pairs with the
 * per-turn passive/decay curves so favorability has a reachable equilibrium
 * rather than being set by click volume.
 */
export const MAX_NET_FAVORABILITY_SWING_PER_TURN = 3;

/**
 * Net player-driven favorability already applied to `targetId` this turn.
 * Positive = net supported, negative = net attacked. Reads the same
 * `actionLogs` rows the influence routes write, so there is no new state to
 * keep in sync and no backfill: turns with no logged actions score 0.
 *
 * Sums the authoritative `result.targetFavorabilityChange` the routes already
 * record, rather than inferring from `actionType`. That is what actually moved,
 * so attacks that failed the infamy roll contribute 0 and correctly do not
 * consume the target's budget.
 */
export async function netFavorabilitySwingThisTurn(
  db: Db,
  targetId: ObjectId,
  targetType: TargetType,
  turn: number
): Promise<number> {
  const targetField = targetType === "character" ? "targetCharacterId" : "targetNPPId";
  const rows = await db
    .collection<{ result?: { targetFavorabilityChange?: number } }>("actionLogs")
    .find(
      {
        [targetField]: targetId,
        turn,
        actionType: { $in: ["supportPlayer", "attackPlayer"] },
      },
      { projection: { result: 1 } }
    )
    .toArray();

  let net = 0;
  for (const r of rows) {
    const delta = r.result?.targetFavorabilityChange;
    if (typeof delta === "number") net += delta;
  }
  return net;
}

export type TargetType = "character" | "npp";

export interface SimpleInfluenceInfo {
  canInfluence: boolean;
  actionCost: number;
  multiplier: number;
  myActions: number;
  myFunds: number;
  myHomeState: string;
  targetHomeState: string;
  targetInfluence: number;
  targetFavorability: number;
  myInfamy: number;
  attackFailureChance: number;
  /**
   * True when the target is in an active presidential race with media-spending
   * level >= 4. At fav=100, media-spending boosts (mediaLevel × 0.5/turn) meet
   * or beat decay (2.0/turn), so favorability is pinned at the cap regardless
   * of natural decay. Surfaced to the UI so disabled-Support buttons can
   * explain *why* the cap won't drop.
   */
  targetMediaSustainedAtCap: boolean;
}

/**
 * Threshold above which a presidential candidate's media spending offsets
 * favorability decay at the 100% cap. mediaLevel × 0.5 ≥ (100−60) × 0.05 = 2.0
 * → mediaLevel ≥ 4.
 */
const MEDIA_SUSTAIN_THRESHOLD = 4;

/**
 * Detect whether the target's favorability is being held at the cap by their
 * own active presidential campaign's media spending. Returns false unless the
 * target is at fav=100 and has a `campaigns` doc with mediaSpendingLevel ≥ 4
 * tied to an active election of type "president". Other race types do not
 * apply favorability passives — see `applyPresidentialPassives` in
 * campaignTurn.ts.
 */
async function isTargetMediaSustainedAtCap(db: Db, target: Character | NPP): Promise<boolean> {
  if ((target.favorability ?? 50) < 100) return false;
  // Strategic Operations v2: media favorability/turn now comes from the media
  // tree (starter + Broadcast + Television). Fetch the target's campaigns and
  // keep those whose per-turn favorability clears the decay-at-cap threshold
  // (mediaLevel × 0.5 ≥ 2.0), with a legacy-level fallback.
  const MEDIA_SUSTAIN_FAV_PER_TURN = MEDIA_SUSTAIN_THRESHOLD * 0.5;
  const allCampaigns = await db
    .collection<Campaign>("campaigns")
    .find(
      { candidateId: target._id },
      { projection: { electionId: 1, mediaSpendingLevel: 1, mediaSpendingTree: 1 } }
    )
    .toArray();
  const campaigns = allCampaigns.filter((c) => getMediaFavPerTurn(c) >= MEDIA_SUSTAIN_FAV_PER_TURN);
  if (campaigns.length === 0) return false;

  const presidentialMatch = await db.collection<Election>("elections").findOne(
    {
      _id: { $in: campaigns.map((c) => c.electionId) },
      status: "active",
      electionType: "president",
    },
    { projection: { _id: 1 } }
  );
  return !!presidentialMatch;
}

export interface SimpleInfluenceResult {
  success: boolean;
  attackFailed: boolean;
  action: "raise" | "lower" | "barnstorm";
  actionCost: number;
  targetName: string;
  newTargetInfluence: number;
  newTargetFavorability: number;
  infamyGained: number;
  myCharacter: Character;
  message: string;
}

/**
 * Get influence info for a target (character or NPP)
 */
export async function getSimpleInfluenceInfo(
  db: Db,
  myCharacter: Character,
  targetId: string,
  targetType: TargetType,
  forexEnabled = false
): Promise<{ info?: SimpleInfluenceInfo; error?: { message: string; status: number } }> {
  const homeFxRate = forexEnabled
    ? (await loadCharacterFxRate(db, getHomeCurrency(myCharacter))).rate
    : 1;
  // Parse target ID
  let targetObjectId: ObjectId;
  try {
    targetObjectId = new ObjectId(targetId);
  } catch {
    return { error: { message: `Invalid ${targetType} ID`, status: 400 } };
  }

  // Get target
  const collection = targetType === "character" ? "characters" : "npps";
  const target = await db.collection<Character | NPP>(collection).findOne({ _id: targetObjectId });

  if (!target) {
    return {
      error: {
        message: `${targetType === "character" ? "Target character" : "NPP"} not found`,
        status: 404,
      },
    };
  }

  // Can't influence yourself (only applies to characters)
  if (targetType === "character" && myCharacter._id.equals(target._id)) {
    return { error: { message: "You cannot influence yourself", status: 400 } };
  }

  // Cross-country actions are not allowed
  if (!isSameCountry(myCharacter, target)) {
    return {
      error: { message: "You cannot influence politicians from other countries", status: 400 },
    };
  }

  // Calculate action cost based on state proximity
  const actionCost = calculateActionCost(
    BASE_INFLUENCE_COST,
    myCharacter.homeState,
    target.homeState
  );
  const multiplier = getActionCostMultiplier(myCharacter.homeState, target.homeState);

  // Calculate attack failure chance based on infamy
  const myInfamy = myCharacter.infamy || 0;

  const targetMediaSustainedAtCap = await isTargetMediaSustainedAtCap(db, target);

  return {
    info: {
      canInfluence: true,
      actionCost,
      multiplier,
      myActions: myCharacter.actions,
      // Return anchor units to keep the existing API contract (UI shows
      // anchor for cost comparison). Derive from local stored balance.
      myFunds: (localCampaignBalance(myCharacter, forexEnabled) /
        (forexEnabled ? homeFxRate : 1)) as number,
      myHomeState: myCharacter.homeState,
      targetHomeState: target.homeState,
      targetInfluence: target.politicalInfluence || 0,
      // `?? 50` — favorability of 0 is a valid attacked-to-rock-bottom state and must
      // not be coalesced to the 50 default, or the next attack would write 49 back to DB.
      targetFavorability: target.favorability ?? 50,
      myInfamy,
      attackFailureChance: myInfamy,
      targetMediaSustainedAtCap,
    },
  };
}

/**
 * Execute a simple influence action (raise or lower)
 */
export async function executeSimpleInfluence(
  db: Db,
  userId: string,
  myCharacter: Character,
  targetId: string,
  targetType: TargetType,
  action: "raise" | "lower" | "barnstorm",
  forexEnabled = false
): Promise<{ result?: SimpleInfluenceResult; error?: { message: string; status: number } }> {
  // Match executeAction: block support/attack/barnstorm while the world is paused.
  // Without this, reputation attacks stayed executable during admin stop / pre-launch
  // pause even though Actions-page spends were already gated on isActive.
  const gameState = await getGameState();
  if (gameState && gameState.isActive === false) {
    return { error: { message: "The game is currently paused.", status: 409 } };
  }

  const homeCurrency = getHomeCurrency(myCharacter);
  const homeFxRate = forexEnabled ? (await loadCharacterFxRate(db, homeCurrency)).rate : 1;
  // Parse target ID
  let targetObjectId: ObjectId;
  try {
    targetObjectId = new ObjectId(targetId);
  } catch {
    return { error: { message: `Invalid ${targetType} ID`, status: 400 } };
  }

  // Get target
  const collection = targetType === "character" ? "characters" : "npps";
  const target = await db.collection<Character | NPP>(collection).findOne({ _id: targetObjectId });

  if (!target) {
    return {
      error: {
        message: `${targetType === "character" ? "Target character" : "NPP"} not found`,
        status: 404,
      },
    };
  }

  // Can't influence yourself (only applies to characters)
  if (targetType === "character" && myCharacter._id.equals(target._id)) {
    return { error: { message: "You cannot influence yourself", status: 400 } };
  }

  // Cross-country actions are not allowed
  if (!isSameCountry(myCharacter, target)) {
    return {
      error: { message: "You cannot influence politicians from other countries", status: 400 },
    };
  }

  // Barnstorm action logic
  if (action === "barnstorm") {
    const BARNSTORM_ACTION_COST = 5;
    const BARNSTORM_FUND_COST = 100000;

    // Reject no-op when the target is already at the influence ceiling. Without
    // this guard we'd debit 5 actions + $100k while writing 100 → 100, leaving
    // the actor confused about why nothing moved.
    if ((target.politicalInfluence ?? 0) >= 100) {
      return {
        error: {
          message: `${target.name}'s political influence is already maxed (100%). Find someone else to barnstorm for.`,
          status: 400,
        },
      };
    }

    // Check costs
    if (myCharacter.actions < BARNSTORM_ACTION_COST) {
      return {
        error: { message: `Not enough actions. Required: ${BARNSTORM_ACTION_COST}`, status: 400 },
      };
    }
    // Compare local-to-local: BARNSTORM_FUND_COST is anchor; convert at boundary.
    // #888: when forex is on, do NOT fall back to the legacy anchor `funds`
    // field — it is USD-scaled and reads as a tiny local balance (e.g. in NGN),
    // producing a false "Not enough funds" if currencyBalances.campaign is
    // momentarily undefined ("cannot barnstorm"). Fall back to 0 instead.
    const myBalanceLocal = forexEnabled
      ? (myCharacter.currencyBalances?.campaign ?? 0)
      : (myCharacter.funds ?? 0);
    const barnstormCostLocal = forexEnabled
      ? BARNSTORM_FUND_COST * homeFxRate
      : BARNSTORM_FUND_COST;
    if (myBalanceLocal < barnstormCostLocal) {
      return {
        error: {
          message: `Not enough funds. Required: ${barnstormCostLocal.toLocaleString()} ${forexEnabled ? homeCurrency : "USD"}`,
          status: 400,
        },
      };
    }

    // Determine influence gain
    const isHomeState = myCharacter.homeState === target.homeState;
    const influenceGain = isHomeState ? 2 : 1;

    const targetCurrentInfluence = target.politicalInfluence || 0;
    const newTargetInfluence = Math.min(100, Math.max(0, targetCurrentInfluence + influenceGain));

    // Deduct from self FIRST with an atomic balance guard. The pre-check above
    // is not race-safe — without a fund balance condition on the updateOne,
    // parallel barnstorm requests could each pass the pre-check and both
    // deduct, driving campaign funds negative. If the guard misses we bail
    // before touching the target, so a failed deduction doesn't hand out a
    // free influence boost.
    //
    // BARNSTORM_FUND_COST is ANCHOR-denominated. Convert to LOCAL once for
    // both the filter and the $inc.
    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const fundCostLocal = forexEnabled ? BARNSTORM_FUND_COST * homeFxRate : BARNSTORM_FUND_COST;
    const debitFilter = {
      _id: myCharacter._id,
      actions: { $gte: BARNSTORM_ACTION_COST },
      [campaignFundsField]: { $gte: fundCostLocal },
    };

    const debitResult = await db.collection<Character>("characters").updateOne(debitFilter, {
      $inc: {
        actions: -BARNSTORM_ACTION_COST,
        [campaignFundsField]: -fundCostLocal,
      },
      $set: { updatedAt: new Date() },
    });
    if (debitResult.matchedCount === 0) {
      return {
        error: {
          message:
            "Your available actions or campaign funds changed before the barnstorm completed. Please try again.",
          status: 409,
        },
      };
    }

    // Now apply the influence change on the target.
    await db
      .collection(collection)
      .updateOne(
        { _id: target._id },
        { $set: { politicalInfluence: newTargetInfluence, updatedAt: new Date() } }
      );

    // Log action
    const targetIdField = targetType === "character" ? "targetCharacterId" : "targetNPPId";
    const targetNameField = targetType === "character" ? "targetCharacterName" : "targetNPPName";

    await db.collection("actionLogs").insertOne({
      characterId: myCharacter._id,
      userId: new ObjectId(userId),
      actionType: "barnstorm",
      [targetIdField]: target._id,
      [targetNameField]: target.name,
      actionCost: BARNSTORM_ACTION_COST,
      fundsCost: BARNSTORM_FUND_COST,
      result: {
        success: true,
        targetInfluenceChange: influenceGain,
        message: `Barnstormed for ${target.name} (+${influenceGain}% influence)`,
      },
      turn: gameState?.currentTurn || 0,
      createdAt: new Date(),
    });

    // Notify target
    if (targetType === "character") {
      const targetChar = target as Character;
      if (targetChar.userId) {
        await createNotification({
          userId: targetChar.userId,
          type: "player_support",
          title: "Campaign Barnstorm!",
          message: `${myCharacter.name} barnstormed for you! (+${influenceGain}% influence).`,
          metadata: { attackerId: myCharacter._id.toString(), attackerName: myCharacter.name },
        });
      }
    }

    const updatedMyCharacter = await db.collection<Character>("characters").findOne({
      _id: myCharacter._id,
    });

    return {
      result: {
        success: true,
        attackFailed: false,
        action,
        actionCost: BARNSTORM_ACTION_COST,
        targetName: target.name,
        newTargetInfluence: newTargetInfluence,
        newTargetFavorability: target.favorability ?? 50,
        infamyGained: 0,
        myCharacter: updatedMyCharacter!,
        message: `You barnstormed for ${target.name} (+${influenceGain}% influence)`,
      },
    };
  }

  // Reject no-op support/attack when the target is already at the favorability
  // ceiling/floor. Without these guards the action is debited but the clamped
  // write is a no-op (100 → 100 / 0 → 0), which players interpret as a glitch.
  const targetCurrentFavorabilityForGuard = target.favorability ?? 50;
  if (action === "raise" && targetCurrentFavorabilityForGuard >= 100) {
    return {
      error: {
        message: `${target.name}'s favorability is already maxed (100%). Wait for it to decay before supporting again.`,
        status: 400,
      },
    };
  }
  if (action === "lower" && targetCurrentFavorabilityForGuard <= 0) {
    return {
      error: {
        message: `${target.name}'s favorability is already at the floor (0%). They can't be attacked further.`,
        status: 400,
      },
    };
  }

  // Aggregate per-target throttle. The ±1 move is per-actor, so per-actor costs
  // (action points, infamy) never bound how far a COORDINATED group can push a
  // single target in one turn. Measured worth: ~0.45 vote-share points per
  // favorability point, so an unthrottled group could decide a national
  // election between two turns. See MAX_NET_FAVORABILITY_SWING_PER_TURN.
  const netSwing = await netFavorabilitySwingThisTurn(
    db,
    target._id as ObjectId,
    targetType,
    gameState?.currentTurn ?? 0
  );
  const wouldBe = netSwing + (action === "raise" ? 1 : -1);
  if (Math.abs(wouldBe) > MAX_NET_FAVORABILITY_SWING_PER_TURN) {
    return {
      error: {
        message:
          action === "raise"
            ? `${target.name} has already been supported as much as they can be this turn (limit ${MAX_NET_FAVORABILITY_SWING_PER_TURN} net per turn). Try again next turn.`
            : `${target.name} has already been attacked as much as they can be this turn (limit ${MAX_NET_FAVORABILITY_SWING_PER_TURN} net per turn). Try again next turn.`,
        status: 429,
      },
    };
  }

  // Calculate action cost based on state proximity
  const actionCost = calculateActionCost(
    BASE_INFLUENCE_COST,
    myCharacter.homeState,
    target.homeState
  );

  // Check if player has enough actions
  if (myCharacter.actions < actionCost) {
    return {
      error: {
        message: `Not enough actions. Required: ${actionCost}, Available: ${myCharacter.actions}`,
        status: 400,
      },
    };
  }

  // For attacks, check if it fails based on infamy
  const myCurrentInfamy = myCharacter.infamy || 0;
  let attackFailed = false;

  if (action === "lower") {
    // Roll 0-999, compare against infamy*10 for decimal precision
    const roll = Math.floor(Math.random() * 1000);
    attackFailed = roll < myCurrentInfamy * 10;
  }

  // Calculate new values
  // Support/Attack now targets FAVORABILITY (Reputation), not Influence
  const targetCurrentInfluence = target.politicalInfluence || 0;
  // `?? 50` — see note on GET path: `||` corrupts 0-favorability targets back up to 49.
  const targetCurrentFavorability = target.favorability ?? 50;

  const favorabilityChange = action === "raise" ? 1 : attackFailed ? 0 : -1;
  const newTargetFavorability = Math.min(
    100,
    Math.max(0, targetCurrentFavorability + favorabilityChange)
  );

  // For lowering, add infamy to the attacker (even if attack fails)
  const infamyGain = action === "lower" ? 2 : 0;
  const newMyInfamy = Math.min(100, myCurrentInfamy + infamyGain);

  // Only update target's favorability if attack didn't fail
  if (!attackFailed) {
    await db
      .collection(collection)
      .updateOne(
        { _id: target._id },
        { $set: { favorability: newTargetFavorability, updatedAt: new Date() } }
      );
  }

  // Update my actions and infamy
  const myUpdates: Record<string, unknown> = {
    actions: myCharacter.actions - actionCost,
    updatedAt: new Date(),
  };
  if (action === "lower") {
    myUpdates.infamy = newMyInfamy;
  }

  await db.collection("characters").updateOne({ _id: myCharacter._id }, { $set: myUpdates });

  // Log the action
  const targetIdField = targetType === "character" ? "targetCharacterId" : "targetNPPId";
  const targetNameField = targetType === "character" ? "targetCharacterName" : "targetNPPName";

  await db.collection("actionLogs").insertOne({
    characterId: myCharacter._id,
    userId: new ObjectId(userId),
    actionType: action === "raise" ? "supportPlayer" : "attackPlayer",
    [targetIdField]: target._id,
    [targetNameField]: target.name,
    actionCost,
    result: {
      success: !attackFailed,
      attackFailed,
      targetFavorabilityChange: favorabilityChange,
      infamyChange: infamyGain,
      message: getActionMessage(target.name, action, attackFailed),
    },
    turn: gameState?.currentTurn || 0,
    createdAt: new Date(),
  });

  // Notify the target player (characters only — NPPs have no user)
  if (targetType === "character") {
    const targetChar = target as Character;
    if (targetChar.userId) {
      if (action === "raise") {
        await createNotification({
          userId: targetChar.userId,
          type: "player_support",
          title: "You received support",
          message: `${myCharacter.name} supported your reputation (+1%).`,
          metadata: { attackerId: myCharacter._id.toString(), attackerName: myCharacter.name },
        });
      } else if (!attackFailed) {
        await createNotification({
          userId: targetChar.userId,
          type: "player_attack",
          title: "You were attacked",
          message: `${myCharacter.name} attacked your reputation (−1%).`,
          metadata: { attackerId: myCharacter._id.toString(), attackerName: myCharacter.name },
        });
      }
    }
  }

  // Get updated character
  const updatedMyCharacter = await db.collection<Character>("characters").findOne({
    _id: myCharacter._id,
  });

  return {
    result: {
      success: true,
      attackFailed,
      action,
      actionCost,
      targetName: target.name,
      newTargetInfluence: targetCurrentInfluence, // Influence doesn't change
      newTargetFavorability: attackFailed ? targetCurrentFavorability : newTargetFavorability,
      infamyGained: infamyGain,
      myCharacter: updatedMyCharacter!,
      message: getUserMessage(target.name, action, attackFailed),
    },
  };
}

function getActionMessage(
  targetName: string,
  action: "raise" | "lower",
  attackFailed: boolean
): string {
  if (action === "raise") return `Supported ${targetName}'s reputation (+1%)`;
  if (attackFailed) return `Attack on ${targetName} failed due to infamy (+2% infamy)`;
  return `Attacked ${targetName}'s reputation (-1%, +2% infamy)`;
}

function getUserMessage(
  targetName: string,
  action: "raise" | "lower",
  attackFailed: boolean
): string {
  if (action === "raise") return `You supported ${targetName}'s reputation (+1% favorability)`;
  if (attackFailed)
    return `Your attack on ${targetName} failed! Your infamy preceded you. (+2% infamy)`;
  return `You attacked ${targetName}'s reputation (-1% favorability, +2% infamy to you)`;
}
