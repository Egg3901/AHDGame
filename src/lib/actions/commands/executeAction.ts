/**
 * Shared action-execution core.
 *
 * Extracted from `src/app/api/actions/execute/route.ts` so that the HTTP route
 * (human players) and the autonomous NPP brain (`src/lib/nppAutonomy/`) drive
 * the SAME implementation of a political action's effects + persistence, rather
 * than the route and `nppActionProcessing.ts` each re-implementing the math.
 *
 * The route keeps request concerns (auth, rate-limit, batch/convert validation,
 * character resolution, response shaping). This core owns: state resolution,
 * forex boundary handling, the per-count apply loop, and — only when an actual
 * user is driving (player path) — action logging + achievement triggers. The
 * NPP path passes `actor.userId = null` to skip the player-only bookkeeping and
 * does its own.
 *
 * Currency convention (unchanged from the route): `effect.fundsChange` and
 * `effect.cashOnHandChange` are ANCHOR units; campaign/personal balances are
 * stored LOCAL. Conversion happens at the `$set` boundary via `campaignRate`
 * (the frozen INITIAL_RATES scale — campaign funds never touch live forex).
 */

import { ObjectId, type Db, type Filter } from "mongodb";
import {
  ACTIONS,
  canPerformAction,
  getActionPointCost,
  calculateConvertCashInfamy,
  makeFundsFormatter,
  formatLocalFunds,
  buildBatchResultMessage,
  USE_GROWTH_STAT_BY_ACTION,
} from "@/lib/actions";
import { rollDebatePrep } from "@/lib/stats/debatePrep";
import { USE_GROWTH_INCREMENT } from "@/lib/stats/statsConstants";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";
import type { ActionType, Character, State, ActionLog } from "@/lib/db/types";
import { getGameState } from "@/lib/gameState";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getPersonalBalance, getHomeCurrency } from "@/lib/currency/characterFunds";
import { campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { checkActionAchievements, checkFundsAchievements } from "@/lib/achievements/triggers";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

function clampAddExpression(fieldPath: string, delta: number, min: number, max: number) {
  return {
    $min: [
      max,
      {
        $max: [min, { $add: [{ $ifNull: [`$${fieldPath}`, 0] }, delta] }],
      },
    ],
  };
}

/**
 * Who is driving the action. For the player path, `userId` is set and the core
 * writes an `actionLogs` entry + runs achievement triggers. For autonomous
 * (NPP) callers, pass `userId: null` to skip all player-only bookkeeping.
 */
export interface ActionExecutionActor {
  userId: ObjectId | null;
  username?: string;
}

export interface ExecuteCharacterActionParams {
  /** The resolved actor document used for the first iteration. */
  character: Character;
  /** Filter used to re-read the character between batch iterations. */
  characterQuery: Filter<Character>;
  actionType: ActionType;
  targetState?: string | null;
  convertAmount?: number | null;
  count?: number;
  actor: ActionExecutionActor;
  /** RNG for the debatePrep roll. Defaults to Math.random; injectable for sims. */
  rng?: () => number;
}

export type ExecuteCharacterActionResult =
  | { ok: true; updatedCharacter: Character; message: string }
  | { ok: false; error: string; status: number };

/**
 * Execute a political action (optionally batched) against a character and apply
 * its effects. Mirrors the historical route loop exactly; see file header.
 */
export async function executeCharacterAction(
  db: Db,
  params: ExecuteCharacterActionParams
): Promise<ExecuteCharacterActionResult> {
  const {
    character,
    characterQuery,
    actionType,
    targetState,
    convertAmount,
    count = 1,
    actor,
    rng = Math.random,
  } = params;

  const action = ACTIONS[actionType];
  if (!action) return { ok: false, error: "Invalid action type", status: 400 };

  const forexEnabled = await isForexEnabled();
  const gameState = await getGameState();

  // Block player actions while the game is paused/stopped. `isActive` is false only
  // on admin stop, auto-drift pause, or a pre-start world (turnSystem.ts) — it is not
  // toggled during normal per-turn processing, so this does not block live play.
  // Without it, money-generating actions (fundraise/campaign/advertise) stayed fully
  // executable during a pause, letting a player mint an unbounded campaign war-chest
  // with no turns, competition, or other money flows running.
  if (gameState && gameState.isActive === false) {
    return { ok: false, error: "The game is currently paused.", status: 409 };
  }

  const homeCurrency = getHomeCurrency(character);
  // Campaign funds are DECOUPLED from live forex: costs/effects convert anchor →
  // local at the frozen base INITIAL_RATES scale (US ×1.0), never the live
  // exchangeRates. Every use of this rate below is a campaign-fund conversion;
  // personal cash (cashOnHandChange) is applied in local directly.
  const campaignRate = forexEnabled ? campaignLocalRate(character.countryId ?? "US") : 1;
  // Render action result messages in the player's LOCAL home currency (campaign
  // funds are stored in local; never surface anchor/₳). effect.fundsChange is
  // anchor, so this formatter handles the anchor→local conversion.
  const fundsFormatter = makeFundsFormatter(homeCurrency, campaignRate, forexEnabled);

  const needsHomeState =
    !action.requiresState &&
    (actionType === "campaign" || actionType === "advertise" || actionType === "buildDonorBase");

  const stateId = action.requiresState ? targetState : needsHomeState ? character.homeState : null;

  let state: State | null = null;
  if (stateId) {
    state = await db
      .collection<State>("states")
      .findOne({ _id: stateId, countryId: character.countryId });
    if (action.requiresState && !state) {
      return { ok: false, error: "Invalid state", status: 400 };
    }
  }

  let lastMessage = "";
  let updatedCharacter: Character | null = null;
  // One audit envelope per executed iteration (batch/convert can run count>1,
  // e.g. ×5/×10 — mirrors the existing `actionLogs` batch-write shape, N rows
  // ~15ms apart). Collected here and flushed with a single `recordAuditBulk`
  // call after the loop rather than per-iteration.
  const auditEntries: ActionAuditInput[] = [];

  for (let i = 0; i < count; i++) {
    const current =
      i === 0 ? character : await db.collection<Character>("characters").findOne(characterQuery);

    if (!current) {
      return { ok: false, error: "Character not found", status: 404 };
    }

    const actionCost = getActionPointCost(current, actionType);

    const validation = canPerformAction(current, actionType, state || undefined, {
      forexEnabled,
      homeFxRate: campaignRate,
    });
    if (!validation.canPerform) {
      return { ok: false, error: validation.reason ?? "Action not allowed", status: 400 };
    }

    if (actionType === "convertCash") {
      // Check against home-currency liquid — same bucket the deduct targets.
      // Old check summed savings into "cash on hand" and let savings-heavy
      // players pass, then sent liquid balance negative on deduct.
      const homeCcy = getHomeCurrency(current);
      const cash = getPersonalBalance(current, homeCcy, forexEnabled);
      if (!convertAmount || convertAmount <= 0) {
        return { ok: false, error: "You must specify an amount to convert.", status: 400 };
      }
      if (convertAmount > cash) {
        return {
          ok: false,
          error: `Amount exceeds liquid ${homeCcy} cash on hand. Available: ${cash.toLocaleString()}. Withdraw savings first if needed.`,
          status: 400,
        };
      }
    }

    // Debate Prep: gated behind the RPG-stats flag and requires an allocated
    // stat block (Debate lives in stats).
    if (actionType === "debatePrep") {
      if (!(await isRpgStatsEnabled())) {
        return { ok: false, error: "The stat system is not currently enabled.", status: 400 };
      }
      if (!current.stats) {
        return { ok: false, error: "Allocate your stats before using Debate Prep.", status: 400 };
      }
    }

    let effect;
    let debatePrepDebate: number | null = null;
    if (actionType === "debatePrep" && current.stats) {
      const roll = rollDebatePrep(rng, current.stats.debate);
      if (roll.success) debatePrepDebate = roll.debate;
      effect = {
        message: roll.success
          ? "Breakthrough in the briefing room — your Debate skill improved (+1)."
          : "You studied hard, but no breakthrough this time.",
      };
    } else if (actionType === "convertCash" && convertAmount) {
      // `convertAmount` arrives in the player's LOCAL home currency. The
      // route applies `cashOnHandChange` directly to a LOCAL field (no FX
      // conversion in the pipeline), so the debit side stays LOCAL. The
      // `fundsChange` slot, however, is downstream-multiplied by
      // `campaignRate` (see `fundsChangeLocal` below), so we pre-divide here
      // to keep it expressed in anchor units — `fundsChange × rate` then
      // round-trips back to the intended LOCAL credit.
      const convertedLocal = Math.floor(convertAmount * 0.5);
      const fundsChangeAnchor =
        forexEnabled && campaignRate > 0 ? convertedLocal / campaignRate : convertedLocal;
      const infamy = calculateConvertCashInfamy(convertAmount);
      // `convertAmount`/`convertedLocal` are already in LOCAL home currency.
      effect = {
        cashOnHandChange: -convertAmount,
        fundsChange: fundsChangeAnchor,
        infamyChange: infamy,
        message: `Donated ${formatLocalFunds(convertAmount, homeCurrency)} personal funds — ${formatLocalFunds(convertedLocal, homeCurrency)} added to campaign coffers. +${infamy} Infamy.`,
      };
    } else {
      effect = action.effect(current, state || undefined, { formatFunds: fundsFormatter });
    }

    // effect.fundsChange and effect.cashOnHandChange are in ANCHOR units.
    // Convert to LOCAL at the boundary so the filter + pipeline both
    // operate on the canonical home-currency fields.
    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const personalCashField = forexEnabled
      ? `currencyBalances.personal.${homeCurrency}`
      : "cashOnHand";
    const fundsChangeLocal = effect.fundsChange
      ? forexEnabled
        ? effect.fundsChange * campaignRate
        : effect.fundsChange
      : 0;
    const updateFilter: Record<string, unknown> = {
      _id: current._id,
      actions: { $gte: actionCost },
    };
    if (fundsChangeLocal < 0) {
      updateFilter[campaignFundsField] = { $gte: Math.abs(fundsChangeLocal) };
    }
    if ((effect.cashOnHandChange ?? 0) < 0) {
      updateFilter[personalCashField] = { $gte: Math.abs(effect.cashOnHandChange ?? 0) };
    }

    const pipelineSet: Record<string, unknown> = {
      actions: { $subtract: ["$actions", actionCost] },
      updatedAt: new Date(),
    };
    if (fundsChangeLocal !== 0) {
      pipelineSet[campaignFundsField] = {
        $add: [{ $ifNull: [`$${campaignFundsField}`, 0] }, fundsChangeLocal],
      };
    }
    if (effect.favorabilityChange) {
      pipelineSet.favorability = clampAddExpression(
        "favorability",
        effect.favorabilityChange,
        0,
        100
      );
    }
    if (effect.infamyChange) {
      pipelineSet.infamy = clampAddExpression("infamy", effect.infamyChange, 0, 100);
    }
    if (effect.donorBaseLevelChange) {
      pipelineSet.donorBaseLevel = {
        $add: [{ $ifNull: ["$donorBaseLevel", 0] }, effect.donorBaseLevelChange],
      };
    }
    if (effect.cashOnHandChange) {
      pipelineSet[personalCashField] = {
        $add: [{ $ifNull: [`$${personalCashField}`, 0] }, effect.cashOnHandChange],
      };
    }
    if (effect.politicalInfluenceChange) {
      pipelineSet.politicalInfluence = clampAddExpression(
        "politicalInfluence",
        effect.politicalInfluenceChange,
        0,
        100
      );
    }

    // Debate Prep: persist a successful +1 directly to the Debate stat.
    if (debatePrepDebate != null) {
      pipelineSet["stats.debate"] = debatePrepDebate;
    }

    // Use-growth: each qualifying action accrues fractional XP that the turn
    // engine flushes into the stat. Only meaningful for characters with an
    // allocated stat block. Energy grows on every action (active play).
    if (current.stats && actionType !== "debatePrep") {
      const growthStat = USE_GROWTH_STAT_BY_ACTION[actionType];
      if (growthStat) {
        pipelineSet[`statXp.${growthStat}`] = {
          $add: [{ $ifNull: [`$statXp.${growthStat}`, 0] }, USE_GROWTH_INCREMENT],
        };
      }
      pipelineSet["statXp.energy"] = {
        $add: [{ $ifNull: ["$statXp.energy", 0] }, USE_GROWTH_INCREMENT],
      };
    }

    const updated = await db
      .collection<Character>("characters")
      .findOneAndUpdate(updateFilter, [{ $set: pipelineSet }], { returnDocument: "after" });
    if (!updated) {
      return {
        ok: false,
        error: "Your available resources changed before the action completed. Please try again.",
        status: 409,
      };
    }

    updatedCharacter = updated ?? null;
    lastMessage = effect.message;

    // Player-only bookkeeping: action log + achievement triggers. Autonomous
    // (NPP) callers pass userId:null and handle their own logging.
    if (actor.userId) {
      const actionLog: Omit<ActionLog, "_id"> = {
        characterId: current._id,
        userId: actor.userId,
        actionType,
        targetState: targetState || undefined,
        actionCost: actionCost,
        result: {
          success: true,
          fundsChange: effect.fundsChange,
          politicalInfluenceChange: effect.politicalInfluenceChange,
          favorabilityChange: effect.favorabilityChange,
          infamyChange: effect.infamyChange,
          donorBaseLevelChange: effect.donorBaseLevelChange,
          cashOnHandChange: effect.cashOnHandChange,
          message: effect.message,
        },
        turn: gameState?.currentTurn || 0,
        createdAt: new Date(),
        characterName: current.name,
        username: actor.username,
        countryId: current.countryId,
      };

      // Achievement triggers expect anchor units. Compute newFunds in anchor
      // from local stored balance + the original anchor fundsChange.
      const balanceLocal = current.currencyBalances?.campaign ?? current.funds ?? 0;
      const balanceAnchor = forexEnabled ? balanceLocal / campaignRate : balanceLocal;
      const newFunds = balanceAnchor + (effect.fundsChange ?? 0);
      const userOid = actor.userId;
      const [actionLogResult] = await Promise.all([
        db.collection("actionLogs").insertOne(actionLog),
        checkActionAchievements(userOid, current._id, actionType, gameState?.currentTurn).catch(
          (e) => console.error("Achievement check failed:", e)
        ),
        checkFundsAchievements(userOid, current._id, newFunds).catch((e) =>
          console.error("Achievement check failed:", e)
        ),
      ]);

      auditEntries.push({
        source: "api",
        action: `character.${actionType}`,
        category: "character",
        actor: { kind: "player", userId: userOid, characterId: current._id, name: actor.username },
        subject: { type: "character", id: current._id, name: current.name },
        amount: effect.fundsChange || undefined,
        currencyCode: (effect.fundsChange ?? 0) !== 0 ? homeCurrency : undefined,
        refs: { actionLogId: actionLogResult.insertedId },
        outcome: "ok",
        meta: {
          targetState: targetState || undefined,
          actionCost,
          politicalInfluenceChange: effect.politicalInfluenceChange,
          favorabilityChange: effect.favorabilityChange,
          infamyChange: effect.infamyChange,
          donorBaseLevelChange: effect.donorBaseLevelChange,
          cashOnHandChange: effect.cashOnHandChange,
        },
      });
    }
  }

  if (auditEntries.length > 0) recordAuditBulk(auditEntries);

  if (!updatedCharacter) {
    // count < 1 guard — should not happen (route validates count >= 1).
    return { ok: false, error: "No action was executed.", status: 400 };
  }

  const message = buildBatchResultMessage(
    count,
    character,
    updatedCharacter,
    lastMessage,
    homeCurrency
  );

  return { ok: true, updatedCharacter, message };
}
