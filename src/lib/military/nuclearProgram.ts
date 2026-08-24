import type { CountryId } from "@/lib/constants/countries";
import type { NuclearProgram } from "@/lib/db/types/nuclearProgram";

/**
 * The nuclear weapons programme: a small tech tree the defence seat climbs.
 *
 * Two kinds of node. DEVICE nodes are the physics ladder (fission → boosted →
 * thermonuclear → MIRV); each one is adopted only by conducting a nuclear
 * test, which is a world event: it spikes cold-war tension and everyone sees
 * it. DELIVERY nodes (bombers → IRBM → ICBM → SLBM) adopt quietly, like
 * doctrine. The device tier caps how many warheads a turn the complex can
 * produce; delivery legs are what make the stockpile a credible deterrent.
 *
 * Entry is gated three ways: the country must be in the capable set for the
 * era, the conventional doctrine tree's "Nuclear Delivery" node must be
 * adopted (that node used to unlock nothing; now it unlocks this), and the
 * Cold War subsystem must be on.
 */

export type NuclearNodeKind = "device" | "delivery";

export interface NuclearNode {
  key: string;
  name: string;
  desc: string;
  kind: NuclearNodeKind;
  /** First real-world year the node can be pursued. */
  yearAvailable: number;
  /** Node keys that must already be adopted. */
  requires: string[];
  /** Programme cost in defence-budget dollars (test cost for device nodes). */
  cost: number;
  /** Device nodes: warheads/turn production cap this tier unlocks. */
  productionCap?: number;
  /** Tension spike when the node lands (device nodes only: the test). */
  tensionSpike?: number;
  /** order.deterrence board shock when the node lands. */
  deterrenceShock?: number;
}

export const NUCLEAR_NODES: NuclearNode[] = [
  {
    key: "device-fission",
    name: "Fission Device",
    desc: "A working atomic bomb. The test announces the programme to the world.",
    kind: "device",
    yearAvailable: 1945,
    requires: [],
    cost: 12_000,
    productionCap: 2,
    tensionSpike: 9,
    deterrenceShock: 8,
  },
  {
    key: "device-boosted",
    name: "Boosted Fission",
    desc: "Tritium boosting: smaller packages, bigger yields, faster production.",
    kind: "device",
    yearAvailable: 1951,
    requires: ["device-fission"],
    cost: 9_000,
    productionCap: 4,
    tensionSpike: 6,
    deterrenceShock: 4,
  },
  {
    key: "device-thermo",
    name: "Thermonuclear Device",
    desc: "The hydrogen bomb. Yields measured in megatons.",
    kind: "device",
    yearAvailable: 1952,
    requires: ["device-boosted"],
    cost: 18_000,
    productionCap: 6,
    tensionSpike: 12,
    deterrenceShock: 8,
  },
  {
    key: "device-mirv",
    name: "MIRV Warheads",
    desc: "Several independently targeted warheads on one missile.",
    kind: "device",
    yearAvailable: 1968,
    requires: ["device-thermo", "delivery-icbm"],
    cost: 22_000,
    productionCap: 8,
    tensionSpike: 10,
    deterrenceShock: 6,
  },
  {
    key: "delivery-bombers",
    name: "Strategic Bombers",
    desc: "A bomber leg: the first way to put a device on a target.",
    kind: "delivery",
    yearAvailable: 1945,
    requires: ["device-fission"],
    cost: 6_000,
    deterrenceShock: 3,
  },
  {
    key: "delivery-irbm",
    name: "IRBM Force",
    desc: "Intermediate-range missiles: regional reach, minutes not hours.",
    kind: "delivery",
    yearAvailable: 1956,
    requires: ["delivery-bombers"],
    cost: 8_000,
    deterrenceShock: 3,
  },
  {
    key: "delivery-icbm",
    name: "ICBM Force",
    desc: "Intercontinental reach. No warning worth the name.",
    kind: "delivery",
    yearAvailable: 1959,
    requires: ["delivery-irbm"],
    cost: 14_000,
    deterrenceShock: 5,
  },
  {
    key: "delivery-slbm",
    name: "SLBM Deterrent",
    desc: "Missile submarines: the survivable second strike.",
    kind: "delivery",
    yearAvailable: 1960,
    requires: ["delivery-icbm"],
    cost: 16_000,
    deterrenceShock: 5,
  },
];

const NODE_BY_KEY = new Map(NUCLEAR_NODES.map((n) => [n.key, n]));

export function nuclearNode(key: string): NuclearNode | undefined {
  return NODE_BY_KEY.get(key);
}

/** Countries that can open a nuclear programme in the founding cold-war era. */
export const NUCLEAR_CAPABLE: readonly CountryId[] = ["US", "RU", "UK"];

/** The conventional doctrine node that gates programme entry. */
export const NUCLEAR_ENTRY_DOCTRINE_NODE = "Nuclear Delivery";

export type NuclearNodeStatus = "adopted" | "available" | "locked" | "future";

/** Status of one node given the adopted set and the current game year. */
export function nuclearNodeStatus(
  node: NuclearNode,
  adopted: Record<string, number>,
  year: number
): NuclearNodeStatus {
  if (adopted[node.key] != null) return "adopted";
  if (year < node.yearAvailable) return "future";
  if (node.requires.every((k) => adopted[k] != null)) return "available";
  return "locked";
}

/** Warheads/turn cap from the best adopted device tier (0 with no device). */
export function productionCapFor(adopted: Record<string, number>): number {
  let cap = 0;
  for (const n of NUCLEAR_NODES) {
    if (n.kind === "device" && adopted[n.key] != null && (n.productionCap ?? 0) > cap) {
      cap = n.productionCap ?? 0;
    }
  }
  return cap;
}

/** Cost per warhead, cheaper as the device tier matures. */
export function warheadUnitCost(adopted: Record<string, number>): number {
  const cap = productionCapFor(adopted);
  if (cap <= 0) return 0;
  // 800 at the fission tier, falling toward 350 at the MIRV tier.
  return Math.round(800 - (cap - 2) * 75);
}

/**
 * One turn of stockpile accrual: warheads built and dollars owed, given the
 * ordered rate, the adopted tier and the budget actually available.
 */
export function accrueWarheads(
  adopted: Record<string, number>,
  productionRate: number,
  budgetAvailable: number
): { built: number; cost: number } {
  const cap = productionCapFor(adopted);
  const rate = Math.max(0, Math.min(Math.floor(productionRate), cap));
  if (rate <= 0) return { built: 0, cost: 0 };
  const unit = warheadUnitCost(adopted);
  const affordable = unit > 0 ? Math.floor(budgetAvailable / unit) : 0;
  const built = Math.min(rate, affordable);
  return { built, cost: built * unit };
}

/**
 * Deterrence credibility 0-100: warheads discounted by how survivable the
 * delivery posture is. A big stockpile with no delivery leg deters nobody.
 */
export function deterrenceScore(adopted: Record<string, number>, warheads: number): number {
  const legs = NUCLEAR_NODES.filter((n) => n.kind === "delivery" && adopted[n.key] != null).length;
  if (legs === 0 || warheads <= 0) return 0;
  const legFactor = 0.4 + 0.15 * legs; // 0.55 one leg → 1.0 all four
  return Math.round(Math.min(100, Math.sqrt(warheads) * 10 * legFactor));
}

/** A bilateral alert requires two countries with deliverable, non-empty arsenals. */
export function nuclearStandoffPossible(
  programs: Array<Pick<NuclearProgram, "adopted" | "warheads">>
): boolean {
  return (
    programs.filter((program) => deterrenceScore(program.adopted, program.warheads) > 0).length >= 2
  );
}
