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

  // Scale each institution's personal tier so its rows sum to the cap, and take
  // the movement from the SUM OF THE STAMPS rather than from the cap itself —
  // the stamps are what each character is told they bought, so they are the
  // side that has to be true.
  //
  // Apportioned by LARGEST REMAINDER, not by rounding each row on its own.
  // Independent rounding loses the whole cap once the tier is crowded: every
  // row's share falls below half a hundredth, each rounds to zero, and a
  // thousand characters move the board by nothing at all. The cap is a ceiling
  // on the public's influence, never a way to delete it. Largest remainder
  // makes the stamps sum to EXACTLY the cap however many rows share it — the
  // cost is that a share too small to round up stamps as zero, which is honest:
  // at that turnout one more signature genuinely did not buy a hundredth.
  for (const [institutionId, raw] of personalRaw) {
    const rows = personalPending.filter((r) => r.play.targetInstitutionId === institutionId);
    const magnitude = Math.abs(raw);
    if (magnitude <= PERSONAL_NET_CAP) {
      for (const { play, requested } of rows) {
        stamped.push({ id: play._id, appliedPoints: requested });
        addTo(personalApplied, institutionId, requested);
      }
      continue;
    }

    const target = Math.sign(raw) * PERSONAL_NET_CAP;
    // Truncate toward zero so no row is ever stamped past what it asked for,
    // then hand the shortfall to the rows with the largest lost fractions.
    const shares = rows.map((row) => {
      const exact = (row.requested * PERSONAL_NET_CAP) / magnitude;
      const base = Math.trunc(exact);
      return { row, base, remainder: exact - base };
    });
    let shortfall = target - shares.reduce((sum, sh) => sum + sh.base, 0);
    const step = Math.sign(shortfall);
    // Ascending remainder for a negative shortfall: the rows that kept the most
    // by truncating toward zero are the ones that should give a hundredth back.
    const queue = [...shares].sort((a, b) =>
      step > 0 ? b.remainder - a.remainder : a.remainder - b.remainder
    );
    for (const share of queue) {
      if (shortfall === 0) break;
      share.base += step;
      shortfall -= step;
    }

    for (const { row, base } of shares) {
      stamped.push({ id: row.play._id, appliedPoints: base });
      addTo(personalApplied, institutionId, base);
    }
  }

  for (const [institutionId, applied] of personalApplied) {
    addTo(perInstitution, institutionId, applied);
  }

  return { perInstitution, settlementDelta, stamped, personalRaw, personalApplied, heatAdded };
}
