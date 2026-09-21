/**
 * Autonomous NPP index-fund redemptions (issue #2120).
 *
 * Before this module the ONLY caller of `enqueueRedemption` was the player
 * redeem route, so the NPP branch of `processQueuedRedemptions` in
 * `fundCron.ts` was unreachable in a running world and the full
 * subscribe -> rebalance -> redeem round trip had never happened.
 *
 * This adds a *gated* autonomous redemption policy: when
 * `gameConfig.nppFundRedemptionEnabled === true`, the NPP investing pass may
 * redeem a bounded fraction of an overweight position through the SAME
 * `enqueueRedemption` path the player route uses, so the cron pays it out on a
 * later turn. The policy has three hard properties:
 *
 *   1. Strictly bounded per turn — a single position can give up at most
 *      `NPP_FUND_REDEMPTION_MAX_FRACTION_PER_TURN` of its units in one pass.
 *   2. Never removes more units than held — the position debit is the atomic,
 *      balance-gated `debitFundPosition` guard; a failed debit skips the entry.
 *   3. Deterministic — the planner is pure and orders positions by value then
 *      by fund id, so identical inputs produce identical intents.
 *
 * When the flag is absent or false the pass performs a single config read and
 * returns zero with NO writes, so the NPP investing pass is byte-identical to
 * its pre-flag behavior.
 */

import { ObjectId, type Db } from "mongodb";
import type { GameConfig, IndexFund, IndexFundPosition } from "@/lib/db/types";
import {
  FUND_COLLECTION,
  FUND_POSITION_COLLECTION,
  creditFundPosition,
  debitFundPosition,
  enqueueRedemption,
  insertFundTransaction,
} from "@/lib/indexFunds/fundQueries";

/** Mirrors `NPRiskArchetype` in nppInvesting.ts (kept local to avoid an import cycle). */
export type NppRiskArchetype = "conservative" | "moderate" | "aggressive";

/**
 * Hard per-turn cap on how much of a single position an autonomous NPP may
 * redeem. Small enough that a position decays toward target over many turns
 * rather than being dumped in one pass.
 */
export const NPP_FUND_REDEMPTION_MAX_FRACTION_PER_TURN = 0.1;

/**
 * Archetype target share of total investment wealth (cash + fund value) that
 * the NPP wants to hold in fund units. When the realized fund share runs above
 * this, the excess is the redemption budget for the turn. Conservative NPPs
 * hold proportionally more cash, aggressive ones more funds.
 */
export const NPP_ARCHETYPE_TARGET_FUND_SHARE: Record<NppRiskArchetype, number> = {
  conservative: 0.55,
  moderate: 0.65,
  aggressive: 0.75,
};

/** Archetype's target fund share of total investment wealth. */
export function nppTargetFundShare(archetype: NppRiskArchetype): number {
  return NPP_ARCHETYPE_TARGET_FUND_SHARE[archetype];
}

/** One NPP's fund position as the planner sees it. */
export type NppHeldFundPosition = {
  fundId: ObjectId;
  units: number;
  /** Fund NAV used to value the position this pass. */
  quotedNav: number;
};

/** A planned redemption: `units` of `fundId` to queue for the cron to pay. */
export type NppRedemptionIntent = {
  fundId: ObjectId;
  units: number;
};

/**
 * Pure, deterministic redemption planner. Returns the whole units of each fund
 * an NPP should queue this pass to walk its fund share back toward its
 * archetype target.
 *
 * Bounds, all of which make the result safe to hand straight to the guarded
 * debit: each position contributes at most
 * `floor(units * NPP_FUND_REDEMPTION_MAX_FRACTION_PER_TURN)` units, never more
 * than it holds, and the running total never exceeds the overweight value.
 */
export function planNppFundRedemptions(input: {
  archetype: NppRiskArchetype;
  cashAnchor: number;
  positions: NppHeldFundPosition[];
}): NppRedemptionIntent[] {
  const positions = input.positions.filter(
    (p) =>
      Number.isFinite(p.units) && p.units >= 1 && Number.isFinite(p.quotedNav) && p.quotedNav > 0
  );
  if (positions.length === 0) return [];

  const cashAnchor = Number.isFinite(input.cashAnchor) ? Math.max(0, input.cashAnchor) : 0;
  const fundValueAnchor = positions.reduce((sum, p) => sum + Math.floor(p.units) * p.quotedNav, 0);
  const totalWealthAnchor = cashAnchor + fundValueAnchor;
  if (totalWealthAnchor <= 0 || fundValueAnchor <= 0) return [];

  const targetFundValueAnchor = nppTargetFundShare(input.archetype) * totalWealthAnchor;
  let remainingExcessAnchor = fundValueAnchor - targetFundValueAnchor;
  if (remainingExcessAnchor <= 0) return [];

  // Deterministic order: largest position value first, ties broken by fund id so
  // the same portfolio always yields the same plan.
  const ordered = [...positions].sort((a, b) => {
    const av = Math.floor(a.units) * a.quotedNav;
    const bv = Math.floor(b.units) * b.quotedNav;
    if (bv !== av) return bv - av;
    return a.fundId.toString().localeCompare(b.fundId.toString());
  });

  const intents: NppRedemptionIntent[] = [];
  for (const position of ordered) {
    if (remainingExcessAnchor <= 0) break;
    const heldUnits = Math.max(0, Math.floor(position.units));
    const fractionCap = Math.floor(heldUnits * NPP_FUND_REDEMPTION_MAX_FRACTION_PER_TURN);
    if (fractionCap <= 0) continue;
    const excessUnits = Math.floor(remainingExcessAnchor / position.quotedNav);
    const units = Math.min(fractionCap, excessUnits, heldUnits);
    if (units <= 0) continue;
    intents.push({ fundId: position.fundId, units });
    remainingExcessAnchor -= units * position.quotedNav;
  }
  return intents;
}

export type NppRedemptionPassResult = {
  redemptionsQueued: number;
  unitsRedeemed: number;
  errors: string[];
};

/**
 * Execute the autonomous redemption policy for every NPP that holds fund units.
 *
 * Gated on `gameConfig.nppFundRedemptionEnabled === true`. Off/absent is a
 * read-only no-op so the calling pass stays byte-identical. Each queued
 * redemption debits the NPP position and burns fund unit supply at request
 * time (exactly like the player route), so the cron's `processQueuedRedemptions`
 * only has to pay cash and can never leave an orphan position behind.
 */
export async function processNppFundRedemptions(
  db: Db,
  options: {
    currentTurn: number;
    /** Funds loaded by the calling pass; supplies `quotedNav`/`unitSupply`. */
    activeFunds: IndexFund[];
    /** Archetype per NPP id, from the investing pass's roster (no extra read). */
    archetypesByNppId: ReadonlyMap<string, NppRiskArchetype>;
  }
): Promise<NppRedemptionPassResult> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { nppFundRedemptionEnabled: 1 } });
  if (config?.nppFundRedemptionEnabled !== true || options.currentTurn <= 0) {
    return { redemptionsQueued: 0, unitsRedeemed: 0, errors: [] };
  }

  const errors: string[] = [];
  let redemptionsQueued = 0;
  let unitsRedeemed = 0;

  const fundById = new Map(options.activeFunds.map((fund) => [fund._id.toString(), fund]));

  const positions = await db
    .collection<IndexFundPosition>(FUND_POSITION_COLLECTION)
    .find({ holderKind: "npp" }, { projection: { nppId: 1, fundId: 1, units: 1 } })
    .toArray();

  const positionsByNppId = new Map<string, IndexFundPosition[]>();
  for (const position of positions) {
    if (!position.nppId) continue;
    const key = position.nppId.toString();
    const list = positionsByNppId.get(key);
    if (list) list.push(position);
    else positionsByNppId.set(key, [position]);
  }

  const candidateNppIds = [...positionsByNppId.keys()]
    .filter((id) => options.archetypesByNppId.has(id))
    .map((id) => new ObjectId(id))
    .sort((a, b) => a.toString().localeCompare(b.toString()));
  if (candidateNppIds.length === 0) {
    return { redemptionsQueued: 0, unitsRedeemed: 0, errors };
  }

  const cashByNppId = new Map<string, number>();
  const cashDocs = await db
    .collection<{ _id: ObjectId; nppInvestmentCashAnchor?: number }>("npps")
    .find({ _id: { $in: candidateNppIds } }, { projection: { nppInvestmentCashAnchor: 1 } })
    .toArray();
  for (const doc of cashDocs) cashByNppId.set(doc._id.toString(), doc.nppInvestmentCashAnchor ?? 0);

  const now = new Date();
  for (const nppId of candidateNppIds) {
    const nppKey = nppId.toString();
    const archetype = options.archetypesByNppId.get(nppKey);
    if (!archetype) continue;

    const heldPositions: NppHeldFundPosition[] = [];
    for (const position of positionsByNppId.get(nppKey) ?? []) {
      const fund = fundById.get(String(position.fundId));
      if (!fund || !Number.isFinite(fund.quotedNav) || fund.quotedNav <= 0) continue;
      heldPositions.push({
        fundId: position.fundId,
        units: position.units ?? 0,
        quotedNav: fund.quotedNav,
      });
    }

    const intents = planNppFundRedemptions({
      archetype,
      cashAnchor: cashByNppId.get(nppKey) ?? 0,
      positions: heldPositions,
    });

    for (const intent of intents) {
      try {
        const fund = fundById.get(intent.fundId.toString());
        if (!fund) continue;

        // Atomic, balance-gated debit: the sole guarantee that we never remove
        // more units than the NPP holds. A failed debit means a concurrent
        // change drained the position — skip rather than over-redeem.
        const debit = await debitFundPosition(db, intent.fundId, "npp", { nppId }, intent.units);
        if (!debit.ok) continue;

        // Burn the redeemed units from fund supply at request time, mirroring
        // the player route; the cron then only pays cash. Guarded; if supply
        // moved under us, restore the position and skip.
        const burn = await db
          .collection<IndexFund>(FUND_COLLECTION)
          .updateOne(
            { _id: intent.fundId, unitSupply: { $gte: intent.units } },
            { $inc: { unitSupply: -intent.units }, $set: { updatedAt: now } }
          );
        if (burn.matchedCount === 0) {
          await creditFundPosition(
            db,
            intent.fundId,
            "npp",
            { nppId },
            intent.units,
            fund.quotedNav
          );
          continue;
        }

        const amountAnchor = intent.units * fund.quotedNav;
        await enqueueRedemption(db, {
          fundId: intent.fundId,
          holderKind: "npp",
          nppId,
          units: intent.units,
          requestedNavAnchor: fund.quotedNav,
          requestedAmountAnchor: amountAnchor,
          paidAmountAnchor: 0,
          unitsBurnedAtRequest: true,
          status: "queued",
          createdAt: now,
          updatedAt: now,
        });
        await insertFundTransaction(db, {
          fundId: intent.fundId,
          kind: "redemption_queued",
          holderKind: "npp",
          nppId,
          units: intent.units,
          navAnchor: fund.quotedNav,
          amountAnchor,
          note: "NPP autonomous rebalance redemption queued",
          createdAt: now,
        });

        redemptionsQueued++;
        unitsRedeemed += intent.units;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`NPP ${nppKey} redemption: ${message}`);
      }
    }
  }

  return { redemptionsQueued, unitsRedeemed, errors };
}
