/**
 * nppCorporateAttacks — autonomous NPP corporate aggression (NPP-autonomy V2.2).
 *
 * NPP-run corporations (spawned NPP corps and player-appointed caretaker CEOs)
 * don't just expand into unowned markets — they go on the offensive, launching
 * the same economic **sector attacks** a player corp can, capturing market share
 * from rival owned sectors. Targets are chosen **by rule** (best capture
 * opportunity in a market the attacker operates in) and may be NPP-owned or
 * player-owned alike — the attack is indifferent to who owns the defender, so a
 * player corp is a legitimate target exactly as another NPP corp is.
 *
 * Everything routes through the **same** cost/capture helpers as the player
 * attack path (`calculateAttackCostAnchor`, `calculateSplitMsCost`,
 * `fetchAttackerDefenderShares`, the dominance/underdog multipliers,
 * `ATTACK_OWNED_CONTESTED_FRACTION`) so an autonomous attack and a player attack
 * resolve identically — no bespoke "NPP damage" and no way to exceed the normal
 * mechanic. Aggression is bounded: only `aggressive`-archetype corps attack,
 * only with surplus cash + MS, and only once per `ATTACK_COOLDOWN_TURNS`.
 *
 * Gating: `nppAutonomyAtLeast(attacker.countryId, "v2")` — economic aggression is
 * the comingle-tier capability. A no-op below v2 / where autonomy is off.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Corporation, CorporateSector, State } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  ATTACK_OWNED_CONTESTED_FRACTION,
  DEFAULT_PROFIT_MARGIN,
  DEFAULT_SECTOR_STARTING_WORKERS,
  CORPORATION_TYPE_LABELS,
  getDominanceAttackEaseMultiplier,
  getUnderdogAttackAmplifier,
} from "@/lib/constants/corporations";
import {
  calculateAttackCostAnchor,
  calculateSplitMsCost,
} from "@/lib/corporations/marketActionCosts";
import { fetchAttackerDefenderShares } from "@/lib/corporations/marketShare";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { emitBuildCapexTx } from "@/lib/corporations/capexTxLog";
import { isCorporateSectorDuplicateKey } from "@/lib/corporations/sectorLocation";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";
import {
  attackCapacityBasisAnchor,
  attackCostAnchorUnderPlants,
  capacityCaptureUnits,
  capacityCaptureBookUpdates,
  resolveWorldYear,
} from "@/lib/corporations/capacityCapture";
import { deriveCeoArchetype } from "./ceoArchetype";
import { logWireEvent, wireHeadlineSectorAttack } from "@/lib/wireEvent";
import { createNotification } from "@/lib/notifications";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import {
  canAttackDefender,
  canNotifyPlayer,
  countRecentNppNotifications,
  NPP_NOTIFICATION_WINDOW_TURNS,
} from "@/lib/nppAutonomy/playerImpactBudget";
import type { NPP, NPPPersonality } from "@/lib/db/types/npp";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

/** Turns between autonomous attacks by the same corp (telegraphed, not a barrage). */
export const ATTACK_COOLDOWN_TURNS = 24;
/** An attacker keeps at least this much MS in reserve after paying the MS cost. */
const ATTACK_MS_RESERVE = 5;
/** Skip targets whose capturable revenue is below this (anchor) — not worth it. */
const MIN_TARGET_REVENUE_ANCHOR = 50_000;

/** A rival sector the attacker could strike, with the defender it belongs to. */
export interface AttackCandidate {
  sector: Pick<
    CorporateSector,
    | "_id"
    | "stateId"
    | "sectorType"
    | "countryId"
    | "revenue"
    | "capitalStock"
    | "capacityBookAnchor"
    | "strategyId"
  >;
  defender: Pick<
    Corporation,
    "_id" | "name" | "marketingStrength" | "countryOwnerId" | "suspended" | "userId" | "ceoVacant"
  > &
    Parameters<typeof getCorpFxRate>[1];
  /**
   * What the target is worth taking, in ₳. Below plants this is the defender's
   * revenue normalised for cross-currency comparison; under plants it is the
   * capacity nameplate (see `attackCapacityBasisAnchor`), which is already ₳.
   */
  revenueAnchor: number;
}

/**
 * Pure target selection: pick the rival sector with the best expected capture
 * for `attackerMS`, skipping illegitimate targets (own corp, state-owned,
 * suspended, sub-threshold revenue). Score ≈ attacker MS share × capturable
 * revenue — a fast heuristic for ranking; the precise capture is computed at
 * execution. Owner-agnostic: a player-owned defender is ranked like any other.
 * Returns the chosen candidate, or null when none is worth attacking.
 */
export function selectAttackTarget(
  attackerId: ObjectId,
  attackerMS: number,
  candidates: AttackCandidate[]
): AttackCandidate | null {
  let best: AttackCandidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (c.defender._id.equals(attackerId)) continue; // never own sectors
    if (c.defender.countryOwnerId) continue; // never state-owned corps
    if (c.defender.suspended) continue; // never corps pending auction
    if (c.revenueAnchor < MIN_TARGET_REVENUE_ANCHOR) continue;
    const defenderMS = c.defender.marketingStrength ?? 0;
    const msSum = attackerMS + defenderMS;
    const attackerShare = msSum > 0 ? attackerMS / msSum : 1;
    const score = attackerShare * c.revenueAnchor;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export interface NppAttackResult {
  capturedAnchor: number;
  defenderName: string;
  sectorType: string;
}

/**
 * Defender-facing message for an autonomous sector attack (suggestion #324).
 * Names the attacking corp, the sector, and the state, and says what the $
 * figure is: revenue moved below plants, plant capacity at book value under
 * plants. Pure, so notification copy can be pinned by unit test.
 */
export function formatNppSectorAttackDefenderMessage(args: {
  attackerName: string;
  capturedAnchor: number;
  sectorLabel: string;
  stateLabel: string;
  plantsEnabled: boolean;
  capacityUnitsTaken: number;
}): string {
  const { attackerName, capturedAnchor, sectorLabel, stateLabel } = args;
  if (args.plantsEnabled) {
    return (
      `${attackerName} seized ${args.capacityUnitsTaken.toLocaleString("en-US", { maximumFractionDigits: 2 })}` +
      ` capacity units (~$${capturedAnchor.toLocaleString()} book value) from your ${sectorLabel} sector in ${stateLabel}.` +
      ` This is plant capacity moved to the attacker, not cash or profit.`
    );
  }
  return (
    `${attackerName} captured $${capturedAnchor.toLocaleString()} of revenue from your ${sectorLabel} sector in ${stateLabel}.` +
    ` This is revenue moved to the attacker's sector, not profit or your sector's total value.`
  );
}

/**
 * Execute one autonomous sector attack, applying the identical cost/capture math
 * as the player route. Returns the captured amount (₳) or null when the attack
 * could not meaningfully proceed (too little capture). Assumes the caller has
 * already verified affordability + cooldown + gate.
 */
export async function executeNppSectorAttack(
  db: Db,
  args: {
    attacker: Corporation;
    targetSector: Pick<
      CorporateSector,
      | "_id"
      | "stateId"
      | "sectorType"
      | "countryId"
      | "revenue"
      | "capitalStock"
      | "capacityBookAnchor"
      | "strategyId"
    >;
    defender: AttackCandidate["defender"];
    currentTurn: number;
    now: Date;
    /** `marketSystemMode >= "plants"` — capture transfers capacity, not revenue. */
    plantsEnabled?: boolean;
    /** World year, for the plants build-price floor on the attack cost. */
    year?: number;
    /** Attacker capital in ₳ — checked again under plants, where the price is higher. */
    capitalAnchor?: number;
  }
): Promise<NppAttackResult | null> {
  const {
    attacker,
    targetSector,
    defender,
    currentTurn,
    now,
    // PLANTS-GATED: NPP attacks share the player attack's capacity-transfer path —
    // defender loses units, attacker receives the post-attrition share. The revenue
    // writes are ternary-gated and run only below plants.
    plantsEnabled = false,
    year,
    capitalAnchor,
  } = args;
  const attackerMS = attacker.marketingStrength ?? 0;
  const defenderMS = defender.marketingStrength ?? 0;
  const eraUnitScale = await loadWorldEraUnitScale(db);

  const attackerFxRate = await getCorpFxRate(db, attacker);
  const defenderFxRate = await getCorpFxRate(db, defender);
  const attackerCurrencyCode = resolveCorpLiquidCurrencyCode(attacker);
  const defenderCurrencyCode = resolveCorpLiquidCurrencyCode(defender);

  // ATTACK BASIS — capacity nameplate under plants, ₳ revenue below it. See
  // `attackCapacityBasisAnchor`: sizing an attack off derived `revenue` made a
  // mothballed defender simultaneously un-attackable (every threshold and the
  // `actualCapture <= 0` abort read 0) and free to attack (the price is a
  // fraction of the same 0). Identical substitution to the player route, so the
  // two paths cannot disagree on what a target is worth taking.
  const targetRevenueAnchor =
    attackCapacityBasisAnchor(
      {
        sectorType: targetSector.sectorType as CorporationType,
        capitalStock: targetSector.capitalStock,
        strategyId: targetSector.strategyId,
      },
      plantsEnabled,
      eraUnitScale
    ) ?? readCorpEconomicAnchor(targetSector.revenue, defenderCurrencyCode, defenderFxRate);

  // Capture math — identical to the player attack-sector path.
  const { defenderSharePercent, attackerSharePercent } = await fetchAttackerDefenderShares(
    db,
    targetSector,
    defender,
    attacker._id
  );
  const dominanceMult = getDominanceAttackEaseMultiplier(defenderSharePercent);
  const underdogMult = getUnderdogAttackAmplifier(attackerSharePercent, defenderSharePercent);
  const contestedAmount =
    targetRevenueAnchor * ATTACK_OWNED_CONTESTED_FRACTION * dominanceMult * underdogMult;
  const msSum = attackerMS + defenderMS;
  const attackerShare = msSum > 0 ? attackerMS / msSum : 1;
  const actualCapture = Math.min(
    Math.round(contestedAmount * attackerShare),
    Math.max(0, Math.floor(targetRevenueAnchor) - 1)
  );
  if (actualCapture <= 0) return null;

  // Plants: the capture is a CAPACITY transfer with attrition, priced against
  // the build table. Same translation the player route applies — see
  // `capacityCapture.ts` for why revenue must not be written here.
  const defenderStock =
    typeof targetSector.capitalStock === "number" && Number.isFinite(targetSector.capitalStock)
      ? Math.max(0, targetSector.capitalStock)
      : 0;
  const rawUnits = capacityCaptureUnits(
    actualCapture,
    targetSector.sectorType as CorporationType,
    targetSector.strategyId,
    eraUnitScale
  );
  const unitsTaken = Math.min(defenderStock, rawUnits.unitsTaken);
  const unitsReceivedAtDefenderMix =
    rawUnits.unitsTaken > 0 ? rawUnits.unitsReceived * (unitsTaken / rawUnits.unitsTaken) : 0;

  const attackCostAnchor = plantsEnabled
    ? attackCostAnchorUnderPlants({
        legacyCostAnchor: calculateAttackCostAnchor(targetRevenueAnchor),
        unitsReceived: unitsReceivedAtDefenderMix,
        sectorType: targetSector.sectorType as CorporationType,
        year: resolveWorldYear(year, currentTurn),
        eraUnitScale,
      })
    : calculateAttackCostAnchor(targetRevenueAnchor);
  // The caller's affordability screen ran against the LEGACY price, which the
  // plants floor can exceed. Re-check rather than let an NPP overdraw itself.
  if (
    plantsEnabled &&
    typeof capitalAnchor === "number" &&
    Number.isFinite(capitalAnchor) &&
    capitalAnchor < attackCostAnchor
  ) {
    return null;
  }
  const msCost = calculateSplitMsCost(attacker.splitEscalation ?? 0);

  const captureInDefenderLocal = Math.round(
    writeCorpEconomicLocal(actualCapture, defenderCurrencyCode, defenderFxRate)
  );
  const captureInAttackerLocal = Math.round(
    writeCorpEconomicLocal(actualCapture, attackerCurrencyCode, attackerFxRate)
  );

  // Credit the attacker's matching sector (existing or new). Read BEFORE the
  // defender is written so the P5 basis transfer sees both sides' pre-attack state.
  const stateId = targetSector.stateId;
  const existing = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ stateId, sectorType: targetSector.sectorType, corporationId: attacker._id });

  // P5: the paid basis moves with the plant. Identical to the player route.
  const captureBook = plantsEnabled
    ? capacityCaptureBookUpdates({
        defender: {
          sectorType: targetSector.sectorType as CorporationType,
          capitalStock: targetSector.capitalStock,
          capacityBookAnchor: targetSector.capacityBookAnchor,
        },
        attacker: existing
          ? {
              sectorType: existing.sectorType,
              capitalStock: existing.capitalStock,
              capacityBookAnchor: existing.capacityBookAnchor,
            }
          : null,
        unitsTaken,
        unitsReceived: unitsReceivedAtDefenderMix,
        year: resolveWorldYear(year, currentTurn),
        eraUnitScale,
      })
    : null;

  // Reduce the defender: capacity units under plants, revenue below it.
  await db.collection<CorporateSector>("corporateSectors").updateOne(
    { _id: targetSector._id },
    plantsEnabled
      ? {
          $inc: { capitalStock: -(Math.round(unitsTaken * 100) / 100) },
          $set: { updatedAt: now, ...(captureBook?.defenderSet ?? {}) },
        }
      : { $inc: { revenue: -captureInDefenderLocal }, $set: { updatedAt: now } }
  );

  // Nameplate-invariant across a strategy difference — see the player route.
  const unitsForAttacker = plantsEnabled
    ? unitsReceivedAtDefenderMix *
      capacityRescaleRatio(
        targetSector.sectorType as CorporationType,
        targetSector.strategyId,
        existing?.strategyId
      )
    : 0;
  const capitalStockDelta = Math.round(unitsForAttacker * 100) / 100;

  if (existing) {
    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: existing._id },
      plantsEnabled
        ? {
            $inc: { capitalStock: capitalStockDelta },
            $set: { updatedAt: now, capacityBookAnchor: captureBook?.attackerBookAnchor ?? 0 },
          }
        : { $inc: { revenue: captureInAttackerLocal }, $set: { updatedAt: now } }
    );
  } else {
    const newSector: Omit<CorporateSector, "_id"> = {
      corporationId: attacker._id,
      countryId: targetSector.countryId,
      stateId,
      sectorType: targetSector.sectorType as CorporationType,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      // Plants: born with capacity, no revenue — the turn processor derives it.
      revenue: plantsEnabled ? 0 : captureInAttackerLocal,
      ...(plantsEnabled
        ? {
            capitalStock: capitalStockDelta,
            capacityBookAnchor: captureBook?.attackerBookAnchor ?? 0,
            plantsStartTurn: currentTurn,
          }
        : {}),
      profitMargin: DEFAULT_PROFIT_MARGIN,
      workers: DEFAULT_SECTOR_STARTING_WORKERS,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db
        .collection<CorporateSector>("corporateSectors")
        .insertOne(newSector as CorporateSector);
    } catch (error) {
      if (isCorporateSectorDuplicateKey(error)) {
        await db.collection<CorporateSector>("corporateSectors").updateOne(
          { corporationId: attacker._id, stateId, sectorType: targetSector.sectorType },
          plantsEnabled
            ? {
                $inc: { capitalStock: capitalStockDelta },
                $set: {
                  updatedAt: now,
                  capacityBookAnchor: captureBook?.attackerBookAnchor ?? 0,
                },
              }
            : { $inc: { revenue: captureInAttackerLocal }, $set: { updatedAt: now } }
        );
      } else {
        throw error;
      }
    }
  }

  // Deduct cost + MS, escalate, and stamp the attack cooldown on the attacker.
  const attackCostLocal = anchorToCorpLiquidCapital(attackCostAnchor, attacker, attackerFxRate);
  await db.collection<Corporation>("corporations").updateOne(
    { _id: attacker._id },
    {
      $inc: { liquidCapital: -attackCostLocal, marketingStrength: -msCost, splitEscalation: 1 },
      $set: { lastAutoAttackTurn: currentTurn, updatedAt: now },
    }
  );

  // ─── Ledger leg for the attack fee (plants) ────────────────────────────────
  //
  // Byte-for-byte the same leg the PLAYER attack routes emit, for the same
  // reason: the `liquidCapital` decrement just above is a bare `$inc` with no
  // counterpart, and under plants `attackCostAnchorUnderPlants` floors the fee
  // at the build price of the captured capacity times ATTACK_BUILD_PRICE_PREMIUM
  // — an unattributed drain of that size reads to the shadow ledger as money
  // vanishing from the world.
  //
  // NPP attackers move real money out of real corporations, so the turn path
  // owes the ledger exactly what the API path owes it. It was the only one of
  // the three attack paths that did not book the row; the omission was latent
  // only because `nppCorporateAttacksEnabled` defaults off.
  //
  // Booked as capacity capex because that is what it is: the corp paid at least
  // replacement cost and received real plant. Below plants the fee is still the
  // legacy marketing spend and no row is emitted, so the ledger is
  // byte-identical there. Best-effort, like every other capex leg — the cash has
  // already moved, so a log failure must not abort the turn.
  if (plantsEnabled && attackCostAnchor > 0 && attackCostLocal > 0) {
    await emitBuildCapexTx(db, {
      corporationId: attacker._id,
      corporationName: attacker.name,
      corporationSequentialId: attacker.sequentialId,
      direction: "build",
      amountLocal: Math.abs(attackCostLocal),
      currencyCode: attackerCurrencyCode ?? "USD",
      anchorAmount: attackCostAnchor,
      turn: currentTurn,
      createdAt: now,
      sectorId: targetSector._id,
      sectorType: targetSector.sectorType,
      units: capitalStockDelta,
      meta: { reason: "sectorAttackCapture" },
    }).catch(() => {});
  }

  // Stamp the DEFENDER's cooldown too. The attacker-side stamp above bounds how
  // often one NPP corp attacks; it says nothing about how often a given corp is
  // attacked, so any number of NPP corps could converge on one player in the same
  // turn. This is the field that makes the shared defender cooldown possible.
  await db
    .collection<Corporation>("corporations")
    .updateOne({ _id: defender._id }, { $set: { lastAutoAttackedTurn: currentTurn } });

  const sectorLabel =
    CORPORATION_TYPE_LABELS[targetSector.sectorType as CorporationType] ?? targetSector.sectorType;

  // Wire headline (same surface as a player attack) so the action is visible.
  const stateName = await db
    .collection<State>("states")
    .findOne({ _id: stateId }, { projection: { name: 1 } });
  logWireEvent(
    "sector_attack",
    wireHeadlineSectorAttack(
      attacker.name,
      actualCapture,
      sectorLabel,
      defender.name,
      stateName?.name ?? stateId
    ),
    {}
  );

  // Notify a player defender — economic aggression should never be silent.
  // Budgeted, though: past a few in a window the notifications stop carrying
  // information the earlier ones didn't, and the wire headline above still
  // records every attack for anyone who goes looking.
  const notificationsSent = defender.userId
    ? await countRecentNppNotifications(
        db,
        defender.userId,
        ["corp_sector_attacked"],
        new Date(now.getTime() - NPP_NOTIFICATION_WINDOW_TURNS * 60 * 60 * 1000)
      )
    : 0;
  if (defender.userId && !defender.ceoVacant && canNotifyPlayer(notificationsSent)) {
    // Suggestion #324: name the sector AND the state, and say what the $ is.
    // Below plants the capture moves revenue; under plants it moves plant
    // capacity priced at book value (no cash or profit changes hands).
    const captureMessage = formatNppSectorAttackDefenderMessage({
      attackerName: attacker.name,
      capturedAnchor: actualCapture,
      sectorLabel,
      stateLabel: stateName?.name ?? stateId,
      plantsEnabled,
      capacityUnitsTaken: unitsTaken,
    });
    await createNotification({
      userId: defender.userId,
      type: "corp_sector_attacked",
      title: "Sector Attacked",
      message: captureMessage,
      metadata: {
        attackerCorporationName: attacker.name,
        attackerCorporationId: attacker._id.toString(),
        sectorType: targetSector.sectorType,
        sectorLabel,
        stateId,
        stateName: stateName?.name ?? null,
        countryId: targetSector.countryId,
        revenueLost: actualCapture,
        captureKind: plantsEnabled ? "capacity" : "revenue",
        ...(plantsEnabled ? { capacityUnitsTaken: unitsTaken } : {}),
      },
    });
  }

  return { capturedAnchor: actualCapture, defenderName: defender.name, sectorType: sectorLabel };
}

/**
 * Whether an NPP-run corp is willing + able to attack this turn: aggressive
 * archetype, off cooldown, and holding surplus cash + MS above the attack cost.
 * Pure. `cost`/`ms` are the attack's ₳ cost and MS cost for the chosen target.
 */
export function canAttack(args: {
  personality: NPPPersonality | undefined;
  lastAutoAttackTurn: number | undefined;
  currentTurn: number;
  capitalAnchor: number;
  attackCostAnchor: number;
  marketingStrength: number;
  msCost: number;
}): boolean {
  const { personality, lastAutoAttackTurn, currentTurn, capitalAnchor, attackCostAnchor } = args;
  if (!personality) return false;
  if (deriveCeoArchetype(personality) !== "aggressive") return false;
  if (lastAutoAttackTurn != null && currentTurn - lastAutoAttackTurn < ATTACK_COOLDOWN_TURNS) {
    return false;
  }
  if (capitalAnchor < attackCostAnchor) return false;
  if (args.marketingStrength < args.msCost + ATTACK_MS_RESERVE) return false;
  return true;
}

/**
 * Turn phase: run autonomous NPP corporate attacks. For each NPP-run corp whose
 * country is at the comingle tier (v2), find the best rival sector in a market
 * it operates in and — if its archetype is aggressive, it is off cooldown, and
 * it can afford the strike — capture share from it. Returns the attack count.
 */
export async function runNppCorporateAttacks(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<number> {
  // Economic aggression is DECOUPLED from the political autonomy tier: raising
  // political autonomy (e.g. to v3 for government formation) must NOT also make
  // NPP corps launch sector attacks against owned player/NPP sectors. At the
  // current stage NPPs should only expand into UNOWNED market, so corporate
  // attacks require an explicit opt-in and are OFF by default. The per-attacker
  // nppAutonomyAtLeast(v2) gate still applies on top when enabled.
  const cfg = await db
    .collection("gameConfig")
    .findOne({ _id: "default" } as Record<string, unknown>, {
      projection: { nppCorporateAttacksEnabled: 1 },
    });
  if (
    (cfg as { nppCorporateAttacksEnabled?: boolean } | null)?.nppCorporateAttacksEnabled !== true
  ) {
    return 0;
  }

  const nppCorps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", suspended: { $ne: true } })
    .toArray();
  if (nppCorps.length === 0) return 0;

  // Hydrate CEO NPP personalities (archetype → aggression).
  const ceoIds = nppCorps.map((c) => c.ceoId).filter(Boolean);
  const npps = ceoIds.length
    ? await db
        .collection<NPP>("npps")
        .find({ _id: { $in: ceoIds } }, { projection: { personality: 1 } })
        .toArray()
    : [];
  const personalityByNpp = new Map(npps.map((n) => [n._id.toString(), n.personality]));

  // Batched candidate discovery — this used to do 3-4 sequential round-trips
  // PER attacking corp (own sectors, rival sectors, defenders, one FX lookup
  // per rival sector) plus a `nppAutonomyAtLeast` DB round-trip per attacker
  // regardless of country repetition. Fine at 8-country scale, but the exact
  // sequential-round-trip pattern that made indexFunds take 108s+ at ~10,700
  // NPPs (found and fixed earlier this session) — found while auditing
  // scalability toward a 30-50-country sim. Fixed by loading the shared,
  // globally-bounded data ONCE (FX rates, autonomy-per-country, all sectors,
  // all corps) instead of per-attacker.
  const fxByCurrency = await loadFxRatesByCurrency(db);

  // Market tier + world year, read once for the whole pass: under plants the
  // attack moves capacity and is priced against the build table (which is
  // era-indexed), so both are needed for every attack in this run.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const eraUnitScale = await loadWorldEraUnitScale(db);
  const gameStateDoc = await db
    .collection("gameState")
    .findOne({ _id: "current" } as Record<string, unknown>, { projection: { currentYear: 1 } });
  const worldYear = resolveWorldYear(
    (gameStateDoc as { currentYear?: number } | null)?.currentYear,
    currentTurn
  );

  const distinctCountries = [...new Set(nppCorps.map((c) => c.countryId))];
  const autonomyByCountry = new Map<string, boolean>();
  for (const countryId of distinctCountries) {
    autonomyByCountry.set(countryId, await nppAutonomyAtLeast(db, countryId, "v2"));
  }

  // Cheap in-memory filters first — only corps that pass ALL of them need
  // the expensive sector/defender lookups below.
  const eligibleAttackers = nppCorps.filter((attacker) => {
    if (!autonomyByCountry.get(attacker.countryId)) return false;
    const personality = personalityByNpp.get(attacker.ceoId?.toString() ?? "");
    if (!personality || deriveCeoArchetype(personality) !== "aggressive") return false;
    if (
      attacker.lastAutoAttackTurn != null &&
      currentTurn - attacker.lastAutoAttackTurn < ATTACK_COOLDOWN_TURNS
    ) {
      return false;
    }
    return true;
  });
  if (eligibleAttackers.length === 0) return 0;

  // All corporateSectors, once — grouped by owning corp (own-market lookup)
  // and by (stateId, sectorType) bucket (rival lookup), replacing the two
  // per-attacker queries above.
  // `buildQueue` and `plantsPnl` are ~45% of the collection and attack
  // targeting never reads either.
  const allSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({}, { projection: { buildQueue: 0, plantsPnl: 0, soldByCommodity: 0 } })
    .toArray();
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  const sectorsByMarket = new Map<string, CorporateSector[]>();
  for (const s of allSectors) {
    const corpKey = s.corporationId.toString();
    if (!sectorsByCorp.has(corpKey)) sectorsByCorp.set(corpKey, []);
    sectorsByCorp.get(corpKey)!.push(s);
    const marketKey = `${s.stateId}::${s.sectorType}`;
    if (!sectorsByMarket.has(marketKey)) sectorsByMarket.set(marketKey, []);
    sectorsByMarket.get(marketKey)!.push(s);
  }

  // All corporations, once — defenders may be player-owned (not in nppCorps).
  const allCorps = await db.collection<Corporation>("corporations").find({}).toArray();
  const corpById = new Map(allCorps.map((c) => [c._id.toString(), c]));

  let attacks = 0;
  // Forensics/alt-detection audit spine (plan §3.1, T2.7): one entry per
  // executed attack (a defender corp's revenue is captured with nobody
  // having acted — the same "silent state change" concern as the
  // auto-restructure path). Bounded by `eligibleAttackers`, flushed with
  // ONE `recordAuditBulk` call after the loop — never per-attack DB writes.
  const actionAuditEntries: ActionAuditInput[] = [];
  // Defenders already hit in this pass — the persisted `lastAutoAttackedTurn`
  // cooldown can't see strikes that happen within the same run.
  const struckDefendersThisPass = new Set<string>();
  for (const attacker of eligibleAttackers) {
    const personality = personalityByNpp.get(attacker.ceoId!.toString())!;

    // Markets the attacker operates in (its own sectors' state+type).
    const ownSectors = sectorsByCorp.get(attacker._id.toString()) ?? [];
    if (ownSectors.length === 0) continue;
    const markets = ownSectors.map((s) => ({ stateId: s.stateId, sectorType: s.sectorType }));

    // Rival sectors in those markets.
    const rivalSectors: CorporateSector[] = [];
    for (const m of markets) {
      const bucket = sectorsByMarket.get(`${m.stateId}::${m.sectorType}`) ?? [];
      for (const s of bucket) {
        if (!s.corporationId.equals(attacker._id)) rivalSectors.push(s);
      }
    }
    if (rivalSectors.length === 0) continue;

    // Resolve each rival's defender corp + revenue (₳) into candidates.
    const candidates: AttackCandidate[] = [];
    for (const sector of rivalSectors) {
      const defender = corpById.get(sector.corporationId.toString());
      if (!defender) continue;

      // Player-defender protection. A player-run corp is a legitimate target —
      // that principle is unchanged — but only on a shared cooldown, and never
      // twice in one pass. Being attacked is a threat to respond to; being
      // attacked from five directions before you can log in is just attrition.
      const defenderIsPlayerOwned = Boolean(defender.userId) && !defender.ceoVacant;
      if (struckDefendersThisPass.has(defender._id.toString())) continue;
      if (
        !canAttackDefender({
          defenderIsPlayerOwned,
          lastPlayerAttackedTurn: defender.lastAutoAttackedTurn,
          currentTurn,
        })
      ) {
        continue;
      }
      const fx = fxRateForCorpFromMap(defender, fxByCurrency);
      // Same basis the execution step uses, so selection, the MIN_TARGET
      // threshold and the affordability check all rank targets by what is
      // physically there to take rather than by last turn's market fill.
      const revenueAnchor =
        attackCapacityBasisAnchor(
          {
            sectorType: sector.sectorType as CorporationType,
            capitalStock: sector.capitalStock,
            strategyId: sector.strategyId,
          },
          plantsEnabled,
          eraUnitScale
        ) ?? readCorpEconomicAnchor(sector.revenue, resolveCorpLiquidCurrencyCode(defender), fx);
      candidates.push({ sector, defender, revenueAnchor });
    }

    const target = selectAttackTarget(attacker._id, attacker.marketingStrength ?? 0, candidates);
    if (!target) continue;

    // Affordability against the chosen target's actual cost.
    const attackerFx = fxRateForCorpFromMap(attacker, fxByCurrency);
    const capitalAnchor = corpLiquidCapitalToAnchor(attacker.liquidCapital, attacker, attackerFx);
    const attackCostAnchor = calculateAttackCostAnchor(target.revenueAnchor);
    const msCost = calculateSplitMsCost(attacker.splitEscalation ?? 0);
    if (
      !canAttack({
        personality,
        lastAutoAttackTurn: attacker.lastAutoAttackTurn,
        currentTurn,
        capitalAnchor,
        attackCostAnchor,
        marketingStrength: attacker.marketingStrength ?? 0,
        msCost,
      })
    ) {
      continue;
    }

    const result = await executeNppSectorAttack(db, {
      attacker,
      targetSector: target.sector,
      defender: target.defender,
      currentTurn,
      now,
      plantsEnabled,
      year: worldYear,
      capitalAnchor,
    });
    if (result) {
      attacks++;
      struckDefendersThisPass.add(target.defender._id.toString());
      console.log(
        `[nppAutonomy] ${attacker.name} attacked ${result.defenderName}'s ${result.sectorType} sector (captured ${result.capturedAnchor})`
      );
      actionAuditEntries.push({
        source: "turn",
        category: "corp",
        action: "npp.attack",
        phase: "nppCorporateAttacks",
        actor: { kind: "npp", name: attacker.name },
        subject: {
          type: "corporation",
          id: target.defender._id.toString(),
          name: result.defenderName,
        },
        counterparty: { type: "corporation", id: attacker._id.toString(), name: attacker.name },
        amount: result.capturedAnchor,
        outcome: "ok",
        turn: currentTurn,
        meta: { sectorType: result.sectorType },
      });
    }
  }

  if (actionAuditEntries.length > 0) {
    recordAuditBulk(actionAuditEntries);
  }

  return attacks;
}

/**
 * Turn-phase entry: fetch the db and run autonomous NPP corporate attacks. Thin
 * wrapper so the turn registry can call it like the other self-contained phases.
 */
export async function runNppCorporateAttacksPhase(now: Date, currentTurn: number): Promise<number> {
  const db = await getDb();
  return runNppCorporateAttacks(db, currentTurn, now);
}
