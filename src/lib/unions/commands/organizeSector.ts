/**
 * Union dues v1, targeted organizing drive / raid.
 *
 * The headline new union-head action: spend treasury and action points to push
 * one sector's `unionization` up. Same industry only, a union may only ever
 * touch a `CorporateSector` in its own `countryId` + `sectorType`.
 *
 *   - Sector unrepresented: a straight organizing push. The first drive
 *     claims `representingUnionId`, so the shop's workers start counting as
 *     members immediately. (A 50-point recognition bar with a 3-point drive
 *     was unwinnable against per-turn drift.)
 *   - Sector already represented by THIS union: reinforcement. Pushes
 *     unionization up further, no ownership change. Treasury cost scales with
 *     current unionization.
 *   - Sector represented by a RIVAL union: a raid. Winner takes all, the
 *     contest in {@link raidSucceeds} decides whether representation flips.
 *     A raid that fails still costs the treasury/action spend (charged before
 *     the contest is even resolved), so raiding is never free. Cost scales
 *     with shop size.
 *
 * No decay is applied here on purpose: `trendUnionization`
 * (`src/lib/labour/unionization.ts`, turn engine) walks the sector back toward
 * its approval-anchored drift target every turn on its own, which is what
 * makes a drive a temporary push rather than a permanent purchase.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, CorporateSector, Union } from "@/lib/db/types";
import { unionApproval } from "@/lib/unions/unionDues";
import { resolveOwnedUnion, rejectIfTurnProcessing, type UnionActionResult } from "./unionActions";
import {
  applyOrganizeSectorSpend,
  ORGANIZE_ACTIONS_CHANGED,
  ORGANIZE_SECTOR_CHANGED,
  ORGANIZE_TREASURY_CHANGED,
} from "@/lib/unions/organizeSectorSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import {
  ORGANIZE_SECTOR_ACTION_COST,
  RAID_APPROVAL_EDGE_REQUIRED,
  clamp0to100,
  organizeSectorTreasuryCost,
  sectorUnionizationGain,
} from "@/lib/unions/organizeSectorEconomy";

export {
  ORGANIZE_SECTOR_ACTION_COST,
  ORGANIZE_SECTOR_TREASURY_COST,
  RAID_APPROVAL_EDGE_REQUIRED,
  SECTOR_UNIONIZATION_GAIN_BASE,
  organizeSectorTreasuryCost,
  sectorUnionizationGain,
} from "@/lib/unions/organizeSectorEconomy";

export interface RaidContestInputs {
  /** Approval (0-100) of the union running the drive. */
  attackerApproval: number;
  /** Approval (0-100) of the union currently representing the sector. */
  incumbentApproval: number;
}

/**
 * Pure raid contest. Winner takes all, gated purely on the two unions'
 * approval: the attacker must out-poll the incumbent by at least
 * {@link RAID_APPROVAL_EDGE_REQUIRED} points. No randomness, a raid's outcome
 * is fully determined by how each side is actually running its union, which is
 * the whole point of connecting approval to representation risk.
 */
export function raidSucceeds(inputs: RaidContestInputs): boolean {
  const attacker = clamp0to100(inputs.attackerApproval);
  const incumbent = clamp0to100(inputs.incumbentApproval);
  return attacker - incumbent >= RAID_APPROVAL_EDGE_REQUIRED;
}

export interface OrganizeSectorContestInputs {
  /** The sector's `unionization` before this drive. */
  currentUnionization: number | undefined;
  /** Stringified `CorporateSector.representingUnionId`, or null when unrepresented. */
  currentRepresentingUnionId: string | null;
  /** Stringified id of the union running the drive. */
  attackerUnionId: string;
  attackerApproval: number;
  /**
   * Approval of the union recorded in `currentRepresentingUnionId`, or null
   * when the sector is unrepresented OR that union no longer exists (a
   * dangling reference, treated the same as unrepresented so the pointer
   * gets cleaned up rather than left dead).
   */
  incumbentApproval: number | null;
}

export interface OrganizeSectorOutcome {
  /** False only for a raid that lost its contest, the sector is untouched. */
  applied: boolean;
  newUnionization: number;
  newRepresentingUnionId: string | null;
  /** True when this action put (or kept) the attacker as the representing union. */
  won: boolean;
  /** True when a different union held the sector going in, a contested raid, whether won or lost. */
  wasRaid: boolean;
}

/**
 * Resolve one organizing drive against one sector. Pure, no DB, no clamping
 * surprises: every path clamps the resulting unionization to [0, 100].
 */
export function resolveOrganizeSectorDrive(
  inputs: OrganizeSectorContestInputs
): OrganizeSectorOutcome {
  const current = clamp0to100(inputs.currentUnionization);
  const isOwnSector = inputs.currentRepresentingUnionId === inputs.attackerUnionId;
  const isRival = inputs.currentRepresentingUnionId != null && !isOwnSector;

  if (isRival && inputs.incumbentApproval != null) {
    const won = raidSucceeds({
      attackerApproval: inputs.attackerApproval,
      incumbentApproval: inputs.incumbentApproval,
    });
    if (!won) {
      // A failed raid leaves the sector exactly as it was, the cost already
      // charged by the caller is the whole penalty.
      return {
        applied: false,
        newUnionization: current,
        newRepresentingUnionId: inputs.currentRepresentingUnionId,
        won: false,
        wasRaid: true,
      };
    }
    return {
      applied: true,
      newUnionization: Math.min(100, current + sectorUnionizationGain(inputs.attackerApproval)),
      newRepresentingUnionId: inputs.attackerUnionId,
      won: true,
      wasRaid: true,
    };
  }

  // Unrepresented, this union's own shop, or a dangling incumbent reference
  // (no live rival to contest against): a straight organizing push. The first
  // successful drive claims the shop so its workers count as members now,
  // rather than waiting on a recognition bar the per-turn drift would wipe.
  const boosted = Math.min(100, current + sectorUnionizationGain(inputs.attackerApproval));
  return {
    applied: true,
    newUnionization: boosted,
    newRepresentingUnionId: inputs.attackerUnionId,
    won: true,
    wasRaid: false,
  };
}

export type OrganizeSectorResult = UnionActionResult;

/**
 * Run a targeted organizing drive. Union head only. Charges treasury + action
 * points up front (before the contest is resolved) so a failed raid still
 * costs the attacker, see the module doc.
 */
export async function organizeSector(
  db: Db,
  character: Character,
  unionId: string,
  sectorId: string,
  options?: { idempotencyKey?: string }
): Promise<OrganizeSectorResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  const { union } = resolved;

  if (!ObjectId.isValid(sectorId)) {
    return { ok: false, status: 400, error: "Invalid sector ID" };
  }
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ _id: new ObjectId(sectorId) });
  if (!sector) {
    return { ok: false, status: 404, error: "Sector not found" };
  }
  if (sector.countryId !== union.countryId || sector.sectorType !== union.sectorType) {
    return {
      ok: false,
      status: 400,
      error: "This union can only organize sectors in its own country and industry.",
    };
  }

  const attackerId = union._id.toString();
  const currentRepresentingUnionId = sector.representingUnionId
    ? sector.representingUnionId.toString()
    : null;
  const treasuryCost = organizeSectorTreasuryCost({
    workers: sector.workers,
    unionization: sector.unionization,
    isOwnSector: currentRepresentingUnionId === attackerId,
  });

  const availableActions = character.actions ?? 0;
  if (availableActions < ORGANIZE_SECTOR_ACTION_COST) {
    return {
      ok: false,
      status: 400,
      error: `An organizing drive costs ${ORGANIZE_SECTOR_ACTION_COST} action points (you have ${availableActions}).`,
    };
  }
  if (union.treasury < treasuryCost) {
    return {
      ok: false,
      status: 402,
      error: "Not enough union treasury to run an organizing drive.",
    };
  }

  let incumbentApproval: number | null = null;
  if (currentRepresentingUnionId && currentRepresentingUnionId !== attackerId) {
    const incumbentUnion = await db
      .collection<Union>("unions")
      .findOne({ _id: sector.representingUnionId! }, { projection: { approval: 1 } });
    incumbentApproval = incumbentUnion ? unionApproval(incumbentUnion) : null;
  }

  const outcome = resolveOrganizeSectorDrive({
    currentUnionization: sector.unionization,
    currentRepresentingUnionId,
    attackerUnionId: attackerId,
    attackerApproval: unionApproval(union),
    incumbentApproval,
  });

  const now = new Date();

  const newRepresentingObjectId = outcome.newRepresentingUnionId
    ? new ObjectId(outcome.newRepresentingUnionId)
    : null;
  // Crash-safe spend (issue #1672): the action-points debit and the treasury
  // debit are keyed idempotent legs and the sector transition a keyed update
  // guarded on the pre-drive snapshot, so a crash between the sequential
  // writes reconciles to exactly one charged drive instead of charging for a
  // push that never landed (or landing it twice). A later failure compensates
  // the applied prefix in reverse, the historical spend-then-refund-on-
  // failure made crash-safe. `Idempotency-Key` replays the stored outcome
  // without charging again. A raid that lost its contest charges the debits
  // and leaves the sector untouched.
  try {
    await applyOrganizeSectorSpend(db, {
      characterId: character._id,
      unionId: union._id,
      sectorId: sector._id,
      actionCost: ORGANIZE_SECTOR_ACTION_COST,
      treasuryCost,
      priorUnionization: sector.unionization,
      priorRepresentingUnionId: sector.representingUnionId,
      nextUnionization: outcome.newUnionization,
      nextRepresentingUnionId: newRepresentingObjectId,
      now,
      applySector: outcome.applied,
      fingerprint: `organize-sector:${union._id.toHexString()}:${sector._id.toHexString()}`,
      ...(options?.idempotencyKey !== undefined
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith(ORGANIZE_ACTIONS_CHANGED)) {
      return {
        ok: false,
        status: 409,
        error: "Your available actions changed. Please try again.",
      };
    }
    if (message.startsWith(ORGANIZE_TREASURY_CHANGED)) {
      return {
        ok: false,
        status: 409,
        error: "Union treasury changed, please retry.",
      };
    }
    if (message.startsWith(ORGANIZE_SECTOR_CHANGED)) {
      return { ok: false, status: 409, error: "Sector state changed, please retry." };
    }
    if (error instanceof MoneyFlowKeyConflictError) {
      return {
        ok: false,
        status: 409,
        error: "This drive key was already used for a different drive.",
      };
    }
    if (error instanceof MoneyFlowTerminalError) {
      return {
        ok: false,
        status: 409,
        error: "This drive already settled; retry without the idempotency key.",
      };
    }
    throw error;
  }

  // A raid that lost its contest: the spend above is the entire penalty, the
  // sector is left exactly as it was.
  if (!outcome.applied) {
    return {
      ok: true,
      status: 200,
      wasRaid: true,
      won: false,
      unionization: clamp0to100(sector.unionization),
      representingUnionId: currentRepresentingUnionId,
      cashSpent: treasuryCost,
      actionsSpent: ORGANIZE_SECTOR_ACTION_COST,
    };
  }

  return {
    ok: true,
    status: 200,
    wasRaid: outcome.wasRaid,
    won: outcome.won,
    unionization: outcome.newUnionization,
    representingUnionId: outcome.newRepresentingUnionId,
    cashSpent: treasuryCost,
    actionsSpent: ORGANIZE_SECTOR_ACTION_COST,
  };
}
