/**
 * C6 — group synergies.
 *
 * C4 made a group a fiscal structure: losses surrender, tax consolidates. What
 * a group still was not is an OPERATING structure. Two corporations under one
 * owner ran exactly as far apart as two strangers — no shared brand, no shared
 * distribution, nothing that made the group worth more than the sum of it.
 *
 * ## Synergy is a floor, never an average
 *
 * The obvious model is to average the members' capabilities. That is wrong in a
 * way that would be actively bad to play: it means acquiring a weak subsidiary
 * DRAGS DOWN a strong parent, so the optimal move is to never group anything.
 * Real groups share upward — the strong member's distribution network and brand
 * are what the weak one gets access to.
 *
 * So each member is pulled TOWARD the group's best, gradually, and no member is
 * ever reduced. The cap stops a group of ten shells from all inheriting a
 * flagship's brand outright.
 *
 * ## Spin-offs carry the brand out with them
 *
 * `isSpinOff` and `spunOffFromCorpId` have been written on every spun-off
 * corporation since the subsidiary work shipped and read by nothing — the audit
 * flagged them as dead fields. They mean something here: a business that was
 * literally part of the parent last turn keeps more of the parent's brand than
 * an unrelated corporation the group happened to buy, and that advantage decays
 * as the spin-off becomes its own company.
 */

/** Share of the gap to the group leader closed per turn. */
export const GROUP_SYNERGY_CONVERGENCE = 0.05;

/** Ceiling on what an ordinary member may inherit, as a share of the leader. */
export const GROUP_SYNERGY_MAX_SHARE = 0.6;

/** Higher ceiling for a recent spin-off, which carried the brand out with it. */
export const SPINOFF_SYNERGY_MAX_SHARE = 0.85;

/** Turns a spin-off keeps the raised ceiling before it becomes its own company. */
export const SPINOFF_BRAND_INHERITANCE_TURNS = 96;

export interface SynergyMember {
  corporationId: string;
  marketingStrength: number;
  logisticsStrength: number;
  /** Present when this corp was spun off from another. */
  isSpinOff?: boolean;
  spunOffFromCorpId?: string;
  /** Turn the spin-off happened, for the inheritance window. */
  spunOffAtTurn?: number;
}

export interface SynergyDelta {
  corporationId: string;
  marketingStrength: number;
  logisticsStrength: number;
}

/**
 * The ceiling a member may be lifted to, as a share of the group's best.
 *
 * A recent spin-off FROM A CURRENT GROUP MEMBER gets the raised ceiling. One
 * spun off from a corporation that has since left the group does not: the
 * advantage is continuity with the business it came from, and that is gone.
 */
export function memberShareCap(
  member: SynergyMember,
  groupMemberIds: ReadonlySet<string>,
  currentTurn: number
): number {
  if (!member.isSpinOff || !member.spunOffFromCorpId) return GROUP_SYNERGY_MAX_SHARE;
  if (!groupMemberIds.has(member.spunOffFromCorpId)) return GROUP_SYNERGY_MAX_SHARE;
  if (typeof member.spunOffAtTurn !== "number") return GROUP_SYNERGY_MAX_SHARE;
  if (currentTurn - member.spunOffAtTurn > SPINOFF_BRAND_INHERITANCE_TURNS)
    return GROUP_SYNERGY_MAX_SHARE;
  return SPINOFF_SYNERGY_MAX_SHARE;
}

const finite = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;

/**
 * Per-turn strength deltas for one group. Returns only members that actually
 * move, so a settled group writes nothing.
 */
export function computeGroupSynergies(
  members: SynergyMember[],
  currentTurn: number
): SynergyDelta[] {
  if (members.length < 2) return [];

  const ids = new Set(members.map((m) => m.corporationId));
  const bestMarketing = Math.max(...members.map((m) => finite(m.marketingStrength)));
  const bestLogistics = Math.max(...members.map((m) => finite(m.logisticsStrength)));
  if (bestMarketing <= 0 && bestLogistics <= 0) return [];

  const deltas: SynergyDelta[] = [];
  for (const member of members) {
    const cap = memberShareCap(member, ids, currentTurn);
    const marketing = finite(member.marketingStrength);
    const logistics = finite(member.logisticsStrength);

    // Target is the capped share of the leader — but never below where the
    // member already is. Synergy lifts; it does not level down, so a strong
    // corporation is never punished for being grouped with weak ones.
    const marketingTarget = Math.max(marketing, bestMarketing * cap);
    const logisticsTarget = Math.max(logistics, bestLogistics * cap);

    const marketingDelta = (marketingTarget - marketing) * GROUP_SYNERGY_CONVERGENCE;
    const logisticsDelta = (logisticsTarget - logistics) * GROUP_SYNERGY_CONVERGENCE;

    // Sub-0.01 movements are not worth a write and would never show in the UI.
    if (marketingDelta < 0.01 && logisticsDelta < 0.01) continue;

    deltas.push({
      corporationId: member.corporationId,
      marketingStrength: Math.round(marketingDelta * 100) / 100,
      logisticsStrength: Math.round(logisticsDelta * 100) / 100,
    });
  }
  return deltas;
}
