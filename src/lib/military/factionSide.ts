import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { BattleSide } from "./battle";
import type { CombatUnit, Front } from "./combat";
import type { Side } from "./occupation";

/**
 * How much `tokenStrength` one synthetic formation represents.
 *
 * A faction's whole army is a single number on the conflict, so this is the dial that
 * turns it into a force with shape. 20 gives the default 40-strength faction two
 * formations — enough that the battle math has something to grind down, few enough
 * that a token force never reads as a superpower's order of battle.
 */
const STRENGTH_PER_FORMATION = 20;

/** Default composition when the conflict names no `enemyMix` of its own. */
const DEFAULT_MIX = ["infantry", "mech"];

/** `enemyMix` keys → the real unit archetypes the combat tables know. */
const MIX_TO_TYPE: Record<
  string,
  { type: string; icon: string; personnel: number; power: number }
> = {
  infantry: { type: "Infantry Division", icon: "soldier", personnel: 12000, power: 48 },
  mech: { type: "Mechanized Brigade", icon: "tank", personnel: 4500, power: 61 },
  armor: { type: "Armored Division", icon: "tank", personnel: 15000, power: 92 },
  arty: { type: "Artillery Regiment", icon: "artillery", personnel: 3000, power: 44 },
};

/**
 * The token force a faction defends its own country with.
 *
 * A proxy war's sides are factions, not member countries, so they own no
 * `militaryUnits` rows — and a defending side with no units is a WALKOVER: the
 * offensive rolls forward unopposed, every turn, and the host is conquered by the
 * first bloc that bothers to declare. This mints the defence in memory so the live
 * `resolvePvpBattle` path has something to fight.
 *
 * Deterministic by construction — no RNG. The same conflict and the same
 * `tokenStrength` always produce the same force, so a battle is reproducible and a
 * forecast cannot disagree with the outcome it predicts.
 *
 * Nothing here is ever persisted: see `battleResolution`'s `persistSide` skip. The
 * faction has no country row to write casualties back to, and its losses are taken
 * off `tokenStrength` on the conflict instead.
 */
export function buildFactionSide(
  conflict: Pick<ConflictDoc, "_id" | "sideA" | "sideB" | "enemyMix">,
  side: Side,
  front: Front
): BattleSide {
  const sideDoc = side === "A" ? conflict.sideA : conflict.sideB;
  const country = sideDoc.factionEntity ?? `${conflict._id}:${side}`;
  const strength = Math.max(0, sideDoc.tokenStrength ?? 0);
  const mix = conflict.enemyMix?.length ? conflict.enemyMix : DEFAULT_MIX;

  // At least one formation while any strength remains: a faction with 5 left is a
  // beaten army, not an absent one, and rounding it to zero would hand the attacker
  // the walkover this whole function exists to prevent.
  const count = strength > 0 ? Math.max(1, Math.round(strength / STRENGTH_PER_FORMATION)) : 0;
  // The force's total power tracks its strength, so grinding a faction down actually
  // weakens it rather than only shortening its roster.
  const powerScale = count > 0 ? strength / (count * STRENGTH_PER_FORMATION) : 0;

  const units: CombatUnit[] = [];
  for (let i = 0; i < count; i++) {
    const arche = MIX_TO_TYPE[mix[i % mix.length]!] ?? MIX_TO_TYPE.infantry!;
    units.push({
      // Synthetic ids, never ObjectIds — nothing looks these up.
      _id: `faction_${country}_${i}` as unknown as CombatUnit["_id"],
      countryId: country,
      branchId: "army",
      domain: "ground",
      name: `${sideDoc.label} ${arche.type}`,
      type: arche.type,
      icon: arche.icon,
      basePower: Math.max(1, Math.round(arche.power * powerScale)),
      personnel: Math.max(1, Math.round(arche.personnel * powerScale)),
      upkeepBase: 0,
      posture: "standard",
      techTier: 1,
      vet: 1,
      xp: 0,
      readiness: 70,
      equipment: { firepower: 0, protection: 0, support: 0 },
      drill: null,
      theaterId: front.id,
      assignedGeneralId: null,
      createdTurn: 0,
    } as unknown as CombatUnit);
  }

  return {
    country,
    side,
    units,
    // A faction fields no generals and holds no doctrine: it is a defending army, not
    // a player's command. Neutral everything so the battle math reads it plainly.
    assignments: [],
    generalsById: {},
    positions: {},
    natMods: {
      cvAll: 1,
      cvDom: {},
      cvTrait: {},
      upkeep: 1,
      supply: 0,
      xp: 1,
      ready: 0,
      deep: 0,
      joint: 1,
    },
    countryScale: 1,
    fronts: { [front.id]: front },
  };
}
