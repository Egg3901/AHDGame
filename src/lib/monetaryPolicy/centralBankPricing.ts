import type { Db } from "mongodb";
import type { Character, GameConfig } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";

/**
 * Shared pricing adjustment for central-bank LOCs and central-bank-held
 * savings. The adjustment is deliberately separate from borrower credit
 * spreads and the central bank's prime rate so each component stays visible
 * to players.
 */
export const CENTRAL_BANK_LOC_SPREAD_HIKE_PERCENT_POINTS = 2;
export const CENTRAL_BANK_DEPOSIT_BONUS_PERCENT_POINTS = 0.25;
export const CENTRAL_BANK_PRICING_PHASE_IN_TURNS = 8;

export type CentralBankPricingAdjustment = {
  spreadHikePercentPoints: number;
  depositBonusPercentPoints: number;
  progress: number;
  turnsRemaining: number;
  startedTurn?: number;
};

type CentralBankPricingPhase = NonNullable<GameConfig["centralBankPricingPhaseIn"]>;

const ZERO_ADJUSTMENT: CentralBankPricingAdjustment = {
  spreadHikePercentPoints: 0,
  depositBonusPercentPoints: 0,
  progress: 0,
  turnsRemaining: CENTRAL_BANK_PRICING_PHASE_IN_TURNS,
};

function roundPricingValue(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function resolveCentralBankPricingAdjustment(
  currentTurn: number,
  startedTurn: number
): CentralBankPricingAdjustment {
  const current = Number.isFinite(currentTurn) ? currentTurn : 0;
  const start = Number.isFinite(startedTurn) ? startedTurn : current;
  const progress = Math.min(
    1,
    Math.max(0, (current - start) / CENTRAL_BANK_PRICING_PHASE_IN_TURNS)
  );

  return {
    spreadHikePercentPoints: roundPricingValue(
      CENTRAL_BANK_LOC_SPREAD_HIKE_PERCENT_POINTS * progress
    ),
    depositBonusPercentPoints: roundPricingValue(
      CENTRAL_BANK_DEPOSIT_BONUS_PERCENT_POINTS * progress
    ),
    progress: roundPricingValue(progress),
    turnsRemaining: Math.max(0, Math.ceil(start + CENTRAL_BANK_PRICING_PHASE_IN_TURNS - current)),
    startedTurn: start,
  };
}

function hasFiniteTurn(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasActiveLoc(character: Pick<Character, "lineOfCredit">): boolean {
  const loc = character.lineOfCredit;
  if (!loc) return false;
  return (
    Object.values(loc.balances ?? {}).some((amount) => typeof amount === "number" && amount > 0) ||
    Object.values(loc.arrears ?? {}).some((amount) => typeof amount === "number" && amount > 0) ||
    loc.drawFrozen === true
  );
}

function hasCentralBankDeposit(
  character: Pick<Character, "currencyBalances"> & { savingsOnHand?: number }
): boolean {
  if (typeof character.savingsOnHand === "number" && character.savingsOnHand > 0) return true;
  const savings = character.currencyBalances?.savings ?? {};
  const holders = character.currencyBalances?.savingsHolder ?? {};
  return Object.entries(savings).some(([currency, amount]) => {
    if (typeof amount !== "number" || amount <= 0) return false;
    const holder = holders[currency as keyof typeof holders];
    return holder == null || holder === "centralBank";
  });
}

function inactiveAdjustment(): CentralBankPricingAdjustment {
  return { ...ZERO_ADJUSTMENT };
}

async function notifyExposedPlayers(
  db: Db,
  adjustment: CentralBankPricingAdjustment,
  startedTurn: number
): Promise<void> {
  const characters = await db
    .collection<
      Pick<Character, "_id" | "userId" | "lineOfCredit" | "currencyBalances"> & {
        savingsOnHand?: number;
      }
    >("characters")
    .find({})
    .project({ _id: 1, userId: 1, lineOfCredit: 1, currencyBalances: 1, savingsOnHand: 1 })
    .toArray();

  const userIds = new Map<string, Character["userId"]>();
  for (const character of characters) {
    if (!hasActiveLoc(character) && !hasCentralBankDeposit(character)) continue;
    userIds.set(character.userId.toString(), character.userId);
  }

  const inputs: NotificationInput[] = [...userIds.values()].map((userId) => ({
    userId,
    type: "system",
    title: "Central-bank loan and deposit rates are changing",
    message:
      "Central-bank lines of credit are phasing in a +2.00 percentage-point spread over prime across 8 turns. Central-bank deposits earn an extra +0.25 percentage points at full phase-in. Your rates update each turn during the phase-in.",
    metadata: {
      type: "central_bank_pricing_change",
      startedTurn,
      phaseInTurns: CENTRAL_BANK_PRICING_PHASE_IN_TURNS,
      locSpreadHikePercentPoints: CENTRAL_BANK_LOC_SPREAD_HIKE_PERCENT_POINTS,
      depositBonusPercentPoints: CENTRAL_BANK_DEPOSIT_BONUS_PERCENT_POINTS,
      currentSpreadHikePercentPoints: adjustment.spreadHikePercentPoints,
      currentDepositBonusPercentPoints: adjustment.depositBonusPercentPoints,
    },
  }));

  await createNotifications(inputs);
}

export async function loadCentralBankPricingAdjustment(
  db: Db,
  currentTurn: number
): Promise<CentralBankPricingAdjustment> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { "centralBankPricingPhaseIn.startedTurn": 1 } });
  const phase = config?.centralBankPricingPhaseIn;
  if (!phase || !hasFiniteTurn(phase.startedTurn)) return inactiveAdjustment();
  return resolveCentralBankPricingAdjustment(currentTurn, phase.startedTurn);
}

export async function ensureCentralBankPricingPhaseIn(
  db: Db,
  currentTurn: number
): Promise<CentralBankPricingAdjustment> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { centralBankPricingPhaseIn: 1 } });
  const phase = config?.centralBankPricingPhaseIn as CentralBankPricingPhase | undefined;
  if (!phase) return inactiveAdjustment();

  let startedTurn = hasFiniteTurn(phase.startedTurn) ? phase.startedTurn : undefined;
  if (startedTurn === undefined) {
    const normalizedTurn = Number.isFinite(currentTurn) ? currentTurn : 0;
    const initialized = await db
      .collection<GameConfig>("gameConfig")
      .updateOne(
        { _id: "default", "centralBankPricingPhaseIn.startedTurn": { $exists: false } },
        { $set: { "centralBankPricingPhaseIn.startedTurn": normalizedTurn } }
      );
    if (initialized.matchedCount > 0) {
      startedTurn = normalizedTurn;
    } else {
      const refreshed = await db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { centralBankPricingPhaseIn: 1 } });
      const refreshedPhase = refreshed?.centralBankPricingPhaseIn;
      if (!refreshedPhase || !hasFiniteTurn(refreshedPhase.startedTurn)) {
        return inactiveAdjustment();
      }
      startedTurn = refreshedPhase.startedTurn;
    }
  }

  const adjustment = resolveCentralBankPricingAdjustment(currentTurn, startedTurn);
  const notificationClaim = await db.collection<GameConfig>("gameConfig").updateOne(
    {
      _id: "default",
      "centralBankPricingPhaseIn.startedTurn": startedTurn,
      "centralBankPricingPhaseIn.notificationSentTurn": { $exists: false },
    },
    { $set: { "centralBankPricingPhaseIn.notificationSentTurn": currentTurn } }
  );
  if (notificationClaim.matchedCount > 0) {
    await notifyExposedPlayers(db, adjustment, startedTurn);
  }

  return { ...adjustment, startedTurn };
}
