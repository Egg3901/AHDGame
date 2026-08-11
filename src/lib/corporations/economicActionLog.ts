import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { recordAudit } from "@/lib/audit/recordAudit";

/**
 * Economic action types logged to `actionLogs` for automation detection.
 *
 * Kept separate from the AP `ActionType` union (fundraise/campaign/…): those
 * values feed AP-cost maps and achievement checks, so widening that union to
 * cover corp economic actions would ripple into unrelated systems. These rows
 * share the `actionLogs` collection (schemaless) purely so the suspicious-
 * activity timing detector sees one unified per-actor action timeline.
 */
export type EconomicActionType =
  | "attackSector"
  | "splitSector"
  | "buyShares"
  | "sellShares"
  | "buySector"
  | "growSector"
  // Plants tier (P3a, buildable sectors): capacity orders and mothballing.
  | "buildCapacity"
  | "cancelCapacityBuild"
  | "mothballSector"
  | "reactivateSector";

export interface EconomicActionLogParams {
  /** ObjectId or its hex string — conversion + validation happen inside. */
  characterId: ObjectId | string;
  /** ObjectId or its hex string — conversion + validation happen inside. */
  userId: ObjectId | string;
  actionType: EconomicActionType;
  targetState?: string;
  turn: number;
  characterName?: string;
  username?: string;
  countryId?: CountryId;
  result: { success: boolean; message: string; fundsChange?: number };
  /**
   * Economic cost of the action, for audit/spend reconstruction. All monetary
   * fields are ₳-denominated (anchor units), NOT the corp's local currency —
   * callers must convert local amounts to ₳ before passing them.
   */
  /** Corp capital spent, in ₳ (anchor units). */
  corpCashCostAnchor?: number;
  /** Marketing strength spent. */
  msCost?: number;
  /** Market revenue captured/gained, in ₳ (split/attack/buy). */
  capturedRevenueAnchor?: number;
  /** The corporation's liquid currency code, for reference (costs above are ₳-normalized). */
  currencyCode?: string;
}

function toObjectId(value: ObjectId | string): ObjectId {
  return typeof value === "string" ? new ObjectId(value) : value;
}

/**
 * Fire-and-forget insert of an economic action into `actionLogs`. Mirrors the
 * row shape written by `actions/execute` so the automation detector can read a
 * single homogeneous timeline. `actionCost` is 0 — economic actions spend corp
 * capital / marketing strength, not character AP, and the suspicious-activity
 * detector reads `actionCost` as character AP, so it must stay 0.
 *
 * The real economic cost of the action is captured separately in the optional
 * `corpCashCostAnchor` / `msCost` / `capturedRevenueAnchor` fields (all monetary
 * ones ₳-denominated) plus `currencyCode` for reference — these support
 * spend/audit reconstruction and are omitted when the caller doesn't supply them.
 *
 * Fully self-contained: id conversion and the insert run inside a try/catch so
 * logging can never throw into — or fault — the calling action route.
 */
export async function logEconomicAction(db: Db, params: EconomicActionLogParams): Promise<void> {
  try {
    const characterId = toObjectId(params.characterId);
    const userId = toObjectId(params.userId);
    const insertResult = await db.collection("actionLogs").insertOne({
      characterId,
      userId,
      actionType: params.actionType,
      targetState: params.targetState,
      actionCost: 0,
      result: params.result,
      turn: params.turn,
      createdAt: new Date(),
      characterName: params.characterName,
      username: params.username,
      countryId: params.countryId,
      // ₳-denominated economic-cost fields — omit any the caller didn't supply
      // (write no explicit `undefined`).
      ...(params.corpCashCostAnchor !== undefined
        ? { corpCashCostAnchor: params.corpCashCostAnchor }
        : {}),
      ...(params.msCost !== undefined ? { msCost: params.msCost } : {}),
      ...(params.capturedRevenueAnchor !== undefined
        ? { capturedRevenueAnchor: params.capturedRevenueAnchor }
        : {}),
      ...(params.currencyCode !== undefined ? { currencyCode: params.currencyCode } : {}),
    });

    // Audit spine envelope — cost fields (corp capital, in ₳) go into `amount`;
    // marketing-strength/revenue quick fields land in `meta` since they aren't
    // money-in-a-currency. `refs.actionLogId` cross-links the heavy row above.
    recordAudit({
      source: "api",
      action: `corp.${params.actionType}`,
      category: "corp",
      actor: { kind: "player", userId, characterId, name: params.username },
      subject: { type: "character", id: characterId, name: params.characterName },
      counterparty: params.targetState ? { type: "state", id: params.targetState } : undefined,
      amount: params.corpCashCostAnchor,
      currencyCode: params.currencyCode as CurrencyCode | undefined,
      refs: { actionLogId: insertResult.insertedId },
      outcome: params.result.success ? "ok" : "rejected",
      reason: params.result.success ? undefined : params.result.message,
      meta: {
        msCost: params.msCost,
        capturedRevenueAnchor: params.capturedRevenueAnchor,
        countryId: params.countryId,
      },
    });
  } catch (error) {
    // Never let action logging break or fault the action it records — but the
    // dropped row is invisible to the suspicious-activity detector, so report it.
    Sentry.captureException(error, {
      tags: { module: "economicActionLog", actionType: params.actionType },
    });
  }
}
