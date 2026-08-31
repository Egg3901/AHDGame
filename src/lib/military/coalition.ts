import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { BattleDeclarationDoc } from "@/lib/db/types/battleDeclaration";
import { sideOf, type Side } from "@/lib/military/occupation";
import type { BlocLookup } from "@/lib/military/bloc";

/**
 * Who fights in a coalition battle.
 *
 * Pure on purpose: selection is the part with the interesting rules, and keeping it
 * free of the database lets every rule be tested directly instead of through a
 * mocked resolver.
 *
 * Spec: docs/superpowers/specs/2026-08-04-allied-coalition-battles-design.md
 */

/** One merged offensive: every ally attacking the same enemy side at one front. */
export interface Offensive {
  theaterId: string;
  /**
   * The attacking side, or null when the matchup cannot be resolved to opposing
   * sides. A null-sided offensive still fights — that is long-standing behaviour —
   * but moves no ground and enrols nobody, because there is no side to move it for.
   */
  side: Side | null;
  /** The side being attacked, or null alongside `side`. */
  enemySide: Side | null;
  /**
   * Countries whose units join the attack. The principal leads, the rest follow in
   * alphabetical order — pending declarations arrive in database order, so without
   * this the roster (and the report it is written into) would vary between ticks.
   */
  attackers: CountryId[];
  /** Deterministic representative — earliest declaredTurn, then _id. */
  principal: BattleDeclarationDoc;
  /** Every declaration folded in, so all of them can be marked resolved. */
  declarations: BattleDeclarationDoc[];
}

const other = (s: Side): Side => (s === "A" ? "B" : "A");

/** True when `d` should replace `current` as the group's principal. */
function outranks(d: BattleDeclarationDoc, current: BattleDeclarationDoc): boolean {
  if (d.declaredTurn !== current.declaredTurn) return d.declaredTurn < current.declaredTurn;
  return String(d._id) < String(current._id);
}

/**
 * Group eligible declarations into coalition offensives.
 *
 * The merge key is (front, attacking side) — NOT the named target. Two allies naming
 * different enemies on the same side are one attack, because the front and the
 * defending coalition are the same.
 *
 * A declarer that resolves to no side is NOT dropped — it fights the bilateral battle
 * it always did — but it never merges with anyone, because folding it into an allied
 * attack would let an unplaceable country move ground by proxy.
 */
export function mergeOffensives(
  conflict: ConflictDoc,
  pending: BattleDeclarationDoc[],
  currentTurn: number,
  blocs: BlocLookup
): Offensive[] {
  const groups = new Map<string, Offensive>();

  for (const d of pending) {
    // Defender window: an offensive declared this turn resolves on the next one.
    if (d.declaredTurn >= currentTurn) continue;

    const side = sideOf(conflict, d.declarerCountry, blocs);
    const target = sideOf(conflict, d.targetCountry, blocs);
    // Same side means no battle at all: an ally cannot attack an ally here.
    if (side && target && side === target) continue;

    // Unresolvable matchups never merge — there is no side to merge them on — so
    // each keeps its own group and fights the bilateral battle it always did.
    const resolvable = !!side && !!target;
    const key = resolvable ? `${d.theaterId}::${side}` : `${d.theaterId}::unresolved::${d._id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        theaterId: d.theaterId,
        side: resolvable ? side : null,
        enemySide: resolvable && side ? other(side) : null,
        attackers: [d.declarerCountry],
        principal: d,
        declarations: [d],
      });
      continue;
    }

    if (!existing.attackers.includes(d.declarerCountry)) {
      existing.attackers.push(d.declarerCountry);
    }
    existing.declarations.push(d);
    if (outranks(d, existing.principal)) existing.principal = d;
  }

  // Order the roster only once every declaration has been folded in, since the
  // principal can change as later declarations arrive.
  for (const o of groups.values()) {
    const lead = o.principal.declarerCountry;
    o.attackers = [lead, ...o.attackers.filter((c) => c !== lead).sort()];
  }
  // Order the offensives themselves for the same reason the roster is ordered, and
  // with more riding on it: the resolver fights them in sequence, and each one leaves
  // the front moved and both armies bled for the next. Whichever goes first therefore
  // fights at full strength and takes its ground first, which is not something to
  // leave to the order Mongo happened to return the declarations in. Earliest
  // declaration wins, tie-broken by id — the rule `outranks` already applies to pick
  // the principal within a group.
  return [...groups.values()].sort((a, b) =>
    a.principal === b.principal ? 0 : outranks(a.principal, b.principal) ? -1 : 1
  );
}

/**
 * Countries that auto-defend a front: they have units posted there AND resolve to the
 * defending side.
 *
 * Deployment is the consent step. A unit only reaches a front because its general was
 * posted there, so no separate opt-in is required — and `sideOf`'s bloc fallback is
 * self-limiting here because it still takes having sent troops.
 */
export function defendersAtFront(
  conflict: ConflictDoc,
  units: Array<{ countryId: string; theaterId: string }>,
  theaterId: string,
  defendingSide: Side,
  blocs: BlocLookup
): CountryId[] {
  const out: CountryId[] = [];
  for (const u of units) {
    if (u.theaterId !== theaterId) continue;
    const id = u.countryId as CountryId;
    if (out.includes(id)) continue;
    if (sideOf(conflict, u.countryId, blocs) === defendingSide) out.push(id);
  }
  return out;
}

/**
 * Allies who join an offensive at this front without declaring one of their own.
 *
 * The exact mirror of `defendersAtFront`, with one condition added. Defence needs no
 * opt-in because it is forced on you: an enemy attacking the ground your troops stand on
 * is not a decision you get to make, and deployment is therefore consent enough. Attack
 * IS a decision, so it takes a standing order — `optedIn` — set once per front instead of
 * re-declared every turn.
 *
 * Having troops posted here is still required. Opting in does not teleport an army, and a
 * country that resolves to the defending side is never dragged into attacking itself.
 */
export function autoJoinersAtFront(
  conflict: ConflictDoc,
  units: Array<{ countryId: string; theaterId: string }>,
  theaterId: string,
  attackingSide: Side,
  blocs: BlocLookup,
  optedIn: ReadonlySet<string>
): CountryId[] {
  const out: CountryId[] = [];
  for (const u of units) {
    if (u.theaterId !== theaterId) continue;
    const id = u.countryId as CountryId;
    if (out.includes(id)) continue;
    if (!optedIn.has(id)) continue;
    if (sideOf(conflict, u.countryId, blocs) === attackingSide) out.push(id);
  }
  return out;
}
