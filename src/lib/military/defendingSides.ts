import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { BlocLookup } from "./bloc";
import type { CombatUnit } from "./combat";
import { defendersAtFront } from "./coalition";
import type { Side } from "./occupation";

/**
 * Who is defending, and is anyone home?
 *
 * The ONE place that answers "is this offensive opposed", used by both the live
 * resolver and the forecast. They already carried the same `length === 0` test
 * against the same roster, and the forecast's own comment states the invariant a
 * second copy would break: a forecast can never disagree with the outcome it predicts.
 *
 * `defenderCountries` are the real belligerents whose `militaryUnits` fight and take
 * casualties. `factionDefends` is set when a proxy war's faction holds this side: it
 * owns no unit rows, so it would read as nobody home and hand the attacker a walkover
 * — the caller mints its token force instead.
 */
export interface DefendingSides {
  defenderCountries: string[];
  /** The side a faction is defending here, if one is. */
  factionDefends: Side | null;
  /** True when nothing at all opposes the offensive — a real walkover. */
  unopposed: boolean;
}

export function resolveDefendingSides(params: {
  conflict: Pick<ConflictDoc, "sideA" | "sideB">;
  atFront: CombatUnit[];
  theaterId: string;
  /** The side being attacked, or null when the matchup could not be placed. */
  enemySide: Side | null;
  blocs: BlocLookup;
  /** Fallback for an unplaced matchup: the named target, if it has anything here. */
  namedTarget?: string;
  unitsByCountry?: Map<string, unknown[]>;
}): DefendingSides {
  const { conflict, atFront, theaterId, enemySide, blocs, namedTarget, unitsByCountry } = params;

  const defenderCountries = enemySide
    ? defendersAtFront(conflict as ConflictDoc, atFront, theaterId, enemySide, blocs)
    : namedTarget && unitsByCountry?.get(namedTarget)?.length
      ? [namedTarget]
      : [];

  // A faction defends only the side it IS, only when the attack lands on that side,
  // and only while it still HAS a force.
  //
  // ⚠️ The strength check is the load-bearing part. `buildFactionSide` fields nothing
  // once `tokenStrength` reaches zero, so without it a spent faction still reported
  // `unopposed: false` — the walkover branch was skipped, no units were added, and
  // `resolvePvpBattle` was handed an empty defending side. The front would then stop
  // moving for good: a faction ground to nothing would become the immortal wall the
  // token force exists to remove, which is the exact opposite of the intent.
  const sideDoc = enemySide === "A" ? conflict.sideA : enemySide === "B" ? conflict.sideB : null;
  const factionHasForce = (sideDoc?.tokenStrength ?? 0) > 0;
  const factionDefends = enemySide && sideDoc?.factionEntity && factionHasForce ? enemySide : null;

  return {
    defenderCountries,
    factionDefends,
    unopposed: defenderCountries.length === 0 && factionDefends === null,
  };
}
