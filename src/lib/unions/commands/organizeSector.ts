/**
 * Union dues v1, targeted organizing drive / raid.
 *
 * The headline new union-head action: spend treasury and action points to push
 * one sector's `unionization` up. Same industry only, a union may only ever
 * touch a `CorporateSector` in its own `countryId` + `sectorType`.
 *
 *   - Sector unrepresented: a straight organizing push. Crossing
 *     {@link SECTOR_RECOGNITION_THRESHOLD} sets `representingUnionId` to this
 *     union.
 *   - Sector already represented by THIS union: reinforcement. Pushes
 *     unionization up further, no ownership change.
 *   - Sector represented by a RIVAL union: a raid. Winner takes all, the
 *     contest in {@link raidSucceeds} decides whether representation flips.
 *     A raid that fails still costs the treasury/action spend (charged before
 *     the contest is even resolved), so raiding is never free.
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

/** Action points a union head spends to run one targeted drive. 3x the rank-and-file `ORGANIZE_ACTION_COST` (5), this is a leader action that moves a specific sector, not a contribution to the general strength pool. */
export const ORGANIZE_SECTOR_ACTION_COST = 15;

/** Treasury cost of one targeted drive. A drive aimed at a specific sector, potentially a rival shop, is a real commitment rather than a routine push. */
export const ORGANIZE_SECTOR_TREASURY_COST = 1000;

/** Unionization points one drive adds to the targeted sector, before clamping to [0, 100]. Three drives from zero clears the recognition threshold below. */
export const SECTOR_UNIONIZATION_GAIN_PER_DRIVE = 20;

/** Unionization a previously-unrepresented sector must clear before a drive wins it recognition outright. */
export const SECTOR_RECOGNITION_THRESHOLD = 50;

/**
 * Approval-point edge the attacking union needs over the incumbent to win a
 * raid. A tie or worse goes to the incumbent: a union its own members rate at
 * least as well as the challenger's cannot be muscled out of a shop by money
 * and action points alone. Deliberately small (not a landslide requirement),
 * raiding a mismanaged incumbent should be realistically winnable.
 */
export const RAID_APPROVAL_EDGE_REQUIRED = 5;

function clamp0to100(value: number | undefined): number {
  return Math.max(
    0,
    Math.min(100, typeof value === "number" && Number.isFinite(value) ? value : 0)
  );
}

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
      newUnionization: Math.min(100, current + SECTOR_UNIONIZATION_GAIN_PER_DRIVE),
      newRepresentingUnionId: inputs.attackerUnionId,
      won: true,
      wasRaid: true,
    };
  }

  // Unrepresented, this union's own shop, or a dangling incumbent reference
  // (no live rival to contest against): a straight organizing push.
  const boosted = Math.min(100, current + SECTOR_UNIONIZATION_GAIN_PER_DRIVE);
  const newRepresentingUnionId = isOwnSector
    ? inputs.attackerUnionId
    : boosted >= SECTOR_RECOGNITION_THRESHOLD
      ? inputs.attackerUnionId
      : null; // Not yet recognized, also how a dangling rival pointer gets cleaned to null instead of staying dead.
  return {
    applied: true,
    newUnionization: boosted,
    newRepresentingUnionId,
    // True whenever the attacker ends up representing the sector, whether
    // that's freshly won recognition or simply still holding its own shop.
    won: newRepresentingUnionId === inputs.attackerUnionId,
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
  sectorId: string
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

  const availableActions = character.actions ?? 0;
  if (availableActions < ORGANIZE_SECTOR_ACTION_COST) {
    return {
      ok: false,
      status: 400,
      error: `An organizing drive costs ${ORGANIZE_SECTOR_ACTION_COST} action points (you have ${availableActions}).`,
    };
  }
  if (union.treasury < ORGANIZE_SECTOR_TREASURY_COST) {
    return {
      ok: false,
      status: 402,
      error: "Not enough union treasury to run an organizing drive.",
    };
  }

  const attackerId = union._id.toString();
  const currentRepresentingUnionId = sector.representingUnionId
    ? sector.representingUnionId.toString()
    : null;

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

  // Charge action points first (mirrors organizeUnion's spend-then-refund-on-
  // failure order).
  const actionSpend = await db
    .collection<Character>("characters")
    .updateOne(
      { _id: character._id, actions: { $gte: ORGANIZE_SECTOR_ACTION_COST } },
      { $inc: { actions: -ORGANIZE_SECTOR_ACTION_COST }, $set: { updatedAt: now } }
    );
  if (actionSpend.modifiedCount === 0) {
    return {
      ok: false,
      status: 409,
      error: "Your available actions changed. Please try again.",
    };
  }

  const treasurySpend = await db
    .collection<Union>("unions")
    .updateOne(
      { _id: union._id, treasury: { $gte: ORGANIZE_SECTOR_TREASURY_COST } },
      { $inc: { treasury: -ORGANIZE_SECTOR_TREASURY_COST }, $set: { updatedAt: now } }
    );
  if (treasurySpend.modifiedCount === 0) {
    await db
      .collection<Character>("characters")
      .updateOne({ _id: character._id }, { $inc: { actions: ORGANIZE_SECTOR_ACTION_COST } });
    return {
      ok: false,
      status: 409,
      error: "Union treasury changed, please retry.",
    };
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
      cashSpent: ORGANIZE_SECTOR_TREASURY_COST,
      actionsSpent: ORGANIZE_SECTOR_ACTION_COST,
    };
  }

  const newRepresentingObjectId = outcome.newRepresentingUnionId
    ? new ObjectId(outcome.newRepresentingUnionId)
    : null;
  const sectorUpdate = await db.collection<CorporateSector>("corporateSectors").updateOne(
    {
      _id: sector._id,
      unionization: sector.unionization,
      representingUnionId: sector.representingUnionId,
    },
    {
      $set: {
        unionization: outcome.newUnionization,
        representingUnionId: newRepresentingObjectId,
        updatedAt: now,
      },
    }
  );
  if (sectorUpdate.modifiedCount === 0) {
    // Sector changed between our read and write, refund both spends rather
    // than silently apply the drive against stale data.
    await db
      .collection<Character>("characters")
      .updateOne({ _id: character._id }, { $inc: { actions: ORGANIZE_SECTOR_ACTION_COST } });
    await db
      .collection<Union>("unions")
      .updateOne({ _id: union._id }, { $inc: { treasury: ORGANIZE_SECTOR_TREASURY_COST } });
    return { ok: false, status: 409, error: "Sector state changed, please retry." };
  }

  return {
    ok: true,
    status: 200,
    wasRaid: outcome.wasRaid,
    won: outcome.won,
    unionization: outcome.newUnionization,
    representingUnionId: outcome.newRepresentingUnionId,
    cashSpent: ORGANIZE_SECTOR_TREASURY_COST,
    actionsSpent: ORGANIZE_SECTOR_ACTION_COST,
  };
}
