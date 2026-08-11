// National-doctrine tech tree, ported verbatim from the design's doctrineData.js
// (1900-2040 era doctrine). Pure data + logic; the authoring UI (Secretary of
// Defense Office → Doctrine tab) and combat modifiers consume it. Mockup-first:
// the adopted set + points persist client-side until gameState wiring lands.

export const DECADES = [
  "1900s",
  "1910s",
  "1920s",
  "1930s",
  "1940s",
  "1950s",
  "1960s",
  "1970s",
  "1980s",
  "1990s",
  "2000s",
  "2010s",
  "2020s",
  "2030s",
  "2040s",
] as const;

export const ERAS = [
  "Industrial War Foundations",
  "Great War Doctrine",
  "Interwar Experimentation",
  "Mechanization & Rearmament",
  "Total War",
  "Nuclear Age & Jet Warfare",
  "Counterinsurgency & Missiles",
  "Precision & Professionalization",
  "Air-Land Battle & Networks",
  "Post-Cold War Expeditionary",
  "Counterterror & Network-Centric",
  "Drone, Cyber & Hybrid",
  "Transparent Battlefield",
  "Autonomous & AI",
  "Fully Integrated Multi-Domain",
] as const;

export const ERASHORT = [
  "Industrial",
  "Great War",
  "Interwar",
  "Mechanization",
  "Total War",
  "Nuclear Age",
  "Counterinsurgency",
  "Precision",
  "Air-Land",
  "Expeditionary",
  "Network-Centric",
  "Cyber-Hybrid",
  "Multi-Domain",
  "Autonomous",
  "Integrated",
] as const;

/** Default "current era" from the design (1940s). Wiring derives this from game time. */
export const DESIGN_CURRENT_ERA = 4;

export const GRP: Record<string, { label: string; color: string }> = {
  army: { label: "Army", color: "#5a86c4" },
  navy: { label: "Navy", color: "#2ba0a8" },
  air: { label: "Air", color: "#b07fc4" },
  log: { label: "Logistics", color: "#c9a24b" },
  cmd: { label: "Command", color: "#6a8fd4" },
};

export interface DoctrineMods {
  cvAll?: number;
  cvDom?: Record<string, number>;
  cvTrait?: Record<string, number>;
  upkeep?: number;
  supply?: number;
  xp?: number;
  ready?: number;
  deep?: number;
  joint?: number;
}

export interface DoctrineNode {
  d: number; // decade index
  name: string;
  eff: string; // effect description
  cost: number; // doctrine points
  p?: string; // active-effect pill label
  g?: string; // GRP key for the pill
  m?: DoctrineMods; // structured combat mods
  req?: string[]; // named prerequisites (by node name)
  x?: string[]; // conflicts-with (by node name)
  unlocks?: string[];
  desc?: string;
}

export interface DoctrinePath {
  id: string;
  name: string;
  color: string;
  nodes: DoctrineNode[];
}

export interface DoctrineCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  paths: DoctrinePath[];
}

// N(decadeIndex, name, effect, cost, extra) — matches doctrineData.js N().
function N(
  d: number,
  name: string,
  eff: string,
  cost: number,
  extra?: Partial<DoctrineNode>
): DoctrineNode {
  return { d, name, eff, cost, ...(extra || {}) };
}

export const DOCTRINE_CATS: DoctrineCategory[] = [
  {
    id: "land",
    name: "Land Warfare",
    color: "#5a86c4",
    icon: "M4 20h16M6 20V9l6-4 6 4v11M9 20v-5h6v5",
    paths: [
      {
        id: "maneuver",
        name: "Maneuver Warfare",
        color: "#5a86c4",
        nodes: [
          N(0, "General Staff Planning", "+4% command efficiency · +5% mobilization planning", 1, {
            p: "+4% Command",
            g: "cmd",
            m: { joint: 1.04 },
          }),
          N(1, "Infiltration Tactics", "+6% breakthrough vs entrenched enemies", 1),
          N(2, "Motorized Maneuver Theory", "Unlocks motorized doctrine bonuses", 1),
          N(3, "Armored Spearhead", "+12% armor combat value · +8% breakthrough", 2, {
            p: "+12% Armor CV",
            g: "army",
            m: { cvTrait: { armored: 1.12 } },
            unlocks: ["Air-Land Battle"],
          }),
          N(4, "Combined-Arms Warfare", "+8% ground combat value · +10% arms coordination", 2, {
            p: "+8% Ground CV",
            g: "army",
            m: { cvDom: { ground: 1.08 } },
          }),
          N(5, "Armored Battle Groups", "+8% mechanized readiness · +6% operational mobility", 2, {
            m: { cvTrait: { armored: 1.05 } },
          }),
          N(6, "Airmobile Operations", "Helicopter-supported maneuver · +8% rapid response", 3),
          N(7, "Anti-Armor Maneuver", "−10% enemy armor advantage · +6% defensive mobility", 3),
          N(8, "Air-Land Battle", "+8% force-wide CV · +12% CAS coordination", 3, {
            m: { cvAll: 1.08 },
            req: ["Armored Spearhead", "Close Air Support"],
            x: ["Static Defense Doctrine"],
            unlocks: ["Networked Brigade Combat", "Multi-Domain Maneuver"],
            desc: "Integrates fast-moving ground formations with air support, interdiction, and deep operational planning.",
          }),
          N(
            9,
            "Rapid Ground Intervention",
            "+15% deployment speed · +8% short-war effectiveness",
            3
          ),
          N(
            10,
            "Networked Brigade Combat",
            "+10% command intelligence · +8% urban coordination",
            4,
            { m: { cvAll: 1.05 } }
          ),
          N(
            11,
            "Distributed Maneuver",
            "−10% losses from precision strikes · +6% survivability",
            4
          ),
          N(
            12,
            "Drone-Assisted Maneuver",
            "+12% recon · +10% artillery spotting · +8% breakthrough",
            4,
            { m: { cvAll: 1.06 } }
          ),
          N(
            13,
            "Human-Machine Maneuver Teams",
            "+10% combat value if autonomous systems available",
            5,
            { m: { cvAll: 1.1 } }
          ),
          N(14, "Multi-Domain Maneuver", "+15% joint operations across land/air/cyber/space", 5, {
            m: { joint: 1.15, cvAll: 1.05 },
          }),
        ],
      },
      {
        id: "firepower",
        name: "Firepower Warfare",
        color: "#d4af37",
        nodes: [
          N(0, "Heavy Gun Batteries", "+6% artillery combat value", 1, {
            p: "+6% Artillery",
            g: "army",
            m: { cvTrait: { longrange: 1.06 } },
          }),
          N(1, "Creeping Barrage", "+10% attack support · +10% ammunition use", 1),
          N(2, "Artillery Staff Schools", "+6% artillery coordination", 1),
          N(3, "Mobile Artillery", "+8% artillery mobility", 2),
          N(4, "Integrated Fires", "+10% artillery/air coordination", 2, {
            m: { cvTrait: { longrange: 1.08 } },
          }),
          N(5, "Rocket Artillery Formations", "+8% area firepower", 2),
          N(6, "Fire Support Bases", "+8% defensive fire support", 3),
          N(7, "Counter-Battery Radar", "−10% enemy artillery effectiveness", 3),
          N(8, "Precision Fire Support", "+10% high-value target damage", 3),
          N(9, "GPS-Guided Fires", "+10% strike accuracy", 3),
          N(10, "Persistent Fire Support", "+8% support in long operations", 4),
          N(11, "Sensor-to-Shooter Networks", "+10% artillery response speed", 4),
          N(12, "Drone-Corrected Artillery", "+12% artillery accuracy if drone recon available", 4),
          N(13, "Autonomous Fire Direction", "+10% fire mission speed", 5),
          N(14, "Adaptive Fires Grid", "+15% multi-domain strike coordination", 5),
        ],
      },
      {
        id: "defensive",
        name: "Defensive Warfare",
        color: "#4ea87a",
        nodes: [
          N(0, "Field Fortifications", "+6% defense when prepared", 1, {
            p: "+6% Defense",
            g: "army",
          }),
          N(1, "Trench Systems", "+12% defense · −5% mobility", 1),
          N(2, "Elastic Defense Theory", "Lower casualties defending · may give ground", 1),
          N(3, "Anti-Tank Networks", "+10% defense against armor", 2),
          N(4, "Defense in Depth", "−12% enemy breakthrough chance", 2),
          N(5, "Mechanized Defense", "+8% defensive mobility", 2),
          N(6, "Layered Air Defense Support", "−8% losses from enemy air support", 3),
          N(7, "Anti-Armor Missile Teams", "+10% defense against armored units", 3),
          N(8, "Integrated Defensive Network", "+8% defense · +8% command coordination", 3, {
            x: ["Air-Land Battle"],
          }),
          N(9, "Peace Enforcement Defense", "+8% control in limited interventions", 3),
          N(10, "Urban Defensive Operations", "+10% defense in cities", 4),
          N(11, "Anti-Access Ground Defense", "+10% defense vs expeditionary attacks", 4),
          N(12, "Dispersed Defense", "−12% losses from drones and precision fires", 4),
          N(13, "Autonomous Defensive Screens", "+10% early warning and defensive reaction", 5),
          N(14, "Self-Adapting Defense Grid", "+15% defense if command network functional", 5),
        ],
      },
      {
        id: "infantry",
        name: "Infantry-Centric Warfare",
        color: "#4fb0c4",
        nodes: [
          N(0, "Mass Infantry Formations", "+10% manpower deployment · −5% avg training", 1, {
            x: ["Professional Volunteer Force"],
          }),
          N(1, "Assault Troop Training", "+8% infantry attack in fortified terrain", 1),
          N(2, "Light Infantry Doctrine", "−8% supply use for infantry", 1, { m: { supply: 6 } }),
          N(3, "Mountain & Jungle Schools", "+12% rough terrain combat", 2),
          N(4, "Urban Siege Doctrine", "+10% urban attack and defense", 2),
          N(5, "Professional Infantry Cadre", "+8% infantry experience gain", 2, {
            m: { xp: 1.08 },
          }),
          N(6, "Jungle Warfare Doctrine", "+10% jungle combat · +6% counterinsurgency", 3),
          N(7, "Mechanized Infantry Integration", "+8% infantry coordination with armor", 3),
          N(8, "Advanced Small Unit Tactics", "+8% infantry combat value", 3, {
            m: { cvDom: { ground: 1.05 } },
          }),
          N(9, "Peacekeeping Infantry Doctrine", "+10% occupation stability", 3),
          N(10, "Counter-IED Infantry Training", "−10% losses from insurgency/IEDs", 4),
          N(11, "Hybrid War Infantry", "+8% performance in gray-zone conflicts", 4),
          N(
            12,
            "Territorial Defense Networks",
            "+12% homeland defense · +8% resistance support",
            4
          ),
          N(
            13,
            "Augmented Infantry Systems",
            "+10% infantry value if advanced equipment available",
            5
          ),
          N(14, "Human-Machine Infantry Teams", "+12% infantry/recon coordination", 5),
        ],
      },
    ],
  },
  {
    id: "naval",
    name: "Naval Warfare",
    color: "#2ba0a8",
    icon: "M3 16h18l-2 4H5l-2-4zm3-2V9h12v5M10 9V5h4v4",
    paths: [
      {
        id: "bluewater",
        name: "Blue-Water Navy",
        color: "#2ba0a8",
        nodes: [
          N(0, "Dreadnought Line", "+8% capital ship combat value", 1, {
            x: ["Coastal Defense Navy"],
          }),
          N(3, "Fast Battleship Groups", "+8% surface fleet speed & CV", 2),
          N(4, "Surface Task Forces", "+9% naval combat value", 2, {
            p: "+9% Naval CV",
            g: "navy",
            m: { cvDom: { naval: 1.09 } },
          }),
          N(8, "Aegis Surface Warfare", "+10% fleet air defense", 3),
          N(12, "Distributed Maritime Ops", "+10% survivability vs missiles", 4),
        ],
      },
      {
        id: "carrier",
        name: "Carrier Doctrine",
        color: "#4fb0c4",
        nodes: [
          N(2, "Carrier Experiments", "Unlocks naval aviation", 1),
          N(4, "Carrier Task Forces", "+10% carrier strike reach", 2, {
            m: { cvDom: { naval: 1.1 } },
          }),
          N(8, "Supercarrier Air Wing", "+12% sustained air power", 3),
          N(13, "Unmanned Carrier Air", "+10% strike sortie rate", 5),
        ],
      },
      {
        id: "subsea",
        name: "Submarine & Sea Denial",
        color: "#5a86c4",
        nodes: [
          N(1, "Submarine Warfare", "+10% commerce raiding", 1),
          N(6, "Nuclear Attack Subs", "+12% sea denial", 3),
          N(10, "Quiet Sub Networks", "+10% stealth patrol reach", 4),
        ],
      },
      {
        id: "coastal",
        name: "Coastal Defense Navy",
        color: "#4ea87a",
        nodes: [
          N(0, "Coastal Fortress Fleet", "+10% littoral defense", 1, { x: ["Blue-Water Navy"] }),
          N(7, "Missile Boat Swarm", "+10% coastal denial", 3),
          N(12, "A2/AD Sea Denial", "+12% area denial vs expeditionary fleets", 4),
        ],
      },
    ],
  },
  {
    id: "air",
    name: "Air Warfare",
    color: "#b07fc4",
    icon: "M12 3l2 8 7 3v2l-7-1-1 5 2 2v1l-3-1-3 1v-1l2-2-1-5-7 1v-2l7-3 2-8z",
    paths: [
      {
        id: "airsup",
        name: "Air Superiority",
        color: "#b07fc4",
        nodes: [
          N(3, "Fighter Doctrine", "+8% air combat value", 2, { m: { cvDom: { air: 1.08 } } }),
          N(5, "Jet Interceptors", "+10% intercept speed", 2),
          N(8, "Beyond-Visual-Range", "+12% engagement range", 3),
          N(13, "Autonomous Air Combat", "+10% sortie effectiveness", 5),
        ],
      },
      {
        id: "cas",
        name: "Close Air Support",
        color: "#a06fd4",
        nodes: [
          N(4, "Ground Attack Wings", "+8% CAS damage", 2),
          N(8, "Air-Land Integration", "Enables Air-Land Battle · +10% CAS coordination", 3, {
            unlocks: ["Air-Land Battle"],
            x: ["Strategic Bombing Focus"],
          }),
          N(11, "Persistent CAS Drones", "+10% loiter support", 4),
        ],
      },
      {
        id: "strat",
        name: "Strategic Bombing",
        color: "#d16a6a",
        nodes: [
          N(4, "Strategic Bombing Campaigns", "+10% enemy industry damage", 2, {
            x: ["Tactical Air Support Focus"],
          }),
          N(5, "Nuclear Delivery", "Unlocks strategic deterrence", 4),
          N(9, "Precision Standoff", "+10% standoff strike accuracy", 3),
        ],
      },
      {
        id: "iads",
        name: "Integrated Air Defense",
        color: "#4fb0c4",
        nodes: [
          N(5, "SAM Networks", "+10% air defense", 2),
          N(8, "Layered IADS", "+12% integrated air defense", 3),
          N(12, "Counter-Drone Air Defense", "−12% losses from drones", 4),
        ],
      },
    ],
  },
  {
    id: "exped",
    name: "Expeditionary Warfare",
    color: "#d98a4a",
    icon: "M4 12h16M4 12l4-4M4 12l4 4M20 6v12",
    paths: [
      {
        id: "amphib",
        name: "Amphibious Assault",
        color: "#d98a4a",
        nodes: [
          N(4, "Amphibious Invasion Doctrine", "+10% landing effectiveness", 2, {
            m: { cvDom: { marine: 1.1 } },
          }),
          N(9, "Rapid Amphibious Response", "+12% expeditionary speed", 3),
        ],
      },
      {
        id: "expedops",
        name: "Expeditionary Warfare",
        color: "#e0a35a",
        nodes: [
          N(9, "Expeditionary Task Forces", "+10% out-of-area operations", 3),
          N(10, "Rapid Global Deployment", "+12% deployment reach", 4),
        ],
      },
      {
        id: "littoral",
        name: "Island & Littoral Warfare",
        color: "#c47f4a",
        nodes: [
          N(4, "Island-Hopping", "+10% island seizure", 2),
          N(12, "Littoral Combat Groups", "+10% littoral maneuver", 4),
        ],
      },
      {
        id: "magtf",
        name: "Marine Air-Ground Task Force",
        color: "#d4934a",
        nodes: [
          N(8, "MAGTF Doctrine", "+8% combined marine ops", 3, { m: { cvDom: { marine: 1.08 } } }),
          N(11, "Distributed MAGTF", "+10% dispersed operations", 4),
        ],
      },
    ],
  },
  {
    id: "mobil",
    name: "Mobilization & Logistics",
    color: "#c9a24b",
    icon: "M3 7h13v10H3zM16 10h3l2 3v4h-5M6 20a2 2 0 100-4 2 2 0 000 4zm11 0a2 2 0 100-4 2 2 0 000 4z",
    paths: [
      {
        id: "industrial",
        name: "Industrial Mobilization",
        color: "#c9a24b",
        nodes: [
          N(1, "War Industry Conversion", "+10% wartime production", 1),
          N(4, "Mass Production", "−12% force upkeep", 2, {
            p: "−12% Upkeep",
            g: "log",
            m: { upkeep: 0.88 },
            x: ["Limited War Economy"],
          }),
        ],
      },
      {
        id: "logistics",
        name: "Strategic Logistics",
        color: "#e0b352",
        nodes: [
          N(4, "Global Supply Chains", "+20 supply throughput", 2, {
            p: "+20 Supply",
            g: "log",
            m: { supply: 20 },
          }),
          N(12, "Contested Logistics", "+12% supply under attack", 4, { m: { supply: 12 } }),
        ],
      },
      {
        id: "reserve",
        name: "Reserve System",
        color: "#b8923f",
        nodes: [
          N(0, "National Reserve", "+10% mobilizable manpower", 1),
          N(7, "Professional Reserve", "+8% reserve readiness", 3, { m: { ready: 2 } }),
        ],
      },
      {
        id: "readiness",
        name: "Maintenance & Readiness",
        color: "#d4af37",
        nodes: [
          N(7, "Readiness Reform", "+8% peacetime readiness", 3, { m: { ready: 2 } }),
          N(11, "Predictive Maintenance", "−10% downtime", 4, { m: { ready: 2 } }),
        ],
      },
    ],
  },
  {
    id: "strategic",
    name: "Strategic Warfare",
    color: "#d16a6a",
    icon: "M12 2c2 2 3 5 3 9l-1 7h-4l-1-7c0-4 1-7 3-9zM7 15l-2 4m12-4l2 4",
    paths: [
      {
        id: "deepstrike",
        name: "Deep Strike",
        color: "#d16a6a",
        nodes: [
          N(8, "Deep Battle Strike", "+10% enemy rear disruption", 3, { m: { deep: 0.2 } }),
          N(12, "Long-Range Precision Fires", "+12% standoff strike", 4, { m: { deep: 0.3 } }),
        ],
      },
      {
        id: "missile",
        name: "Missile Warfare",
        color: "#e07a7a",
        nodes: [
          N(5, "Ballistic Missiles", "Unlocks missile deterrence", 4),
          N(9, "Cruise Missile Doctrine", "+10% precision standoff", 3),
        ],
      },
      {
        id: "cyber",
        name: "Cyber & Electronic Warfare",
        color: "#a06fd4",
        nodes: [
          N(10, "Network Attack", "+10% enemy C2 disruption", 3),
          N(11, "Cyber Warfare Command", "+12% cyber operations", 4),
        ],
      },
      {
        id: "isr",
        name: "Drone & ISR Warfare",
        color: "#4fb0c4",
        nodes: [
          N(10, "UAV Reconnaissance", "+10% battlefield awareness", 3),
          N(12, "Drone Swarm Doctrine", "+12% saturation strike", 4),
        ],
      },
    ],
  },
  {
    id: "irregular",
    name: "Irregular & Security",
    color: "#8a9a4a",
    icon: "M12 2l3 6 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z",
    paths: [
      {
        id: "guerrilla",
        name: "Guerrilla Warfare",
        color: "#8a9a4a",
        nodes: [
          N(6, "Guerrilla Doctrine", "+10% insurgent effectiveness", 3, {
            x: ["Conventional Professionalization"],
          }),
          N(11, "Hybrid Resistance", "+10% gray-zone resistance", 4),
        ],
      },
      {
        id: "coin",
        name: "Counterinsurgency",
        color: "#9aaa5a",
        nodes: [
          N(6, "COIN Doctrine", "+8% counterinsurgency", 3),
          N(10, "Population-Centric COIN", "+10% stability operations", 4),
        ],
      },
      {
        id: "sof",
        name: "Special Operations",
        color: "#c9a24b",
        nodes: [
          N(6, "Special Forces", "+10% special operations", 3),
          N(10, "Global SOF Network", "+12% strategic raids", 4),
        ],
      },
      {
        id: "intsec",
        name: "Internal Security",
        color: "#b8923f",
        nodes: [
          N(3, "State Security Apparatus", "+8% internal control", 2),
          N(11, "Domestic Cyber Security", "+10% infrastructure defense", 4),
        ],
      },
    ],
  },
  {
    id: "command",
    name: "Command & Intelligence",
    color: "#6a8fd4",
    icon: "M12 3l8 4v6c0 4-3 7-8 8-5-1-8-4-8-8V7l8-4z",
    paths: [
      {
        id: "joint",
        name: "Joint Command",
        color: "#6a8fd4",
        nodes: [
          N(4, "Joint Operations", "+8% joint operations", 2, {
            p: "+8% Joint Ops",
            g: "cmd",
            m: { joint: 1.08 },
          }),
          N(8, "Joint Task Force", "+10% multi-branch coordination", 3, { m: { joint: 1.1 } }),
        ],
      },
      {
        id: "intel",
        name: "Reconnaissance & Intelligence",
        color: "#5a86c4",
        nodes: [
          N(5, "Signals Intelligence", "+8% enemy intelligence", 2),
          N(10, "Fusion Intelligence", "+12% intelligence fusion", 4),
        ],
      },
      {
        id: "comms",
        name: "Communications",
        color: "#4fb0c4",
        nodes: [
          N(0, "Field Telegraph", "+5% command coordination", 1, { m: { joint: 1.03 } }),
          N(8, "Tactical Data Links", "+10% real-time coordination", 3, { m: { joint: 1.06 } }),
        ],
      },
      {
        id: "mission",
        name: "Mission Command",
        color: "#b07fc4",
        nodes: [
          N(1, "Auftragstaktik", "+8% subordinate initiative", 1, { x: ["Centralized Command"] }),
          N(9, "Mission Command Reform", "+10% decentralized response", 3),
        ],
      },
    ],
  },
];

export const DEFAULT_ADOPTED: Record<string, number> = {
  "maneuver-0": 1,
  "maneuver-1": 1,
  "maneuver-2": 1,
  "maneuver-3": 1,
  "maneuver-4": 1,
  "firepower-0": 1,
  "firepower-1": 1,
  "defensive-0": 1,
  "infantry-0": 1,
  "joint-4": 1,
  "industrial-4": 1,
  "logistics-4": 1,
};

export const DEFAULT_POINTS = 12;

export type AdoptedSet = Record<string, number>;
export type NodeStatus = "adopted" | "available" | "locked" | "future";

export function keyOf(pathId: string, d: number): string {
  return `${pathId}-${d}`;
}

/** The most recent decade index (all eras available). */
export function latestEraIndex(): number {
  return DECADES.length - 1;
}

/** Game year → doctrine era index (decade bucket), clamped to the DECADES range. */
export function doctrineEraForYear(year: number): number {
  return Math.max(0, Math.min(DECADES.length - 1, Math.floor((year - 1900) / 10)));
}

export function findNode(
  key: string
): { cat: DoctrineCategory; path: DoctrinePath; node: DoctrineNode } | null {
  for (const cat of DOCTRINE_CATS) {
    for (const path of cat.paths) {
      const node = path.nodes.find((n) => keyOf(path.id, n.d) === key);
      if (node) return { cat, path, node };
    }
  }
  return null;
}

/**
 * Returns the names of prerequisite nodes that are not yet adopted for a given
 * node. Checks both the explicit `req` list and the implicit in-path lower-decade
 * predecessor. Returns an empty array when all prerequisites are satisfied.
 */
export function missingPrerequisites(
  adopted: AdoptedSet,
  path: DoctrinePath,
  node: DoctrineNode
): string[] {
  const missing: string[] = [];
  const prev = prevNode(path, node.d);
  if (prev && !adopted[keyOf(path.id, prev.d)]) {
    missing.push(prev.name);
  }
  if (node.req) {
    for (const r of node.req) {
      if (!isAdoptedByName(adopted, r)) missing.push(r);
    }
  }
  return missing;
}

/** Nearest lower-decade node in the same path (the in-path prerequisite). */
export function prevNode(path: DoctrinePath, d: number): DoctrineNode | null {
  let best: DoctrineNode | null = null;
  for (const n of path.nodes) {
    if (n.d < d && (!best || n.d > best.d)) best = n;
  }
  return best;
}

export function isAdoptedByName(adopted: AdoptedSet, name: string): boolean {
  for (const cat of DOCTRINE_CATS) {
    for (const path of cat.paths) {
      for (const n of path.nodes) {
        if (n.name === name && adopted[keyOf(path.id, n.d)]) return true;
      }
    }
  }
  return false;
}

export function nodeStatus(
  adopted: AdoptedSet,
  path: DoctrinePath,
  node: DoctrineNode,
  currentEra: number
): NodeStatus {
  const key = keyOf(path.id, node.d);
  if (adopted[key]) return "adopted";
  if (node.d > currentEra) return "future";
  const prev = prevNode(path, node.d);
  if (prev && !adopted[keyOf(path.id, prev.d)]) return "locked";
  if (node.req) {
    for (const r of node.req) {
      if (!isAdoptedByName(adopted, r)) return "locked";
    }
  }
  return "available";
}

export interface DoctrineState {
  adopted: AdoptedSet;
  points: number;
}

export interface AdoptResult {
  changed: boolean;
  state: DoctrineState;
  reason?: string;
}

/** Attempt to adopt a node; pure — returns a new state or an unchanged one + reason. */
export function adoptNode(state: DoctrineState, key: string, currentEra: number): AdoptResult {
  const f = findNode(key);
  if (!f) return { changed: false, state, reason: "Unknown doctrine." };
  const st = nodeStatus(state.adopted, f.path, f.node, currentEra);
  if (st === "adopted") return { changed: false, state, reason: "Already adopted." };
  if (st === "future")
    return { changed: false, state, reason: `Requires the ${DECADES[f.node.d]} era.` };
  if (st === "locked") {
    const prev = prevNode(f.path, f.node.d);
    const need = prev ? prev.name : f.node.req ? f.node.req[0] : "a prior doctrine";
    return { changed: false, state, reason: `Requires ${need} first.` };
  }
  if (state.points < f.node.cost)
    return { changed: false, state, reason: "Not enough doctrine points." };
  return {
    changed: true,
    state: { adopted: { ...state.adopted, [key]: 1 }, points: state.points - f.node.cost },
  };
}

/** Adopted node count within a category (for the category nav). */
export function adoptedCount(adopted: AdoptedSet, catId: string): number {
  const cat = DOCTRINE_CATS.find((c) => c.id === catId);
  if (!cat) return 0;
  let n = 0;
  for (const path of cat.paths) {
    for (const node of path.nodes) {
      if (adopted[keyOf(path.id, node.d)]) n++;
    }
  }
  return n;
}

/** Total node count within a category. */
export function categoryTotal(catId: string): number {
  const cat = DOCTRINE_CATS.find((c) => c.id === catId);
  return cat ? cat.paths.reduce((a, p) => a + p.nodes.length, 0) : 0;
}

export interface NatMods {
  cvAll: number;
  cvDom: Record<string, number>;
  cvTrait: Record<string, number>;
  upkeep: number;
  supply: number;
  xp: number;
  ready: number;
  deep: number;
  joint: number;
}

/** Force-wide combat modifiers from an adopted set (doctrineData.js natMods). */
export function natMods(adopted: AdoptedSet): NatMods {
  const m: NatMods = {
    cvAll: 1,
    cvDom: {},
    cvTrait: {},
    upkeep: 1,
    supply: 0,
    xp: 1,
    ready: 0,
    deep: 0,
    joint: 1,
  };
  for (const cat of DOCTRINE_CATS) {
    for (const path of cat.paths) {
      for (const node of path.nodes) {
        if (!adopted[keyOf(path.id, node.d)] || !node.m) continue;
        const e = node.m;
        if (e.cvAll) m.cvAll *= e.cvAll;
        if (e.cvDom) for (const k in e.cvDom) m.cvDom[k] = (m.cvDom[k] || 1) * e.cvDom[k];
        if (e.cvTrait) for (const k in e.cvTrait) m.cvTrait[k] = (m.cvTrait[k] || 1) * e.cvTrait[k];
        if (e.upkeep) m.upkeep *= e.upkeep;
        if (e.supply) m.supply += e.supply;
        if (e.xp) m.xp *= e.xp;
        if (e.ready) m.ready += e.ready;
        if (e.deep) m.deep += e.deep;
        if (e.joint) m.joint *= e.joint;
      }
    }
  }
  return m;
}

/** Active-effect pills from an adopted set (doctrineData.js pills). */
export function pills(adopted: AdoptedSet): { label: string; color: string; src: string }[] {
  const out: { label: string; color: string; src: string }[] = [];
  for (const cat of DOCTRINE_CATS) {
    for (const path of cat.paths) {
      for (const node of path.nodes) {
        if (node.p && adopted[keyOf(path.id, node.d)]) {
          const g = (node.g && GRP[node.g]) || { color: "#8a8a9a" };
          out.push({
            label: node.p,
            color: g.color,
            src: `Source: ${node.name} (${DECADES[node.d]})`,
          });
        }
      }
    }
  }
  return out;
}
