// Commander trait tree + dossier profiles, ported from the design's generalData.js
// (FULLTREE + SPEC_PROFILE). Powers the General Profile page. Pure data + logic;
// the combat spec-track model lives in generals.ts. National-doctrine "boost"
// detection reads the SP2 doctrine tree.
import type { GeneralSpec, General } from "./generals";
import { DOCTRINE_CATS, keyOf as doctrineKeyOf } from "./doctrineTree";

export interface TraitMods {
  cv?: number;
  cvTrait?: Record<string, number>;
  cas?: number;
  enemy?: number;
  supply?: number;
  upkeep?: number;
  ready?: number;
}
export interface TraitTreeNode {
  id: string;
  name: string;
  dec: number; // decade year (1900..2040)
  cost: number;
  eff: string;
  mods: TraitMods | null;
  req: string | null;
  boost: string | null; // national-doctrine name that boosts this node
  conflict: string | null;
}
export interface TraitTreePath {
  id: string;
  name: string;
  color: string;
  nodes: TraitTreeNode[];
}
export interface TraitTreeCategory {
  name: string;
  color: string;
  paths: TraitTreePath[];
}

// N(id, name, decade, cost, effect, mods?, req?, boost?, conflict?)
function N(
  id: string,
  name: string,
  dec: number,
  cost: number,
  eff: string,
  mods: TraitMods | null = null,
  req: string | null = null,
  boost: string | null = null,
  conflict: string | null = null
): TraitTreeNode {
  return { id, name, dec, cost: 1, eff, mods, req, boost, conflict };
}
function P(id: string, name: string, color: string, nodes: TraitTreeNode[]): TraitTreePath {
  return { id, name, color, nodes };
}

export const FULLTREE: Record<string, TraitTreeCategory> = {
  command: {
    name: "Command Style",
    color: "#ef8a8a",
    paths: [
      P("aggressive", "Aggressive Commander", "#ef8a8a", [
        N("ag1", "Offensive Spirit", 1900, 1, "+6% attack momentum", { cv: 1.06 }),
        N("ag2", "High-Tempo Attacks", 1910, 2, "+8% follow-up attack rate", { cv: 1.06 }),
        N("ag3", "Relentless Pursuit", 1930, 2, "+10% pursuit after victory", { enemy: 0.94 }),
        N("ag4", "Risk-Taking Breakthroughs", 1940, 3, "+12% breakthrough · +casualties", {
          cv: 1.1,
        }),
        N(
          "ag5",
          "Shock Commander",
          1950,
          3,
          "+14% shock assault power",
          { cv: 1.12 },
          null,
          null,
          "Cautious Commander"
        ),
      ]),
      P("cautious", "Cautious Commander", "#7ba3ec", [
        N("ca1", "Careful Planning", 1900, 1, "+5% preparation · −4% casualties", { cas: 0.96 }),
        N("ca2", "Casualty Control", 1910, 2, "−8% casualties on defense", { cas: 0.92 }),
        N("ca3", "Prepared Advance", 1930, 2, "+6% set-piece attack", { cv: 1.05 }),
        N("ca4", "Controlled Withdrawal", 1940, 2, "−15% losses when retreating", { cas: 0.9 }),
        N(
          "ca5",
          "Methodical Commander",
          1950,
          3,
          "−12% casualties · slower advance",
          { cas: 0.88 },
          null,
          null,
          "Aggressive Commander"
        ),
      ]),
      P("flexible", "Flexible Commander", "#86d978", [
        N("fx1", "Rapid Adaptation", 1920, 2, "+6% response to new conditions"),
        N("fx2", "Improvised Response", 1940, 2, "+7% performance when plans fail", { cv: 1.05 }),
        N("fx3", "Opportunity Exploitation", 1960, 3, "+8% seize-the-moment attacks", { cv: 1.07 }),
        N(
          "fx4",
          "Decentralized Initiative",
          1980,
          3,
          "+8% subordinate initiative",
          null,
          "Mission Command national doctrine"
        ),
        N("fx5", "Adaptive Commander", 2000, 4, "+10% cross-domain flexibility", { cv: 1.08 }),
      ]),
      P("discipline", "Disciplinarian", "#c9a24b", [
        N("di1", "Strict Order", 1900, 1, "+5% cohesion"),
        N("di2", "Reduced Panic", 1910, 2, "−10% rout chance", { cas: 0.94 }),
        N("di3", "Improved Cohesion", 1930, 2, "+8% cohesion recovery"),
        N("di4", "Harsh Discipline", 1940, 2, "−12% desertion · morale cost", { cas: 0.9 }),
        N("di5", "Iron Commander", 1950, 3, "units fight to the last", { cv: 1.08 }),
      ]),
    ],
  },
  battlefield: {
    name: "Battlefield Specialty",
    color: "#7ba3ec",
    paths: [
      P("armor", "Armor Specialist", "#7ba3ec", [
        N(
          "ar1",
          "Tank Commander",
          1930,
          2,
          "+8% armored combat value",
          { cvTrait: { armored: 1.08 } },
          null,
          "Armored Spearhead"
        ),
        N(
          "ar2",
          "Armored Breakthroughs",
          1930,
          2,
          "+8% breakthrough for armor",
          { cvTrait: { armored: 1.08 } },
          null,
          "Armored Spearhead"
        ),
        N(
          "ar3",
          "Mechanized Coordination",
          1940,
          2,
          "+8% armor/infantry coordination",
          { cv: 1.06 },
          null,
          "Combined-Arms Warfare"
        ),
        N("ar4", "Deep Exploitation", 1940, 3, "+10% pursuit after breakthrough", { cv: 1.1 }),
        N("ar5", "Armored Warfare Expert", 1950, 3, "+14% armored effectiveness", {
          cvTrait: { armored: 1.12 },
        }),
      ]),
      P("infantry", "Infantry Specialist", "#86d978", [
        N("in1", "Infantry Leader", 1900, 1, "+6% infantry combat value", { cv: 1.05 }),
        N("in2", "Entrenchment Expert", 1910, 2, "+10% dug-in defense", { cas: 0.92 }),
        N("in3", "Urban Combat Leader", 1940, 2, "+10% urban combat", { cv: 1.06 }),
        N("in4", "Rough Terrain Fighter", 1940, 2, "+12% mountain/jungle combat"),
        N("in5", "Infantry Warfare Expert", 1950, 3, "+12% infantry effectiveness", { cv: 1.08 }),
      ]),
      P("artillery", "Artillery Specialist", "#e0b352", [
        N("at1", "Fire Support Planner", 1900, 1, "+6% artillery value", {
          cvTrait: { longrange: 1.06 },
        }),
        N("at2", "Counter-Battery Awareness", 1910, 2, "−10% enemy artillery", { enemy: 0.95 }),
        N("at3", "Heavy Barrage Coordinator", 1910, 2, "+8% barrage support"),
        N("at4", "Integrated Fires Expert", 1940, 3, "+10% artillery/air fires", {
          cvTrait: { longrange: 1.08 },
        }),
        N("at5", "Firepower Commander", 1950, 3, "+12% combined fires", {
          cvTrait: { longrange: 1.1 },
        }),
      ]),
      P("defensive", "Defensive Specialist", "#4fb0c4", [
        N("de1", "Fortification Planner", 1900, 1, "+6% prepared defense", { cas: 0.95 }),
        N("de2", "Defense in Depth", 1910, 2, "−12% enemy breakthrough", { enemy: 0.94 }),
        N("de3", "Anti-Armor Defense", 1930, 2, "+10% defense vs armor"),
        N("de4", "Elastic Defense Commander", 1940, 3, "−casualties, trade space", { cas: 0.86 }),
        N(
          "de5",
          "Defensive Mastermind",
          1950,
          3,
          "+14% overall defense",
          { cas: 0.85 },
          null,
          null,
          "Aggressive Commander"
        ),
      ]),
    ],
  },
  operational: {
    name: "Operational Specialty",
    color: "#b07fc4",
    paths: [
      P("maneuver", "Maneuver Operator", "#b07fc4", [
        N("mn1", "Mobile Operations", 1930, 2, "+8% operational mobility", { cv: 1.06 }),
        N("mn2", "Flank Exploitation", 1930, 2, "+8% envelopment success", { cv: 1.06 }),
        N(
          "mn3",
          "Encirclement Planner",
          1940,
          3,
          "+12% encirclement damage",
          { enemy: 0.88 },
          null,
          "Armored Spearhead"
        ),
        N(
          "mn4",
          "Operational Tempo",
          1950,
          3,
          "+10% sustained tempo",
          { cv: 1.08 },
          "Adequate national fuel stockpile"
        ),
        N("mn5", "Maneuver Master", 1960, 4, "+15% operational maneuver", { cv: 1.1 }),
      ]),
      P("attrition", "Attrition Operator", "#d16a6a", [
        N("af1", "Sustained Pressure", 1910, 2, "+6% grinding offensive", { cv: 1.05 }),
        N("af2", "Firepower Economy", 1910, 2, "−8% ammunition use", { supply: 6 }),
        N("af3", "Wear-Down Strategy", 1940, 2, "+8% prolonged-battle damage", { enemy: 0.95 }),
        N("af4", "Industrial War Planner", 1940, 3, "+8% protracted-war output", { upkeep: 0.92 }),
        N("af5", "Attrition Strategist", 1950, 3, "+12% war-of-material effectiveness", {
          cv: 1.06,
        }),
      ]),
      P("expeditionary", "Expeditionary Operator", "#e0934a", [
        N("ex1", "Overseas Command", 1900, 1, "+6% out-of-area operations"),
        N("ex2", "Beachhead Expansion", 1940, 2, "+10% landing consolidation", { cv: 1.06 }),
        N("ex3", "Port Seizure Support", 1940, 2, "+8% port capture"),
        N("ex4", "Limited War Commander", 1950, 3, "+10% limited-conflict control"),
        N("ex5", "Expeditionary General", 1990, 3, "+12% expeditionary reach", { cv: 1.08 }),
      ]),
      P("occupation", "Occupation Operator", "#9aaa5a", [
        N("oc1", "Garrison Planning", 1900, 1, "+8% garrison stability"),
        N("oc2", "Civil-Military Administration", 1940, 2, "+10% occupation control"),
        N("oc3", "Resistance Suppression", 1960, 2, "−10% insurgency growth", { enemy: 0.95 }),
        N("oc4", "Stabilization Command", 2000, 3, "+10% post-conflict stability"),
        N("oc5", "Occupation Specialist", 2000, 3, "+12% territory-hold effectiveness"),
      ]),
    ],
  },
  logistics: {
    name: "Logistics & Sustainment",
    color: "#e0b352",
    paths: [
      P("supply", "Supply-Conscious Commander", "#e0b352", [
        N("su1", "Ration Discipline", 1900, 1, "−4% supply consumption", { supply: 4 }),
        N("su2", "Ammunition Control", 1910, 2, "−6% ammo waste", { supply: 6 }),
        N("su3", "Fuel Management", 1930, 2, "−8% fuel use", { supply: 6 }),
        N(
          "su4",
          "Depot Coordination",
          1940,
          2,
          "−6% sustainment penalties",
          { supply: 10 },
          null,
          "Strategic Logistics"
        ),
        N("su5", "Sustainment Expert", 1950, 3, "+20 supply to their front", { supply: 20 }),
      ]),
      P("maintenance", "Maintenance Commander", "#c9a24b", [
        N("ma1", "Field Repairs", 1920, 2, "−10% vehicle downtime", { ready: 2 }),
        N("ma2", "Vehicle Recovery", 1940, 2, "recover disabled vehicles", { ready: 2 }),
        N("ma3", "Spare Parts Discipline", 1950, 2, "−8% breakdown rate", { ready: 2 }),
        N("ma4", "Lower Breakdown Rate", 1970, 3, "−12% mechanical losses", { ready: 3 }),
        N("ma5", "Maintenance Culture", 2010, 3, "−15% downtime force-wide", { ready: 3 }),
      ]),
      P("campaign", "Long Campaign Planner", "#b8923f", [
        N("lc1", "Rotation Planning", 1910, 2, "+8% sustained readiness", { ready: 2 }),
        N("lc2", "Exhaustion Management", 1940, 2, "−10% attrition from fatigue", { cas: 0.94 }),
        N("lc3", "Replacement Integration", 1940, 2, "+10% reinforcement absorption"),
        N("lc4", "Campaign Sustainment", 1950, 3, "+8% long-campaign endurance", { ready: 2 }),
        N("lc5", "War of Endurance", 1960, 3, "+12% protracted-war stamina", { cas: 0.92 }),
      ]),
    ],
  },
  joint: {
    name: "Joint Warfare",
    color: "#4fd1c5",
    paths: [
      P("airland", "Air-Land Integrator", "#4fd1c5", [
        N(
          "jl1",
          "Air Liaison Staff",
          1940,
          2,
          "+6% close air support",
          { cv: 1.04 },
          "Adequate national air readiness"
        ),
        N(
          "jl2",
          "Close Air Support Coordination",
          1940,
          2,
          "+8% CAS damage",
          { cv: 1.05 },
          "National Doctrine: Close Air Support"
        ),
        N("jl3", "Battlefield Interdiction Use", 1970, 3, "−10% enemy reinforcement", {
          enemy: 0.94,
        }),
        N(
          "jl4",
          "Air-Land Synchronization",
          1980,
          3,
          "+10% CAS · +8% breakthrough",
          { cv: 1.1 },
          "1980s era · Close Air Support · Coordination 70+",
          "Air-Land Battle"
        ),
        N("jl5", "Joint Strike Commander", 1990, 4, "+12% joint fires integration", { cv: 1.1 }),
      ]),
      P("navalland", "Naval-Land Integrator", "#5a86c4", [
        N("nl1", "Coastal Operations", 1900, 1, "+6% littoral operations"),
        N("nl2", "Naval Gunfire Coordination", 1940, 2, "+8% shore bombardment", { cv: 1.05 }),
        N("nl3", "Port Capture Planning", 1940, 2, "+8% amphibious port seizure"),
        N("nl4", "Littoral Campaign Support", 1990, 3, "+10% coastal campaigns"),
        N("nl5", "Maritime Ground Commander", 2000, 3, "+12% sea-land integration", { cv: 1.08 }),
      ]),
      P("marine", "Marine / Expeditionary Integrator", "#4fb0c4", [
        N("mi1", "Amphibious Staff Work", 1930, 2, "+6% landing planning"),
        N("mi2", "Beachhead Coordination", 1940, 2, "+8% beachhead defense", { cas: 0.94 }),
        N("mi3", "Rapid Landing Support", 1940, 2, "+8% landing speed"),
        N("mi4", "Joint Landing Operations", 1980, 3, "+10% combined landings", { cv: 1.08 }),
        N("mi5", "Expeditionary Integration Expert", 1990, 3, "+12% joint expeditionary ops", {
          cv: 1.08,
        }),
      ]),
      P("intel", "Intelligence-Led Commander", "#b07fc4", [
        N("il1", "Recon Emphasis", 1910, 2, "+6% enemy detection", { enemy: 0.96 }),
        N("il2", "Signals Intelligence Use", 1940, 2, "+8% enemy intelligence", { enemy: 0.95 }),
        N("il3", "Enemy Weak Point Analysis", 1960, 3, "+8% targeting effectiveness", { cv: 1.06 }),
        N("il4", "Targeting Coordination", 1990, 3, "+10% precision targeting", { enemy: 0.92 }),
        N("il5", "Intelligence-Driven Operations", 2000, 4, "+12% ISR-led operations", {
          cv: 1.08,
        }),
      ]),
    ],
  },
  political: {
    name: "Political & Staff Role",
    color: "#9aaa5a",
    paths: [
      P("survivor", "Political Survivor", "#9aaa5a", [
        N("ps1", "Court Influence", 1900, 1, "+court standing"),
        N("ps2", "Regime Loyalty", 1900, 1, "−coup risk"),
        N("ps3", "Scandal Avoidance", 1930, 2, "−scandal risk"),
        N("ps4", "Faction Balancing", 1950, 2, "survives leadership changes"),
        N("ps5", "Untouchable Commander", 1970, 3, "immune to political purges"),
      ]),
      P("staff", "Staff Organizer", "#6a8fd4", [
        N("so1", "General Staff Graduate", 1900, 1, "+5% HQ planning efficiency", { cv: 1.03 }),
        N("so2", "Efficient Headquarters", 1900, 2, "+6% order transmission", { cv: 1.04 }),
        N("so3", "Staff Discipline", 1910, 2, "−10% command friction"),
        N("so4", "Theater Coordination", 1940, 3, "+8% multi-front coordination", { cv: 1.05 }),
        N("so5", "General Staff Architect", 1950, 3, "+10% institutional command", { cv: 1.06 }),
      ]),
      P("trainer", "Trainer", "#c9a24b", [
        N("tr1", "Unit Drills", 1900, 1, "+8% peacetime experience gain"),
        N("tr2", "Officer Mentorship", 1910, 2, "+trained subordinate officers"),
        N("tr3", "Training Camps", 1930, 2, "+10% recruit quality"),
        N("tr4", "Doctrine Instruction", 1950, 3, "faster doctrine adoption"),
        N("tr5", "Army Reformer", 1970, 3, "+12% force-wide training"),
      ]),
      P("hero", "Public Hero", "#e0b352", [
        N("ph1", "Inspirational Speeches", 1900, 1, "+national war support"),
        N("ph2", "National Morale Icon", 1940, 2, "+home-front morale"),
        N(
          "ph3",
          "Victory Symbol",
          1940,
          2,
          "+war support on victories",
          null,
          "High public popularity"
        ),
        N("ph4", "Media Presence", 1950, 3, "+public influence · political risk"),
        N("ph5", "Legendary Commander", 1960, 4, "+major war-support · politically dangerous"),
      ]),
    ],
  },
};

export interface SpecProfile {
  reputation: string;
  branch: "Army" | "Navy" | "Air";
  stats: Record<string, number>;
  personality: string[];
}
export const SPEC_PROFILE: Record<string, SpecProfile> = {
  armor: {
    reputation: "The Iron Planner",
    branch: "Army",
    stats: {
      leadership: 74,
      planning: 81,
      initiative: 69,
      logistics: 58,
      tactics: 76,
      operations: 83,
      coordination: 72,
      discipline: 66,
      adaptability: 64,
      political: 42,
    },
    personality: [
      "Methodical",
      "Armor-Minded",
      "Staff-Trained",
      "Cautious with Reserves",
      "Low Political Ambition",
    ],
  },
  offense: {
    reputation: "The Hammer",
    branch: "Army",
    stats: {
      leadership: 82,
      planning: 62,
      initiative: 88,
      logistics: 49,
      tactics: 80,
      operations: 71,
      coordination: 64,
      discipline: 58,
      adaptability: 74,
      political: 46,
    },
    personality: [
      "Aggressive",
      "Glory-Seeking",
      "High Initiative",
      "Reckless with Reserves",
      "Inspirational",
    ],
  },
  defense: {
    reputation: "The Anvil",
    branch: "Army",
    stats: {
      leadership: 71,
      planning: 84,
      initiative: 52,
      logistics: 68,
      tactics: 78,
      operations: 70,
      coordination: 66,
      discipline: 86,
      adaptability: 55,
      political: 60,
    },
    personality: [
      "Cautious",
      "Methodical",
      "Casualty-Averse",
      "Fortification-Minded",
      "Politically Loyal",
    ],
  },
  logi: {
    reputation: "The Quartermaster",
    branch: "Army",
    stats: {
      leadership: 64,
      planning: 79,
      initiative: 55,
      logistics: 92,
      tactics: 60,
      operations: 74,
      coordination: 78,
      discipline: 72,
      adaptability: 68,
      political: 58,
    },
    personality: [
      "Logistics-Minded",
      "Meticulous",
      "Sustainment-Focused",
      "Low Ambition",
      "Staff Officer",
    ],
  },
  naval: {
    reputation: "The Tide",
    branch: "Navy",
    stats: {
      leadership: 76,
      planning: 78,
      initiative: 71,
      logistics: 66,
      tactics: 74,
      operations: 80,
      coordination: 82,
      discipline: 70,
      adaptability: 67,
      political: 54,
    },
    personality: [
      "Blue-Water Minded",
      "Coordination-Focused",
      "Bold at Sea",
      "Technically-Minded",
      "Joint-Operations Advocate",
    ],
  },
};

export const SPEC_SEED: Record<string, string[]> = {
  armor: ["ar1", "ar2", "mn1"],
  offense: ["ag1", "ag2", "mn1"],
  defense: ["de1", "de2", "ca1"],
  logi: ["su1", "su2", "ma1"],
  naval: ["nl1", "nl2"],
};

export interface StatMeta {
  key: string;
  label: string;
  color: string;
  eff: string;
}
export const STAT_META: StatMeta[] = [
  { key: "leadership", label: "Leadership", color: "#ef8a8a", eff: "morale & cohesion under fire" },
  { key: "planning", label: "Planning", color: "#7ba3ec", eff: "set-piece operation quality" },
  {
    key: "initiative",
    label: "Initiative",
    color: "#86d978",
    eff: "seizing fleeting opportunities",
  },
  { key: "logistics", label: "Logistics", color: "#e0b352", eff: "supply & sustainment" },
  { key: "tactics", label: "Tactics", color: "#4fd1c5", eff: "battlefield execution" },
  { key: "operations", label: "Operations", color: "#b07fc4", eff: "theater-level maneuver" },
  { key: "coordination", label: "Coordination", color: "#5a86c4", eff: "joint & combined-arms" },
  { key: "discipline", label: "Discipline", color: "#c9a24b", eff: "order & reliability" },
  {
    key: "adaptability",
    label: "Adaptability",
    color: "#9aaa5a",
    eff: "responding when plans fail",
  },
  {
    key: "political",
    label: "Political Acumen",
    color: "#8a8a9a",
    eff: "navigating the command structure",
  },
];

/** A general as seen on the profile page (combat fields + dossier fields). */
export interface ProfileGeneral extends General {
  gtraits?: string[];
  formName?: string;
  assignment?: string;
  theater?: string;
  loyalty?: string;
  political?: string;
  unitCount?: number;
  country?: string;
}

/** Skill points a freshly-created character-general starts with (to set starting traits). */
export const STARTING_POINTS = 4;

/** Fallback era (decade year) for trait gating when the game year is unavailable. */
export const CUR_ERA_YEAR = 1940;

/**
 * Create a fresh general for a newly commissioned character — level 1, starting
 * points, nothing trained. No specialisation is chosen: it derives from the trait
 * nodes they go on to train (see `deriveSpec`).
 */
export function newGeneral(
  id: string,
  name: string,
  chop: string,
  /** The owning character's country. */
  country: string
): ProfileGeneral {
  return {
    id,
    name,
    chop,
    level: 1,
    xp: 0,
    pts: STARTING_POINTS,
    gtraits: [],
    formName: "Independent Command",
    assignment: "Field Command",
    theater: "—",
    loyalty: "Reliable",
    political: "Neutral",
    country,
  };
}

/**
 * A command-fit rating (40..98) for a commissioned general, from their progression:
 * level plus the number of trait nodes they have trained. Lives here (not in
 * generals.ts) because it reads the trained tree, the single source of a general's
 * capability.
 */
export function commanderFitFromGeneral(g: Pick<ProfileGeneral, "level" | "gtraits">): number {
  const fit = 50 + g.level * 8 + learnedOf(g).length * 2;
  return Math.max(40, Math.min(98, fit));
}

export function findTreeNode(
  id: string
): { catKey: string; cat: TraitTreeCategory; path: TraitTreePath; node: TraitTreeNode } | null {
  for (const ck in FULLTREE) {
    for (const p of FULLTREE[ck].paths) {
      const n = p.nodes.find((x) => x.id === id);
      if (n) return { catKey: ck, cat: FULLTREE[ck], path: p, node: n };
    }
  }
  return null;
}

export function sanitizeGtraits(ids: string[] | undefined): string[] {
  return (ids || []).filter((id) => !!findTreeNode(id));
}
/**
 * The tree nodes a general has actually trained.
 *
 * No spec fallback: specialisation is derived *from* what was learned, so seeding
 * learned *from* a spec would be circular. A general who has trained nothing has no
 * traits and the identity modifier — that is what their starting points are for.
 */
export function learnedOf(g: Pick<ProfileGeneral, "gtraits">): string[] {
  return sanitizeGtraits(g.gtraits);
}

/**
 * A general's combat modifiers, from the era-gated tree they actually trained.
 *
 * This is the only trait system. The retired `GENSPEC[spec].track` / `g.traits` pair
 * was read by battle math but written by nothing, so every general in the game
 * carried the identity modifier no matter what their player trained.
 */
export function generalMods(g: Pick<ProfileGeneral, "gtraits"> | null): TreeMods {
  return treeMods(g ? learnedOf(g) : []);
}

export type TraitStatus = "learned" | "available" | "locked" | "future";

/** Node status within its path (design nodeStatus): learned / future / locked / available. */
export function nodeStatus(
  learned: string[],
  path: TraitTreePath,
  node: TraitTreeNode,
  curEra: number
): TraitStatus {
  if (learned.indexOf(node.id) >= 0) return "learned";
  if (node.dec > curEra) return "future";
  const idx = path.nodes.findIndex((n) => n.id === node.id);
  const prevOwned = idx <= 0 || learned.indexOf(path.nodes[idx - 1].id) >= 0;
  if (!prevOwned) return "locked";
  return "available";
}

/**
 * The trait that must be learned before this one, or null when nothing blocks it.
 *
 * A trait path is a strict chain, so exactly one node can be the blocker. Named so
 * the UI can say WHICH trait is required rather than a bare "Earlier trait required",
 * matching what the doctrine tree already tells the Secretary of Defense.
 */
export function missingTraitPrerequisite(
  learned: string[],
  path: TraitTreePath,
  node: TraitTreeNode
): string | null {
  const idx = path.nodes.findIndex((n) => n.id === node.id);
  if (idx <= 0) return null;
  const prev = path.nodes[idx - 1];
  return learned.indexOf(prev.id) >= 0 ? null : prev.name;
}

export interface TrainResult {
  changed: boolean;
  general: ProfileGeneral;
  reason?: string;
}
/** Train a trait node: spend a skill point if the node is available (design train). */
export function trainNode(g: ProfileGeneral, id: string, curEra: number): TrainResult {
  const pts = g.pts || 0;
  if (pts < 1) return { changed: false, general: g, reason: "No command skill points." };
  const f = findTreeNode(id);
  if (!f) return { changed: false, general: g, reason: "Unknown trait." };
  const learned = learnedOf(g);
  const st = nodeStatus(learned, f.path, f.node, curEra);
  if (st !== "available") return { changed: false, general: g, reason: `Trait is ${st}.` };
  // Charge what the node says it costs. This checked `>= 1` and deducted a flat 1,
  // so the `cost` printed on every node — and on the Train button itself — was
  // decoration: a 4-point capstone came at the same price as a 1-point basic, and
  // a general holding one point could take anything in the tree.
  const cost = f.node.cost;
  if (pts < cost) {
    return {
      changed: false,
      general: g,
      reason: `${f.node.name} costs ${cost} points; you have ${pts}.`,
    };
  }
  const gtraits = learned.slice();
  if (gtraits.indexOf(id) < 0) gtraits.push(id);
  return { changed: true, general: { ...g, gtraits, pts: pts - cost } };
}

export interface TreeMods {
  cv: number;
  cvTrait: Record<string, number>;
  cas: number;
  enemy: number;
  supply: number;
  upkeep: number;
  ready: number;
}
/** Aggregate combat mods from a set of learned trait ids (design treeMods). */
export function treeMods(ids: string[]): TreeMods {
  const m: TreeMods = { cv: 1, cvTrait: {}, cas: 1, enemy: 1, supply: 0, upkeep: 1, ready: 0 };
  const set = new Set(ids || []);
  for (const ck in FULLTREE) {
    for (const p of FULLTREE[ck].paths) {
      for (const n of p.nodes) {
        if (!set.has(n.id) || !n.mods) continue;
        const e = n.mods;
        if (e.cv) m.cv *= e.cv;
        if (e.cvTrait) for (const k in e.cvTrait) m.cvTrait[k] = (m.cvTrait[k] || 1) * e.cvTrait[k];
        if (e.cas) m.cas *= e.cas;
        if (e.enemy) m.enemy *= e.enemy;
        if (e.supply) m.supply += e.supply;
        if (e.upkeep) m.upkeep *= e.upkeep;
        if (e.ready) m.ready += e.ready;
      }
    }
  }
  return m;
}

export function specProfile(spec: GeneralSpec | string): SpecProfile {
  return SPEC_PROFILE[spec] || SPEC_PROFILE.armor;
}

/** Whether a national doctrine (by node name) is adopted — drives trait "boost" glow. */
export function isNatActiveInDoctrine(
  adopted: Record<string, number>,
  name: string | null
): boolean {
  if (!name) return false;
  for (const c of DOCTRINE_CATS) {
    for (const p of c.paths) {
      for (const n of p.nodes) {
        if (n.name === name && adopted[doctrineKeyOf(p.id, n.d)]) return true;
      }
    }
  }
  return false;
}
