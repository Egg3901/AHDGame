/**
 * Turning a tick's queued plays into per-institution movement.
 *
 * The personal tier is capped SEPARATELY and on its NET. Every character in the
 * world holds a personal play, so an uncapped personal tier at 0.25x outweighs
 * every national seat combined by two orders of magnitude. Capping the net
 * rather than the gross is what lets a contested public cancel itself out —
 * which is the interesting outcome — instead of both sides being throttled into
 * a stalemate they did not choose.
 */
import type { ObjectId } from "mongodb";
import type { SettlementPlayDoc } from "@/lib/db/types/settlementPlay";
import {
  PERSONAL_MULTIPLIER_PCT,
  PERSONAL_NET_CAP,
  getSeat,
} from "@/lib/constants/settlementCrisis";

export interface ResolvedBatch {
  /** Institution id → signed hundredths, personal tier already capped. */
  perInstitution: Map<string, number>;
  /** Signed hundredths applied equally to every institution. */
  settlementDelta: number;
  stamped: { id: ObjectId; appliedPoints: number }[];
  /** Personal totals before the cap, for the wire's disclosure line. */
  personalRaw: Map<string, number>;
  /** Personal totals after the cap. */
  personalApplied: Map<string, number>;
  heatAdded: number;
}

/**
 * Signed hundredths one play contributes.
 *
 * An unrecognised seat contributes NOTHING rather than falling back to 1.0x —
 * a silent default here would let a malformed row move the index.
 */
export function appliedPointsFor(play: SettlementPlayDoc): number {
  const multiplierPct =
    play.actor === "personal" ? PERSONAL_MULTIPLIER_PCT : getSeat(play.seatId ?? "")?.multiplierPct;
  if (multiplierPct == null) return 0;
  return Math.round((play.basePoints * multiplierPct) / 100) * play.direction;
}

function addTo(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

export function resolvePlayBatch(plays: readonly SettlementPlayDoc[]): ResolvedBatch {
  const perInstitution = new Map<string, number>();
  const personalRaw = new Map<string, number>();
  const personalApplied = new Map<string, number>();
  const stamped: { id: ObjectId; appliedPoints: number }[] = [];
  let settlementDelta = 0;
  let heatAdded = 0;

  // Personal plays are held back from `stamped` until the cap is known, so each
  // row can be stamped with what it ACTUALLY bought rather than what it asked
  // for. Clamping the institution total while stamping rows at full value would
  // make every row lie by the cap ratio — 200 capped plays would each claim +50
  // against an institution that moved 6 in total.
  const personalPending: { play: SettlementPlayDoc; requested: number }[] = [];

  for (const play of plays) {
    const applied = appliedPointsFor(play);
    heatAdded += play.heatAdded;

    if (play.targetInstitutionId == null) {
      stamped.push({ id: play._id, appliedPoints: applied });
      settlementDelta += applied;
      continue;
    }
    if (play.actor === "personal") {
      personalPending.push({ play, requested: applied });
      addTo(personalRaw, play.targetInstitutionId, applied);
      continue;
    }
    stamped.push({ id: play._id, appliedPoints: applied });
    addTo(perInstitution, play.targetInstitutionId, applied);
  }

  // Scale each institution's personal tier so its rows sum to the cap, then take
  // the movement from the SUM OF THE STAMPS rather than from the cap itself.
  // Rounding means the two differ by a hundredth or two, and the stamps are the
  // side that has to be true.
  for (const { play, requested } of personalPending) {
    const institutionId = play.targetInstitutionId as string;
    const raw = personalRaw.get(institutionId) ?? 0;
    const magnitude = Math.abs(raw);
    const scaled =
      magnitude > PERSONAL_NET_CAP
        ? Math.round((requested * PERSONAL_NET_CAP) / magnitude)
        : requested;
    stamped.push({ id: play._id, appliedPoints: scaled });
    addTo(personalApplied, institutionId, scaled);
  }

  for (const [institutionId, applied] of personalApplied) {
    addTo(perInstitution, institutionId, applied);
  }

  return { perInstitution, settlementDelta, stamped, personalRaw, personalApplied, heatAdded };
}
