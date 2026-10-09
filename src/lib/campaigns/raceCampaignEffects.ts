import type { Db } from "mongodb";
import type { Campaign } from "@/lib/db/types";
import { getGroundGameGotvBonus, getGroundGameSwingBonus } from "./opsEffects";
import {
  buildFieldOfficeMultiplier,
  loadFieldOfficesByElection,
  loadFieldOfficesForElection,
  type FieldOfficesByElection,
} from "./fieldOffices/engine";

/**
 * Campaign vote effects for the generic (non-presidential) tally engine.
 *
 * The presidential engine has applied Ground Game since Strategic Operations
 * v2. Every other race ignored it, so a Senate or Commons campaign paid for
 * canvassers that moved nothing. This is the one hook that engine calls: it
 * folds the Ground Game swing/GOTV bonus and the race's field offices into a
 * single per-candidate multiplier for the race's region.
 *
 * Per-turn loads are memoised by the caller (`VoteTurnMemo`), so a turn with
 * hundreds of races still costs two queries.
 */

export interface GroundGameBonus {
  swing: number;
  gotv: number;
}
export type GroundGameByElection = Map<string, Map<string, GroundGameBonus>>;

export interface RaceCampaignEffectsMemo {
  fieldOfficesByElection?: Promise<FieldOfficesByElection>;
  groundGameByElection?: Promise<GroundGameByElection>;
}

export async function loadGroundGameByElection(
  db: Db,
  electionId?: { toString(): string }
): Promise<GroundGameByElection> {
  const filter: Record<string, unknown> = {
    status: { $ne: "archived" },
    $or: [{ "groundGameTree.starter": true }, { groundGameLevel: { $gt: 0 } }],
  };
  if (electionId) filter.electionId = electionId;
  const rows = await db
    .collection<Campaign>("campaigns")
    .find(filter, {
      projection: { electionId: 1, candidateId: 1, groundGameTree: 1, groundGameLevel: 1 },
    })
    .toArray();
  const out: GroundGameByElection = new Map();
  for (const c of rows) {
    const bonus = {
      swing: getGroundGameSwingBonus(c.groundGameTree, c.groundGameLevel ?? 0),
      gotv: getGroundGameGotvBonus(c.groundGameTree),
    };
    if (bonus.swing === 0 && bonus.gotv === 0) continue;
    const key = c.electionId.toString();
    let inner = out.get(key);
    if (!inner) out.set(key, (inner = new Map()));
    inner.set(c.candidateId.toString(), bonus);
  }
  return out;
}

/**
 * Resolve the per-candidate multiplier for one race in one region. Returns
 * null when no campaign in the race has anything that moves votes.
 */
export async function loadRaceCampaignMultiplier(
  db: Db,
  args: {
    electionId: { toString(): string };
    countryId: string;
    regionId: string;
    currentTurn: number;
    isSwingRegion: boolean;
    memo?: RaceCampaignEffectsMemo;
  }
): Promise<((candidateKey: string) => number) | null> {
  const { memo } = args;
  const electionKey = args.electionId.toString();
  const [groundGame, offices] = await Promise.all([
    memo
      ? (memo.groundGameByElection ??= loadGroundGameByElection(db)).then((m) => m.get(electionKey))
      : loadGroundGameByElection(db, args.electionId).then((m) => m.get(electionKey)),
    memo
      ? (memo.fieldOfficesByElection ??= loadFieldOfficesByElection(db)).then((m) =>
          m.get(electionKey)
        )
      : loadFieldOfficesForElection(db, args.electionId),
  ]);
  const officeMult = buildFieldOfficeMultiplier(offices, args.countryId, args.currentTurn);
  if (!groundGame && !officeMult) return null;
  return (candidateKey) => {
    const gg = groundGame?.get(candidateKey);
    const ggMult = gg ? 1 + (args.isSwingRegion ? gg.swing : 0) + gg.gotv : 1;
    return ggMult * (officeMult ? officeMult(candidateKey, args.regionId) : 1);
  };
}
