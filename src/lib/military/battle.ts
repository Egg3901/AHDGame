// Battle resolution engine, ported verbatim from the Combat Command design's
// DCLogic (forecast/computeBattle/applyOutcome). Pure + seeded — the caller
// passes a BattleContext (units, role assignments, general assignments, national
// doctrine mods, country scale/bloc); nothing here touches React or globals.
import type { NatMods } from "./doctrineTree";
import { WIN_BONUS_XP, LOSS_BONUS_XP, type GenMods } from "./generals";
import { type ProfileGeneral, generalMods } from "./generalsTree";
import { type ConflictAssignment, generalLeadingUnit, theaterCommanderOf } from "./assignments";
import {
  THEATER_COMMAND,
  ATTRITION,
  OCCUPATION,
  READINESS_DROP_BASE,
  READINESS_TEMPO_K,
  CASUALTY_RATE_SCALE,
} from "./config";
import { readinessBaselineOf } from "./readinessDrift";
import { EQUIPMENT_TRACK_MAX } from "./arsenal";
import {
  type CombatUnit,
  type StatObj,
  type Front,
  combatValue,
  frontageCost,
  statObj,
  computeCard,
  terrainFactor,
  navalReach,
  getRole,
  roleDef,
  effUpkeep,
  frontById,
  capacityOfTerrain,
} from "./combat";
import { NO_SUPPORT } from "@/lib/navair/frontSupport";
import type { FrontSupport } from "@/lib/navair/types";

/**
 * The general↔units↔front binding used by battle math.
 *
 * `assignments` says where each general is and which units they lead there;
 * `generalsById` carries the authoritative profiles, resolved server-side from
 * characterGenerals. Client input never reaches this. Full profiles, not bare
 * `General`s: a general's modifiers come from the tree nodes they trained (`gtraits`).
 */
export interface GeneralBinding {
  assignments: ConflictAssignment[];
  generalsById: Record<string, ProfileGeneral>;
}

export interface BattleContext extends GeneralBinding {
  units: CombatUnit[];
  positions: Record<string, string>;
  natMods: NatMods;
  countryScale: number;
  /**
   * Which side of the conflict these forces fight on. Only naming reads it (see
   * `enemyFaction`); absent means the country could not be placed, and the enemy is
   * named generically. Replaced a `bloc` field, which asked a global question the
   * conflict already answers locally — and answered it wrong for most of the roster.
   */
  side?: "A" | "B";
  /**
   * The fronts in play, keyed by theaterId — built from the live conflicts a unit
   * can sit at (conflictToFront). The battle math resolves a unit's front from here
   * instead of a static table. Absent → homeland reserve is the only known front.
   */
  fronts?: Record<string, Front>;
  /**
   * This side's supply at the conflict being fought (ConflictDoc.supplyA/supplyB),
   * which occupation derives from how far the front has moved. Scales throughput in
   * supplyState. Absent = neutral, so every caller that predates occupation — and any
   * that cannot resolve which side a country is on — is unaffected.
   */
  conflictSupply?: number;
}

/**
 * The general commanding a unit, or null. Resolves through the unit's assigned
 * general, who commands only at the front they are posted to (and to which the
 * unit's reconciled theater follows them).
 */
function genForUnit(b: GeneralBinding, u: CombatUnit): ProfileGeneral | null {
  const gid = generalLeadingUnit(b.assignments, u.assignedGeneralId, u.theaterId);
  return gid ? (b.generalsById[gid] ?? null) : null;
}
function generalOf(ctx: BattleContext, u: CombatUnit): ProfileGeneral | null {
  return genForUnit(ctx, u);
}
/** Test seam — battle math resolves a unit's general through the assignment layer. */
export function generalOfForTest(ctx: BattleContext, u: CombatUnit): ProfileGeneral | null {
  return generalOf(ctx, u);
}
function cv(ctx: BattleContext, u: CombatUnit): number {
  return combatValue(u, ctx.natMods, generalMods(generalOf(ctx, u)));
}
/** What this formation costs in frontage — see `frontageCost`. Readiness excluded. */
function frontage(ctx: BattleContext, u: CombatUnit): number {
  return frontageCost(u, ctx.natMods, generalMods(generalOf(ctx, u)));
}

/** Deterministic mulberry32-style RNG (design rng). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface EnemyUnit {
  id: string;
  name: string;
  icon: string;
  domain: string;
  traits: string[];
  s: StatObj;
  cv: number;
}

const ENEMY_KIND: Record<
  string,
  { icon: string; domain: string; t: string[]; s: StatObj; names: string[] }
> = {
  armor: {
    icon: "tank",
    domain: "ground",
    t: ["armored", "antiarmor"],
    s: { fp: 74, ar: 88, sh: 86, mo: 62, mb: 55, rn: 25, aa: 20, rc: 35 },
    names: ["Guards Tank Regiment", "Heavy Armor Bde", "Armor Division"],
  },
  mech: {
    icon: "tank",
    domain: "ground",
    t: ["armored", "rapid"],
    s: { fp: 64, ar: 68, sh: 66, mo: 60, mb: 74, rn: 28, aa: 32, rc: 45 },
    names: ["Motor Rifle Division", "Mechanized Bde"],
  },
  infantry: {
    icon: "soldier",
    domain: "ground",
    t: ["allweather", "recon"],
    s: { fp: 50, ar: 40, sh: 46, mo: 58, mb: 42, rn: 30, aa: 26, rc: 50 },
    names: ["Infantry Brigade", "Militia Column", "Airborne Bde"],
  },
  arty: {
    icon: "artillery",
    domain: "ground",
    t: ["longrange", "antiarmor"],
    s: { fp: 90, ar: 30, sh: 42, mo: 55, mb: 35, rn: 88, aa: 10, rc: 32 },
    names: ["Rocket Artillery Bde", "Artillery Group"],
  },
  air: {
    icon: "jet",
    domain: "air",
    t: ["antiair", "rapid"],
    s: { fp: 86, ar: 30, sh: 80, mo: 65, mb: 96, rn: 82, aa: 88, rc: 76 },
    names: ["Air Regiment", "Fighter Wing", "Air Assault Bde"],
  },
  airdef: {
    icon: "missile",
    domain: "air",
    t: ["antiair"],
    s: { fp: 42, ar: 40, sh: 34, mo: 58, mb: 52, rn: 74, aa: 95, rc: 60 },
    names: ["Air Defense Corps", "SAM Regiment"],
  },
  missile: {
    icon: "missile",
    domain: "rocket",
    t: ["longrange", "strategic"],
    s: { fp: 92, ar: 32, sh: 82, mo: 55, mb: 45, rn: 95, aa: 8, rc: 52 },
    names: ["Missile Battalion", "Rocket Brigade"],
  },
  naval: {
    icon: "ship",
    domain: "naval",
    t: ["antiair", "longrange"],
    s: { fp: 72, ar: 55, sh: 58, mo: 62, mb: 68, rn: 80, aa: 70, rc: 66 },
    names: ["Destroyer Flotilla", "Naval Squadron"],
  },
};
/** Fallback enemy composition when a front carries no `enemyMix` of its own. */
const DEFAULT_ENEMY_MIX = ["mech", "infantry", "arty"];

/** Deterministic enemy force generator for a front (design buildEnemy). */
export function buildEnemy(front: Front, seed: number): EnemyUnit[] {
  const r = rng(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(r() * arr.length)];
  const mix = front.enemyMix ?? DEFAULT_ENEMY_MIX;
  const count = 3 + Math.floor(r() * 2);
  const arr: EnemyUnit[] = [];
  for (let i = 0; i < count; i++) {
    const k = ENEMY_KIND[mix[Math.floor(r() * mix.length)]];
    const grade = 0.85 + r() * 0.4;
    const s = {} as StatObj;
    for (const key in k.s) {
      const kk = key as keyof StatObj;
      s[kk] = Math.max(3, Math.min(100, Math.round(k.s[kk] * (kk === "mo" ? 1 : grade))));
    }
    arr.push({
      id: "e" + i,
      name: pick(k.names),
      icon: k.icon,
      domain: k.domain,
      traits: k.t,
      s,
      cv: Math.round((45 + r() * 75) * grade),
    });
  }
  return arr;
}

export interface AggItem {
  cv: number;
  s: StatObj;
  domain: string;
}
/**
 * Sea control a side needs to keep an amphibious force properly supplied ashore.
 *
 * Below the landing threshold on purpose: getting marines ashore against opposition is
 * far harder than keeping them fed once they are. A side that can no longer land can
 * still sustain what it already put there.
 */
export const MARINE_SUSTAINMENT_SEA_CONTROL = 40;

/** What an unsupported marine formation is worth: light infantry, not a landing force. */
export const MARINE_UNSUPPORTED_FRACTION = 0.6;

export interface SideAgg {
  mass: number;
  fp: number;
  ar: number;
  sh: number;
  mo: number;
  mb: number;
  rn: number;
  aa: number;
  rc: number;
  /**
   * This side's hold on the sky over the front, 0..100, from the naval and air layer.
   *
   * Replaces the old `airShare`, which was the share of a side's own mass that happened
   * to be air or naval. That measured what you BROUGHT, not what you WON: a side could
   * bring three air wings, lose the air war outright, and still read as having air
   * superiority. Contesting the sky now happens in `navairOperations` before the battle,
   * and this is its result.
   */
  airSuperiority: number;
  /** Ground weight delivered by close air support this turn, already folded into mass. */
  casWeight: number;
}
export function sideAgg(items: AggItem[], support: FrontSupport = NO_SUPPORT): SideAgg {
  let mass = 0,
    fp = 0,
    ar = 0,
    sh = 0,
    mo = 0,
    mb = 0,
    rn = 0,
    aa = 0,
    rc = 0;
  for (const it of items) {
    // Marines ashore across water are only as good as the sea lane behind them. Without
    // sea control they are cut off from the shipping that lands their heavy equipment and
    // carries their casualties out, so they fight as light infantry rather than as an
    // amphibious force.
    //
    // A sustainment penalty, deliberately NOT a deployment block: marines who have been
    // holding a front for forty turns must not evaporate the moment this ships. It is
    // also the only route sea control has into a land battle besides interdiction, which
    // is what stops a total naval victory from being worth nothing on the ground.
    const w =
      it.domain === "marine" && support.seaControl < MARINE_SUSTAINMENT_SEA_CONTROL
        ? it.cv * MARINE_UNSUPPORTED_FRACTION
        : it.cv;
    mass += w;
    fp += it.s.fp * w;
    ar += it.s.ar * w;
    sh += it.s.sh * w;
    mo += it.s.mo * w;
    mb += it.s.mb * w;
    rn += it.s.rn * w;
    aa += it.s.aa * w;
    rc += it.s.rc * w;
  }
  // Per-stat averages weight by the FORMATIONS present, so `d` is unit mass and does not
  // include close air support. A sortie contributes weight to the push; it does not drag
  // the front's average armour or morale toward its own.
  const d = Math.max(1, mass);
  return {
    mass: mass + support.casWeight,
    fp: fp / d,
    ar: ar / d,
    sh: sh / d,
    mo: mo / d,
    mb: mb / d,
    rn: rn / d,
    aa: aa / d,
    rc: rc / d,
    airSuperiority: support.airSuperiority,
    casWeight: support.casWeight,
  };
}
export interface SideMults {
  pen: number;
  airm: number;
  rec: number;
  stand: number;
  shock: number;
  total: number;
}
export function sideMults(A: SideAgg, B: SideAgg): SideMults {
  const cl = (x: number) => Math.max(-0.5, Math.min(0.5, x));
  const pen = 1 + 0.3 * cl((A.fp - B.ar) / 120);
  // Head to head hold on the sky, decided by `navairOperations` before this battle
  // ran. The 0.24 coefficient and the 120 spread are UNCHANGED from the previous
  // formula on purpose: the input changes, the magnitude does not, so the static
  // replay isolates the effect of measuring air power properly from the effect of
  // retuning it. Retune only once the replay says what the first change did.
  const airm = 1 + 0.24 * cl((A.airSuperiority - B.airSuperiority) / 120);
  const rec = 1 + 0.15 * cl((A.rc - B.rc) / 120);
  const stand = 1 + 0.15 * cl((A.rn - B.rn) / 120);
  const shock = 1 + 0.12 * cl((A.sh - B.ar) / 120);
  return { pen, airm, rec, stand, shock, total: pen * airm * rec * stand * shock };
}

export interface SupplyState {
  level: number;
  state: { l: string; c: string };
  effMult: number;
  attrMult: number;
  demand: number;
  throughput: number;
}
/**
 * One side's supply at a front.
 *
 * Takes every contingent on the side: demand is per unit and must be costed under
 * its OWN nation's doctrine and scale, while throughput is a single pool the whole
 * coalition draws on. `natMods.supply` is a per-nation logistics doctrine added once
 * per side, so it is mass-weighted across contingents — summing it would hand a
 * five-ally coalition five times the bonus, and taking the first contingent's would
 * make the result depend on roster order.
 */
export function supplyState(
  ctxs: BattleContext[],
  frontId: string,
  plan?: EngagementPlan,
  /**
   * 0..1 of this side's throughput cut by ENEMY interdiction: bombers striking behind the
   * line, and a blockade closing the sea lane that feeds the front. Optional, so a caller
   * that predates the naval and air layer is unaffected.
   */
  interdiction = 0
): SupplyState {
  const front = frontById(frontId, ctxs[0]?.fronts);
  let demand = 0;
  let throughput = front.infra != null ? front.infra : 60;
  let depthCount = 0;
  let supportCount = 0;
  let formations = 0;
  const seenForm: Record<string, number> = {};
  let supplyMass = 0;
  let supplyWeighted = 0;
  for (const ctx of ctxs) {
    const units = ctx.units.filter((u) => u.theaterId === frontId);
    for (const u of units) {
      demand += effUpkeep(u, ctx.natMods, generalMods(generalOf(ctx, u)), ctx.countryScale) / 12;
      const id = String(u._id);
      const role = plan?.roleOf.get(id) ?? getRole(ctx.positions, u);
      const tk = computeCard(u).traitKeys || [];
      // The PLAN is the authority on who is actually behind the line. Reading the
      // player's label instead let a side collect depot throughput for formations that
      // were standing in the line, which made perfect supply a matter of typing "rear"
      // enough times -- depth still engages at 0.10, so the label cost nothing.
      const inDepth = plan ? !plan.inContact.has(id) : role === "rear";
      formations++;
      if (inDepth) depthCount++;
      else if (role === "support") supportCount++;
      if (tk.indexOf("logistics") >= 0) throughput += 22;
      if (u.domain === "air" && tk.indexOf("rapid") >= 0) throughput += 6;
      // A general's supply contribution counts once, not once per unit they lead.
      const gid = generalLeadingUnit(ctx.assignments, u.assignedGeneralId, u.theaterId);
      if (gid && !seenForm[gid]) {
        seenForm[gid] = 1;
        throughput += generalMods(generalOf(ctx, u)).supply;
      }
      supplyMass += 1;
      supplyWeighted += ctx.natMods.supply;
    }
  }
  // Tooth to tail. Depth exists to feed the line, so it is counted only up to the size
  // of the line it feeds: a tail longer than its teeth is not logistics, it is parking.
  // Self-scaling, so it needs no constant of its own and grows with the war.
  const teeth = formations - depthCount;
  throughput += 34 * Math.min(depthCount, teeth) + 14 * supportCount;
  // Unit-weighted so allies cannot stack the bonus. With no units present there is
  // nothing to weight by, so fall back to the first contingent's own figure — which
  // is exactly what a single-country side did before contingents existed.
  throughput += supplyMass ? supplyWeighted / supplyMass : (ctxs[0]?.natMods.supply ?? 0);
  // Territorial position: a side squeezed by a losing front hauls less through a
  // degraded theatre. Multiplicative rather than additive so a floored supply at a
  // low-infrastructure front cannot drive throughput negative. The figure is per
  // SIDE, so any contingent carries it; take the first that has one.
  const conflictSupply = ctxs.find((c) => c.conflictSupply != null)?.conflictSupply;
  if (conflictSupply != null) {
    throughput = Math.max(0, throughput) * (conflictSupply / OCCUPATION.supplyNeutral);
  }
  demand = Math.max(1, Math.round(demand));
  throughput = Math.round(throughput);
  // Interdiction cuts what actually arrives, not what the front asks for. Applied here,
  // after every source of throughput is summed and before anything derives from it, so a
  // strangled front reads as short of supply through the SAME path as a front with poor
  // infrastructure, rather than through a second mechanism nobody would think to check.
  throughput *= 1 - Math.max(0, Math.min(1, interdiction));

  const level = Math.max(0, Math.min(100, Math.round((throughput / demand) * 100)));
  const state =
    level >= 85
      ? { l: "SUPPLIED", c: "#86d978" }
      : level >= 55
        ? { l: "STRAINED", c: "#d4af37" }
        : level >= 30
          ? { l: "SHORTAGE", c: "#f59e0b" }
          : { l: "CUT OFF", c: "#ef8a8a" };
  const effMult = 0.55 + 0.45 * (level / 100);
  const attrMult = 1 + (1 - level / 100) * 1.6;
  return { level, state, effMult, attrMult, demand, throughput };
}

export interface Forecast {
  front: Front;
  enemy: EnemyUnit[];
  A: SideAgg;
  B: SideAgg;
  am: SideMults;
  bm: SideMults;
  ownStr: number;
  enemyStr: number;
  ratio: number;
  ownTf: number;
  oddsPct: number;
  reserveRes: number;
  rearShare: number;
  deepShare: number;
  sup: SupplyState;
  deepDegrade: number;
}
/** A side's engaged aggregate + role buffs + supply at a front (own-perspective).
 *  Shared by the synthetic forecast and the real-vs-real resolver. No rng. */
export interface OwnSideProfile {
  engaged: AggItem[];
  combatMass: number;
  supportBuff: number;
  flankBuff: number;
  /** Front-wide multiplier from the Theater Commander in charge here. 1 when none. */
  tcBuff: number;
  reserveRes: number;
  rearShare: number;
  deepShare: number;
  /**
   * Mass-weighted `1 + natMods.deep` across contingents, so a coalition's deep-strike
   * doctrine reflects whoever actually brought the deep-strike units. 1 when nobody did.
   */
  deepBuff: number;
  genEnemyMin: number;
  sup: SupplyState;
  ownTf: number;
}

/**
 * The Theater Commander's front-wide command multiplier.
 *
 * A share of the cv edge their own training gives, applied once to the whole front —
 * so it scales with the TC's quality, never with force size, and is strictly weaker
 * than putting that general on the units directly.
 *
 * Reads flat `cv` only, deliberately: `cvTrait` bonuses are unit-specific expertise
 * (an armor specialist's edge with armour) and do not generalise to a whole front.
 * A TC trained purely into `cvTrait` paths therefore confers no command bonus — they
 * are a specialist, not a theater commander. That is intended, not a gap.
 */
function theaterCommandBuff(ctxs: BattleContext[], frontId: string): number {
  // A conflict designates at most one Theater Commander, but in a coalition it can
  // belong to any ally, so search every contingent for the one holding the billet.
  for (const ctx of ctxs) {
    const tc = theaterCommanderOf(ctx.assignments, frontId);
    if (!tc) continue;
    const g = ctx.generalsById[tc];
    if (g) return 1 + (generalMods(g).cv - 1) * THEATER_COMMAND.bonusShare;
  }
  return 1;
}
/**
 * One side's combat profile at a front, pooled across every contingent on that side.
 *
 * Each unit is still evaluated under its OWN nation's context — doctrine, scale and
 * generals — because `cv()` applies those per unit. That is what lets a coalition
 * fight as one army without any nation's doctrine leaking onto another's troops.
 */
/** Which formations stand in the line at a front, and which are held in depth. */
export interface EngagementPlan {
  inContact: Set<string>;
  /** unit id -> effective role, for the overflow only. Empty when the side fits. */
  roleOf: Map<string, string>;
}

/** Who stands in the line first. The player's own role choice leads. */
const ENGAGE_PRIORITY: Record<string, number> = {
  frontline: 0,
  flank: 1,
  support: 2,
  deepstrike: 3,
  reserve: 4,
  rear: 5,
};

/**
 * Fill a front to `capacity` in combat value; hold everything past it in depth.
 *
 * Computed ONCE for a whole side and consumed by both the strength path
 * (`ownSideProfile`) and the casualty path (`unitOutcomes`). Those were independent, and
 * that is exactly how a formation could be out of contact for strength purposes and go
 * on bleeding anyway.
 *
 * Order: the player's own role assignment first, so the existing role system is the
 * control surface and there is no new concept to learn; then combat value, so the best
 * formations hold the line; then unit id, so a tie never depends on the order Mongo
 * returned the units in. That last tiebreak is not cosmetic -- the roster reaches the
 * battle report.
 *
 * Deliberately NOT applied to `supplyState`: a formation held in depth really is doing
 * rear-area work, and its logistics presence is not the question the cap is asking.
 *
 * One formation is always in contact. A side that fielded nothing would not be a battle.
 */
export function planEngagement(
  ctxs: BattleContext[],
  frontId: string,
  capacity: number
): EngagementPlan {
  const rows: { id: string; role: string; cv: number }[] = [];
  const front = frontById(frontId, ctxs.find((c) => c.fronts?.[frontId])?.fronts);
  for (const ctx of ctxs) {
    for (const u of ctx.units.filter((x) => x.theaterId === frontId)) {
      // The value this formation can actually bring to THIS ground, not its paper
      // strength: terrain and reach both apply. A carrier off a landlocked front
      // contributes a tenth of itself, so it must neither claim a tenth of the frontage
      // nor outrank an infantry division for a place in the line.
      const card = computeCard(u);
      const effective =
        frontage(ctx, u) *
        terrainFactor(front, u.domain, card.traitKeys) *
        navalReach(front, u.domain, card.traitKeys);
      rows.push({ id: String(u._id), role: getRole(ctx.positions, u), cv: effective });
    }
  }
  rows.sort((a, b) => {
    const pa = ENGAGE_PRIORITY[a.role] ?? 9;
    const pb = ENGAGE_PRIORITY[b.role] ?? 9;
    if (pa !== pb) return pa - pb;
    if (b.cv !== a.cv) return b.cv - a.cv;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const inContact = new Set<string>();
  const roleOf = new Map<string, string>();
  let used = 0;
  for (const row of rows) {
    if (inContact.size === 0 || used + row.cv <= capacity) {
      used += row.cv;
      inContact.add(row.id);
    } else {
      // The rear treatment: engage 0.10, casualties 0.15. In depth, not deleted.
      roleOf.set(row.id, "rear");
    }
  }
  return { inContact, roleOf };
}

function ownSideProfile(
  ctxs: BattleContext[],
  frontId: string,
  plan?: EngagementPlan,
  /** Enemy interdiction against THIS side. See `supplyState`. */
  interdiction = 0
): OwnSideProfile {
  // Terrain is a property of the front, not of its id. Resolved once here off the
  // first context that knows this front — every contingent is fighting on the same
  // ground, so they must all be weighted by the same terrain.
  const front = frontById(frontId, ctxs.find((c) => c.fronts?.[frontId])?.fronts);
  let rawTot = 0,
    tfTot = 0,
    deepMass = 0,
    deepWeighted = 0;
  const roleMass: Record<string, number> = {
    frontline: 0,
    support: 0,
    reserve: 0,
    flank: 0,
    rear: 0,
    deepstrike: 0,
  };
  const engaged: AggItem[] = [];
  const seenG: Record<string, number> = {};
  let genEnemy = 1;

  for (const ctx of ctxs) {
    for (const u of ctx.units.filter((x) => x.theaterId === frontId)) {
      const base = cv(ctx, u);
      const card = computeCard(u);
      const adj =
        base *
        terrainFactor(front, u.domain, card.traitKeys) *
        navalReach(front, u.domain, card.traitKeys);
      rawTot += base;
      tfTot += adj;
      const role = plan?.roleOf.get(String(u._id)) ?? getRole(ctx.positions, u);
      roleMass[role] += adj;
      engaged.push({ cv: adj * roleDef(role).engage, s: statObj(u), domain: u.domain });
      if (role === "deepstrike") {
        deepMass += adj;
        deepWeighted += adj * (1 + ctx.natMods.deep);
      }
      // Each general debuffs the enemy once for the whole coalition — not once per
      // unit, and not once per contingent they appear in.
      const gid = generalLeadingUnit(ctx.assignments, u.assignedGeneralId, u.theaterId);
      if (gid && !seenG[gid]) {
        seenG[gid] = 1;
        genEnemy = Math.min(genEnemy, generalMods(generalOf(ctx, u)).enemy);
      }
    }
  }

  const ownTf = rawTot ? tfTot / rawTot : 1;
  const totalMass = Object.keys(roleMass).reduce((a, k) => a + roleMass[k], 0);
  const share = (rl: string) => (totalMass ? Math.min(1, (roleMass[rl] / totalMass) * 2) : 0);
  return {
    engaged,
    combatMass: engaged.reduce((a, e) => a + e.cv, 0),
    supportBuff: 1 + 0.28 * share("support"),
    flankBuff: 1 + 0.16 * share("flank"),
    tcBuff: theaterCommandBuff(ctxs, frontId),
    reserveRes: share("reserve"),
    rearShare: share("rear"),
    deepShare: share("deepstrike"),
    deepBuff: deepMass ? deepWeighted / deepMass : 1,
    genEnemyMin: genEnemy,
    sup: supplyState(ctxs, frontId, plan, interdiction),
    ownTf,
  };
}

export function forecast(ctx: BattleContext, frontId: string, seed: number): Forecast {
  const front = frontById(frontId, ctx.fronts);
  const P = ownSideProfile([ctx], frontId);
  const enemy = buildEnemy(front, seed);
  const enemyAgg = enemy.map((e) => ({
    cv: e.cv * terrainFactor(front, e.domain, e.traits) * navalReach(front, e.domain, e.traits),
    s: e.s,
    domain: e.domain,
  }));
  const A = sideAgg(P.engaged);
  const B = sideAgg(enemyAgg);
  const am = sideMults(A, B);
  const bm = sideMults(B, A);
  const deepEff = 1 - 0.6 * Math.min(1, B.aa / 100);
  const deepDegrade = 0.32 * P.deepBuff * P.deepShare * deepEff * (0.6 + 0.5 * P.rearShare);
  const sup = P.sup;
  const ownStr = P.combatMass * P.supportBuff * P.flankBuff * P.tcBuff * am.total * sup.effMult;
  const enemyStr = B.mass * bm.total * front.terr * (1 - deepDegrade) * P.genEnemyMin;
  let ratio = ownStr / Math.max(1, ownStr + enemyStr);
  ratio = Math.max(
    0.02,
    Math.min(0.98, ratio + P.reserveRes * 0.1 * (1 - Math.abs(ratio - 0.5) * 2))
  );
  return {
    front,
    enemy,
    A,
    B,
    am,
    bm,
    ownStr,
    enemyStr,
    ratio,
    ownTf: P.ownTf,
    oddsPct: Math.round(ratio * 100),
    reserveRes: P.reserveRes,
    rearShare: P.rearShare,
    deepShare: P.deepShare,
    sup,
    deepDegrade,
  };
}

export interface BattleRound {
  tag: string;
  friendly: number;
  hostile: number;
  note: string;
}
export interface UnitResult {
  id: string;
  name: string;
  role: string;
  dom: string;
  type: string;
  /**
   * The nation that owns this formation.
   *
   * A coalition side's results are concatenated into one list, so without this the
   * only country on the record is the principal's and an ally's dead are filed under
   * the coalition leader's flag. Absent on results from the synthetic (PvE) path,
   * which has no contingents, and on reports written before this existed.
   */
  country?: string;
  casualties: number;
  readiness: number;
  /** Equipment tracks destroyed (0..EQUIPMENT_TRACK_MAX). Replaced from the arsenal. */
  materiel: number;
  xp: number;
  promo: boolean;
}
export interface BattleResult {
  frontId: string;
  theaterName: string;
  verdict: string;
  win: boolean;
  enemy: EnemyUnit[];
  enemyName: string;
  attPower: number;
  defPower: number;
  oddsPct: number;
  rounds: BattleRound[];
  enemyLoss: number;
  unitResults: UnitResult[];
}

/**
 * The enemy's name is the OTHER side's label. `Front.west`/`.east` carry sideA's and
 * sideB's labels (see `conflictToFront`), so side A faces `east` and side B faces `west`.
 *
 * This used to switch on the context's BLOC, which is not the same question and got the
 * answer wrong: a side-B belligerent whose bloc resolved western — which every country
 * missing from the retired 9-entry table did, East Germany included — was told its own
 * coalition was the enemy in its own battle report.
 */
function enemyFaction(ctx: BattleContext, f: Front): string {
  const label = ctx.side === "A" ? f.east : ctx.side === "B" ? f.west : "";
  return label || "Hostile forces";
}

/** Per-unit casualties/readiness/xp for one side at a front, given the battle ratio
 *  (own perspective) and a shared rng stream. Two draws per unit — the exact order
 *  the synthetic and PvP paths both rely on. Returns results + total casualties. */
function unitOutcomes(
  units: CombatUnit[],
  positions: Record<string, string>,
  binding: GeneralBinding,
  natMods: NatMods,
  frontId: string,
  ratio: number,
  r: () => number,
  rearShare: number,
  reserveRes: number,
  plan?: EngagementPlan
): { unitResults: UnitResult[]; loss: number } {
  const att = units.filter((u) => u.theaterId === frontId);
  const cvOf = (u: CombatUnit) => combatValue(u, natMods, generalMods(genForUnit(binding, u)));
  const rawTotal = Math.max(
    1,
    att.reduce((a, u) => a + cvOf(u), 0)
  );
  const sustain = 1 - 0.25 * rearShare - 0.15 * reserveRes;
  let loss = 0;
  const unitResults: UnitResult[] = att.map((u) => {
    const st = statObj(u);
    const role = plan?.roleOf.get(String(u._id)) ?? getRole(positions, u);
    const rc = roleDef(role).cas;
    const share = cvOf(u) / rawTotal;
    const armorMit = 1 - (st.ar / 100) * 0.45;
    const moraleMit = 1 - ((st.mo - 50) / 100) * 0.3;
    const gcas = generalMods(genForUnit(binding, u)).cas;
    const intensity = ((1 - ratio) * 0.5 + r() * 0.25) * armorMit * moraleMit * rc * sustain * gcas;
    const casualties = Math.round(
      u.personnel * Math.min(0.4, Math.max(0, intensity) * CASUALTY_RATE_SCALE) * (0.6 + share)
    );
    /**
     * Readiness is SUBTRACTED, not assigned.
     *
     * `armorMit` and `rc` are the same terms the casualty line above uses, and they are
     * correct for a subtraction: armour reduces what a battle takes out of a crew, and a
     * more exposed role increases it. Assigning them to a LEVEL inverted both, which is
     * why an armoured division used to end a battle more exhausted than the infantry
     * beside it, and a carrier that lost three men ended more exhausted than either.
     *
     * `depletion` is measured against the NOMINAL posture baseline, not the arrears- or
     * tier-suppressed one: it asks how worn this formation is against what its posture
     * normally holds, and an unfunded army must not read as fresher merely because its
     * target sagged.
     */
    const baseline = readinessBaselineOf(u.posture);
    const depletion = Math.max(0, Math.min(1, 1 - u.readiness / Math.max(1, baseline)));
    const drop =
      READINESS_DROP_BASE *
      armorMit *
      rc *
      (0.6 + 0.8 * (1 - ratio)) *
      (1 + READINESS_TEMPO_K * depletion);
    const readiness = Math.round(u.readiness - drop);
    const xp = Math.round((16 + ratio * 20) * natMods.xp);
    const willPromote = u.vet < 4 && u.xp + xp >= 100;
    loss += casualties;

    // Materiel destroyed. Derived from the SAME intensity that drives casualties, so every
    // modifier already folded in there — force ratio, role, morale, the general, the
    // rear/reserve sustain term, and the lighter punishment of a retreat — applies here for
    // free rather than through a second attrition formula that could drift out of agreement
    // with the first.
    //
    // Armour is the one term divided back out. `armorMit` spares the CREW, but the vehicle
    // IS the materiel: a knocked-out tank is destroyed equipment whether or not its crew
    // walked away. Carrying armour through would make heavy formations both harder to kill
    // and cheaper to re-equip, which is backwards.
    const materielIntensity = armorMit > 0 ? Math.max(0, intensity) / armorMit : 0;
    const materiel = Math.max(
      0,
      Math.min(EQUIPMENT_TRACK_MAX, Math.round(materielIntensity * MATERIEL_LOSS_SCALE))
    );

    return {
      id: String(u._id),
      name: u.name,
      role,
      dom: u.domain,
      type: u.type,
      casualties,
      // A subtraction is monotone downward already, so the old `min(current, ...)` cap
      // is gone. The floor stays: a formation is spent, never erased.
      readiness: Math.max(3, readiness),
      materiel,
      xp,
      promo: willPromote,
    };
  });
  return { unitResults, loss };
}

/** Resolve a battle deterministically for a front + seed (design computeBattle). */
export function computeBattle(ctx: BattleContext, frontId: string, seed: number): BattleResult {
  const fc = forecast(ctx, frontId, seed);
  const ratio = fc.ratio;
  const r = rng(seed + 999);
  let f = 100,
    h = 100;
  const rounds: BattleRound[] = [];
  for (let i = 0; i < 5; i++) {
    const dh = (8 + r() * 16) * (0.5 + ratio);
    const df = (8 + r() * 16) * (0.5 + (1 - ratio));
    h = Math.max(0, h - dh);
    f = Math.max(0, f - df);
    const note = dh > df ? "advance" : df > dh * 1.4 ? "heavy resistance" : "contact";
    rounds.push({
      tag: "T+" + (i + 1) + "h",
      friendly: Math.round(f / 2),
      hostile: Math.round(h / 2),
      note,
    });
    if (h <= 5 || f <= 5) break;
  }
  const win = f >= h;
  const margin = f - h;
  let verdict: string;
  if (win && margin > 45) verdict = "Decisive Victory";
  else if (win && margin > 15) verdict = "Victory";
  else if (win) verdict = "Pyrrhic Victory";
  else if (margin > -30) verdict = "Costly Defeat";
  else verdict = "Rout";
  const enemyLoss = Math.round(100 - h);
  const { unitResults } = unitOutcomes(
    ctx.units,
    ctx.positions,
    ctx,
    ctx.natMods,
    frontId,
    ratio,
    r,
    fc.rearShare,
    fc.reserveRes
  );
  return {
    frontId,
    theaterName: fc.front.name,
    verdict,
    win,
    enemy: fc.enemy,
    enemyName: enemyFaction(ctx, fc.front),
    attPower: Math.round(fc.ownStr),
    defPower: Math.round(fc.enemyStr),
    oddsPct: fc.oddsPct,
    rounds,
    enemyLoss,
    unitResults,
  };
}

// ── Real-vs-real (PvP) resolution ───────────────────────────────────────────
// One nation's forces vs another's at a shared theater. Both sides are real units;
// the "enemy" aggregate comes from the defender's live units, not buildEnemy.

export interface BattleSide extends GeneralBinding {
  units: CombatUnit[];
  positions: Record<string, string>;
  natMods: NatMods;
  countryScale: number;
  /** Which side of the conflict this contingent fights on (see BattleContext.side). */
  side?: "A" | "B";
  country: string;
  /** The fronts in play for this side, keyed by theaterId (conflictToFront). */
  fronts?: Record<string, Front>;
  /** This side's supply at the conflict (see BattleContext.conflictSupply). */
  conflictSupply?: number;
}
/**
 * Tracks destroyed per point of unmitigated engagement intensity.
 *
 * The single dial on materiel attrition, calibrated so an ordinary engagement costs well
 * under one track (rounding to 0) and a rout costs one. Anything larger would let a single
 * battle strip a formation that took a game year of contracts to equip; anything smaller and
 * a war would not drain the arsenal at all, which is the point of the mechanic.
 */
export const MATERIEL_LOSS_SCALE = 1.6;

/** One nation's share of a coalition side's engagement. */
export interface ContingentOutcome {
  country: string;
  /**
   * This nation's share of the side's combat power, apportioned by the combat mass
   * it brought to the front. Sums to the side's `power` up to per-entry rounding.
   */
  power: number;
  /** This nation's own dead — never the coalition's. */
  loss: number;
}

export interface SideOutcome {
  /** The principal, which names the side. Kept because every pre-coalition reader
   *  expects it; it is NOT the only belligerent — see `contingents`. */
  country: string;
  power: number;
  /** The WHOLE side's dead, coalition included. Per-nation figures are on
   *  `contingents`; quoting this beside `country` credits allies' dead to the
   *  principal, which is exactly the bug `contingents` exists to fix. */
  loss: number;
  unitResults: UnitResult[];
  /**
   * Per-nation attribution, principal first. Absent on reports written before
   * coalitions were attributed — read it through `contingentsOf`, never directly.
   */
  contingents?: ContingentOutcome[];
}

/**
 * A side's per-nation breakdown, falling back to the principal on reports written
 * before contingents were recorded.
 *
 * Every reader of a stored `SideOutcome` goes through this. A pre-coalition report
 * names one country per side and that country carries the whole loss, which is
 * accurate for the bilateral battles those reports actually describe.
 */
export function contingentsOf(
  side: Pick<SideOutcome, "country" | "power" | "loss" | "contingents">
): ContingentOutcome[] {
  if (side.contingents?.length) return side.contingents;
  return [{ country: side.country, power: side.power, loss: side.loss }];
}
export interface PvpBattleResult {
  theaterId: string;
  theaterName: string;
  verdict: string;
  win: boolean; // attacker perspective
  /** `f − h` from the round track, attacker perspective — the same number behind
   *  `verdict`. Positive = attacker won. Drives the occupation shift. */
  margin: number;
  rounds: BattleRound[];
  attacker: SideOutcome;
  defender: SideOutcome;
  /** Set when a side broke off early rather than fighting all five rounds. The
   *  breaking side loses but takes fewer casualties; its units hold position. */
  retreat: { side: "attacker" | "defender"; round: number } | null;
}

function sideCtx(side: BattleSide): BattleContext {
  return {
    units: side.units,
    positions: side.positions,
    assignments: side.assignments,
    generalsById: side.generalsById,
    natMods: side.natMods,
    countryScale: side.countryScale,
    side: side.side,
    fronts: side.fronts,
    conflictSupply: side.conflictSupply,
  };
}

/**
 * Resolve a battle between two real nations at a theater, deterministically for a
 * seed. Strengths are symmetric (each side's profile vs the other's aggregate);
 * the defender holds the terrain advantage. Returns per-unit outcomes for BOTH
 * sides — the turn processor persists them to each nation's live units.
 */
/** The deterministic pre-battle projection: what both sides bring, and the odds.
 *  Shared by the war-room forecast and `resolvePvpBattle`, so a preview is exactly
 *  the engagement that will be resolved. Pure — no rng, no seed. */
export interface PvpForecast {
  front: Front;
  /** Who each side actually got into the line. Reused by `resolvePvpBattle` so the
   *  strength and casualty paths cannot disagree about who fought. */
  attackerPlan: EngagementPlan;
  defenderPlan: EngagementPlan;
  attStr: number;
  defStr: number;
  /**
   * Attacker perspective, reserve-adjusted, clamped 0.02..0.98.
   *
   * A PROBABILITY, and `resolvePvpBattle` is what makes that true: it fights the
   * battle at this ratio plus a per-battle fortune roll, which is what carries the
   * realised win rate onto this number (see `ATTRITION.fortuneSpread`). Every
   * player-facing surface — the war room's odds rows, the wiki's "your chance" — is
   * entitled to read it that way, so nothing here may narrow it back into a bare
   * force share without changing the resolver in the same breath.
   */
  ratio: number;
  oddsPct: number;
  /** The side profiles, so the resolver reuses this computation instead of redoing
   *  it (it also needs rearShare/reserveRes). Server-internal — never serialized. */
  attackerProfile: OwnSideProfile;
  defenderProfile: OwnSideProfile;
}

export function battleForecast(
  attackers: BattleSide[],
  defenders: BattleSide[],
  theaterId: string,
  /**
   * What the naval and air layer delivered to each side at this front this turn.
   * Optional so every existing caller keeps its previous behaviour exactly: absent
   * means no air superiority, no close air support and no interdiction, which is
   * what a battle fought before this subsystem existed had.
   */
  supportA: FrontSupport = NO_SUPPORT,
  supportD: FrontSupport = NO_SUPPORT
): PvpForecast {
  // Either coalition carries the same fronts map; take whichever is populated so an
  // empty side cannot silently drop the battle onto RESERVE_FRONT.
  const front = frontById(theaterId, attackers[0]?.fronts ?? defenders[0]?.fronts);
  // The front holds only so much in contact. Planned per side, before any strength is
  // measured, so depth never counts toward the fight nor bleeds for it.
  const capacity = front.capacity ?? capacityOfTerrain(front.terrain);
  const attackerPlan = planEngagement(attackers.map(sideCtx), theaterId, capacity);
  const defenderPlan = planEngagement(defenders.map(sideCtx), theaterId, capacity);
  // Each side's supply is cut by the OTHER side's interdiction. Reading your own here
  // would have a fleet starve the front it is supporting.
  const PA = ownSideProfile(attackers.map(sideCtx), theaterId, attackerPlan, supportD.interdiction);
  const PD = ownSideProfile(defenders.map(sideCtx), theaterId, defenderPlan, supportA.interdiction);
  const aggA = sideAgg(PA.engaged, supportA);
  const aggD = sideAgg(PD.engaged, supportD);
  const am = sideMults(aggA, aggD);
  const dm = sideMults(aggD, aggA);
  // Deep-strike degrades the opponent (using the opponent's air-defense).
  const aDeepEff = 1 - 0.6 * Math.min(1, aggD.aa / 100);
  const aDeep = 0.32 * PA.deepBuff * PA.deepShare * aDeepEff * (0.6 + 0.5 * PA.rearShare);
  const dDeepEff = 1 - 0.6 * Math.min(1, aggA.aa / 100);
  const dDeep = 0.32 * PD.deepBuff * PD.deepShare * dDeepEff * (0.6 + 0.5 * PD.rearShare);
  // Each side's generals debuff the opponent (genEnemyMin); the defender holds terrain.
  const attStr =
    PA.combatMass *
    PA.supportBuff *
    PA.flankBuff *
    PA.tcBuff *
    am.total *
    PA.sup.effMult *
    (1 - dDeep) *
    PD.genEnemyMin;
  const defStr =
    PD.combatMass *
    PD.supportBuff *
    PD.flankBuff *
    PD.tcBuff *
    dm.total *
    PD.sup.effMult *
    front.terr *
    (1 - aDeep) *
    PA.genEnemyMin;
  let ratio = attStr / Math.max(1, attStr + defStr);
  ratio = Math.max(
    0.02,
    Math.min(0.98, ratio + PA.reserveRes * 0.1 * (1 - Math.abs(ratio - 0.5) * 2))
  );
  return {
    front,
    attStr,
    defStr,
    ratio,
    oddsPct: Math.round(ratio * 100),
    attackerProfile: PA,
    defenderProfile: PD,
    attackerPlan,
    defenderPlan,
  };
}

/**
 * Break a side's result down per nation.
 *
 * Losses come from the FINAL unit results, so the retreat discount is already in
 * them and the contingents always sum to the side. Power cannot be summed the same
 * way -- `attStr`/`defStr` are products over the whole side's profile, not a total of
 * per-nation figures -- so it is apportioned by the combat mass each nation brought,
 * which is the term those products are built on.
 */
function contingentOutcomes(
  sides: BattleSide[],
  theaterId: string,
  sidePower: number,
  unitResults: UnitResult[]
): ContingentOutcome[] {
  // Keyed by country rather than by contingent: two BattleSides under one flag would
  // otherwise each claim the whole nation's dead.
  const order: string[] = [];
  const mass = new Map<string, number>();
  for (const c of sides) {
    if (!mass.has(c.country)) order.push(c.country);
    const m = ownSideProfile([sideCtx(c)], theaterId).combatMass;
    mass.set(c.country, (mass.get(c.country) ?? 0) + m);
  }
  const loss = new Map<string, number>();
  for (const u of unitResults) {
    if (!u.country) continue;
    loss.set(u.country, (loss.get(u.country) ?? 0) + u.casualties);
  }
  const total = [...mass.values()].reduce((a, m) => a + m, 0);
  return order.map((country) => ({
    country,
    power: total > 0 ? Math.round((sidePower * (mass.get(country) ?? 0)) / total) : 0,
    loss: loss.get(country) ?? 0,
  }));
}

export function resolvePvpBattle(
  attackers: BattleSide[],
  defenders: BattleSide[],
  theaterId: string,
  seed: number,
  supportA: FrontSupport = NO_SUPPORT,
  supportD: FrontSupport = NO_SUPPORT,
  /**
   * Override for the balance harness in `scripts/sim/` only. Production always takes
   * the tuned constant. Pass 0 to fight at the bare force balance, which is what this
   * resolver did before fortune existed — the comparison arm of a balance report.
   */
  fortuneSpread: number = ATTRITION.fortuneSpread
): PvpBattleResult {
  const fc = battleForecast(attackers, defenders, theaterId, supportA, supportD);
  const { front, attStr, defStr, ratio } = fc;
  const PA = fc.attackerProfile;
  const PD = fc.defenderProfile;

  const r = rng(seed + 999);
  /**
   * The odds this engagement is actually fought at: the projection, plus this
   * battle's luck. See `ATTRITION.fortuneSpread` for why the loop needs it — without
   * it `ratio` is a force share that decides the battle outright, and the percentage
   * the war room shows is not the chance it claims to be.
   *
   * Drawn before the round loop so every round of one battle shares it, and used for
   * the casualty split too: the side that had the good day must not also be billed
   * for the bleeding its own luck spared it.
   *
   * Bounded so the round loop's two damage multipliers, `0.5 + effRatio` and
   * `1.5 - effRatio`, can never go negative and start healing a side. At the tuned
   * spread the clamp is slack — `ratio` is already held to 0.02..0.98, so the widest
   * draw lands at -0.48 — but it keeps a future retune from silently inverting a
   * battle instead of merely making it swingier.
   */
  const effRatio = Math.max(-0.5, Math.min(1.5, ratio + (r() - 0.5) * 2 * fortuneSpread));
  let f = 100,
    h = 100;
  let retreat: PvpBattleResult["retreat"] = null;
  const rounds: BattleRound[] = [];
  for (let i = 0; i < 5; i++) {
    const dh = (8 + r() * 16) * (0.5 + effRatio);
    const df = (8 + r() * 16) * (0.5 + (1 - effRatio));
    h = Math.max(0, h - dh);
    f = Math.max(0, f - df);
    const note = dh > df ? "advance" : df > dh * 1.4 ? "heavy resistance" : "contact";
    rounds.push({
      tag: "T+" + (i + 1) + "h",
      friendly: Math.round(f / 2),
      hostile: Math.round(h / 2),
      note,
    });
    // A side whose will to fight collapses breaks off rather than being annihilated.
    if (f < ATTRITION.retreatTrack || h < ATTRITION.retreatTrack) {
      retreat = { side: f < h ? "attacker" : "defender", round: i + 1 };
      break;
    }
    if (h <= 5 || f <= 5) break;
  }
  const win = f >= h;
  const margin = f - h;
  let verdict: string;
  if (win && margin > 45) verdict = "Decisive Victory";
  else if (win && margin > 15) verdict = "Victory";
  else if (win) verdict = "Pyrrhic Victory";
  else if (margin > -30) verdict = "Costly Defeat";
  else verdict = "Rout";

  /**
   * Casualties are computed per contingent, so each nation's losses are worked out
   * under its own doctrine and roles rather than the coalition leader's, then
   * concatenated into one side result. This is what keeps attribution honest
   * downstream: `applyOutcome` persists each unit under its own country.
   */
  const sideOutcomes = (
    sides: BattleSide[],
    profile: OwnSideProfile,
    sideRatio: number,
    plan: EngagementPlan
  ): { unitResults: UnitResult[]; loss: number } => {
    const unitResults: UnitResult[] = [];
    let loss = 0;
    for (const c of sides) {
      const out = unitOutcomes(
        c.units,
        c.positions,
        c,
        c.natMods,
        theaterId,
        sideRatio,
        r,
        profile.rearShare,
        profile.reserveRes,
        plan
      );
      // Stamp attribution on the way into the shared list. This is the only point
      // that still knows which contingent produced these results — once they are
      // concatenated the country is unrecoverable from the report alone.
      for (const u of out.unitResults) unitResults.push({ ...u, country: c.country });
      loss += out.loss;
    }
    return { unitResults, loss };
  };
  const attOut = sideOutcomes(attackers, PA, effRatio, fc.attackerPlan);
  const defOut = sideOutcomes(defenders, PD, 1 - effRatio, fc.defenderPlan);

  // Breaking off saves men: the side that disengaged takes a fraction of the
  // casualties it would have fighting the engagement out.
  const softenIfRetreated = (
    outcome: { unitResults: UnitResult[]; loss: number },
    forSide: "attacker" | "defender"
  ) => {
    if (retreat?.side !== forSide) return outcome;
    const unitResults = outcome.unitResults.map((u) => ({
      ...u,
      casualties: Math.round(u.casualties * ATTRITION.retreatCasualtyMult),
    }));
    return { unitResults, loss: unitResults.reduce((a, u) => a + u.casualties, 0) };
  };
  const attFinal = softenIfRetreated(attOut, "attacker");
  const defFinal = softenIfRetreated(defOut, "defender");

  return {
    theaterId,
    theaterName: front.name,
    verdict,
    win,
    margin,
    rounds,
    retreat,
    attacker: {
      // The principal leads the coalition roster, so it names the side -- but it does
      // NOT own the side's casualties. `contingents` is who actually bled.
      country: attackers[0]?.country ?? "",
      power: Math.round(attStr),
      loss: attFinal.loss,
      unitResults: attFinal.unitResults,
      contingents: contingentOutcomes(
        attackers,
        theaterId,
        Math.round(attStr),
        attFinal.unitResults
      ),
    },
    defender: {
      country: defenders[0]?.country ?? "",
      power: Math.round(defStr),
      loss: defFinal.loss,
      unitResults: defFinal.unitResults,
      contingents: contingentOutcomes(
        defenders,
        theaterId,
        Math.round(defStr),
        defFinal.unitResults
      ),
    },
  };
}

/**
 * Apply a battle result to units, and tally the XP each general earned.
 *
 * Generals are no longer mutated here: their profile lives in characterGenerals,
 * so the caller persists `generalXp` (characterId → xp) onto it. Returning a delta
 * rather than a leveled object keeps this function pure and the profile single-sourced.
 *
 * Two kinds of general earn: those who LED units in the fight, and the Theater
 * Commander who DIRECTED it (see `THEATER_COMMAND.xpShare`). The second used to earn
 * nothing at all, which read to players as broken progression rather than as a design.
 */
export function applyOutcome(
  ctx: BattleContext,
  result: BattleResult
): { units: CombatUnit[]; generalXp: Record<string, number> } {
  const map: Record<string, UnitResult> = {};
  result.unitResults.forEach((r) => (map[r.id] = r));
  const gXp: Record<string, number> = {};
  // Per theater: the XP one formation earned there, on average. That is the measure
  // the Theater Commander's award is taken from — it depends only on how the fighting
  // went, never on how the force happens to be split between generals, so no command
  // reshuffle can move it.
  const shareByTheater: Record<string, { sum: number; count: number }> = {};
  const units = ctx.units.map((u) => {
    const r = map[String(u._id)];
    if (!r) return u;
    const share = Math.round(r.xp * 0.9);
    const acc = (shareByTheater[u.theaterId] ??= { sum: 0, count: 0 });
    acc.sum += share;
    acc.count += 1;
    // Credit the general who actually led this unit at this front.
    const gid = generalLeadingUnit(ctx.assignments, u.assignedGeneralId, u.theaterId);
    if (gid) gXp[gid] = (gXp[gid] || 0) + share;
    // Materiel is stripped from all three tracks together: splitting loss by what was hit
    // would need a damage model the engine does not have, and every other path that moves
    // equipment (equipUnit, the refit step) already moves the three as one.
    const eq = u.equipment ?? { firepower: 0, protection: 0, support: 0 };
    const strip = (v: number) => Math.max(0, (v ?? 0) - (r.materiel ?? 0));
    const nu: CombatUnit = {
      ...u,
      personnel: Math.max(0, u.personnel - r.casualties),
      // `UnitResult.readiness` is the LEVEL the battle left, already floored by
      // `unitOutcomes` — not the amount it took. Subtracting it from the unit's current
      // readiness stored the DROP instead, which collapsed a fresh formation to single
      // digits in one engagement and inverted the ledger: a protected unit takes a
      // smaller drop, so it was persisted LOWER than the infantry beside it. That is the
      // precise inversion `unitOutcomes` was rewritten to remove, reintroduced one layer
      // below the tests that cover it.
      readiness: Math.max(3, r.readiness),
      equipment: {
        firepower: strip(eq.firepower),
        protection: strip(eq.protection),
        support: strip(eq.support),
      },
      xp: u.xp + r.xp,
    };
    while (nu.xp >= 100 && nu.vet < 4) {
      nu.xp -= 100;
      nu.vet = (nu.vet + 1) as CombatUnit["vet"];
    }
    if (nu.vet >= 4) nu.xp = Math.min(nu.xp, 100);
    return nu;
  });
  // A participation bonus lands once per general who fought, not once per unit.
  const bonus = result.win ? WIN_BONUS_XP : LOSS_BONUS_XP;
  const generalXp: Record<string, number> = {};
  for (const gid of Object.keys(gXp)) generalXp[gid] = gXp[gid] + bonus;

  // Theater command: a share of what a general leading one average formation here
  // would have earned. Added on top for a TC who also led units — they did both jobs.
  for (const theaterId of Object.keys(shareByTheater)) {
    const tc = theaterCommanderOf(ctx.assignments, theaterId);
    // Null when this contingent does not hold the billet — in a coalition the TC can
    // be an ally's general, and they earn through their own nation's contingent.
    if (!tc) continue;
    const { sum, count } = shareByTheater[theaterId];
    const perFormation = count ? sum / count : 0;
    const award = Math.round((perFormation + bonus) * THEATER_COMMAND.xpShare);
    if (award > 0) generalXp[tc] = (generalXp[tc] ?? 0) + award;
  }
  return { units, generalXp };
}

// re-export for convenience
export type { GenMods };
