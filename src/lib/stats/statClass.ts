import { STAT_KEYS, type CharacterStats, type StatKey } from "./statsConstants";
import { STAT_META } from "./statMeta";

/**
 * Display-only "class" derived from a character's stat composition. A character
 * is named by their two strongest stats (21 distinct pairs), or "Generalist"
 * when no stat stands meaningfully above the rest. This is purely cosmetic —
 * nothing reads it for gameplay.
 */
export interface StatClass {
  /** Class title, e.g. "Statesman". */
  name: string;
  /** The two defining stat labels, e.g. ["Charisma", "Statecraft"]. */
  pillars: [string, string];
  /** Plain description of what the build is good at. */
  description: string;
}

/** Canonical "a+b" key, ordered by STAT_KEYS so the pair is direction-agnostic. */
function pairKey(a: StatKey, b: StatKey): string {
  return [a, b].sort((x, y) => STAT_KEYS.indexOf(x) - STAT_KEYS.indexOf(y)).join("+");
}

/** Title and description for each unordered pair of dominant stats. */
const CLASS_BY_PAIR: Record<string, { name: string; description: string }> = {
  "charisma+debate": {
    name: "Orator",
    description: "Wins voters through speeches and debate performance.",
  },
  "charisma+energy": {
    name: "Campaigner",
    description: "Runs a high-volume ground game and keeps influence rising.",
  },
  "charisma+fundraising": {
    name: "Power Broker",
    description: "Trades on relationships and a deep donor network.",
  },
  "charisma+businessAcumen": {
    name: "Magnate",
    description: "Pairs public appeal with a strong corporate base.",
  },
  "charisma+statecraft": {
    name: "Statesman",
    description: "Combines public support with control of the legislature.",
  },
  "charisma+intellect": {
    name: "Reformer",
    description: "Runs cheap, data-led campaigns with broad appeal.",
  },
  "debate+energy": {
    name: "Firebrand",
    description: "Picks a lot of fights and usually wins the exchange.",
  },
  "debate+fundraising": {
    name: "Agitator",
    description: "Turns sharp messaging into donations.",
  },
  "debate+businessAcumen": {
    name: "Dealmaker",
    description: "Argues well and runs profitable corporations.",
  },
  "debate+statecraft": {
    name: "Parliamentarian",
    description: "Strong on the floor in both debate and procedure.",
  },
  "debate+intellect": {
    name: "Polemicist",
    description: "Builds tight arguments backed by polling.",
  },
  "energy+fundraising": {
    name: "Bundler",
    description: "Runs frequent fundraisers and grows donors fast.",
  },
  "energy+businessAcumen": {
    name: "Operator",
    description: "Acts often and runs corporations efficiently.",
  },
  "energy+statecraft": {
    name: "Enforcer",
    description: "High activity with strong party-whip results.",
  },
  "energy+intellect": {
    name: "Tactician",
    description: "Acts often and keeps polling and campaign costs low.",
  },
  "fundraising+businessAcumen": {
    name: "Financier",
    description: "Raises money well and runs profitable corporations.",
  },
  "fundraising+statecraft": {
    name: "Machine Boss",
    description: "Funds a strong donor network and controls votes.",
  },
  "fundraising+intellect": {
    name: "Strategist",
    description: "Funds campaigns cheaply and spends efficiently.",
  },
  "businessAcumen+statecraft": {
    name: "Mogul",
    description: "Builds a corporate base and uses it in the legislature.",
  },
  "businessAcumen+intellect": {
    name: "Technocrat",
    description: "Runs corporations well and keeps costs low.",
  },
  "statecraft+intellect": {
    name: "Wonk",
    description: "Strong on procedure with cheap, data-led campaigns.",
  },
};

/**
 * A build counts as specialized only when its top stat clears the mean by a
 * clear margin; otherwise it's a Generalist (flat allocation).
 */
const SPECIALIZATION_MARGIN = 1;

export function deriveStatClass(stats: CharacterStats): StatClass {
  const ranked = STAT_KEYS.map((key) => ({ key, value: stats[key] ?? 1 })).sort(
    (a, b) => b.value - a.value || STAT_KEYS.indexOf(a.key) - STAT_KEYS.indexOf(b.key)
  );

  const mean = ranked.reduce((sum, s) => sum + s.value, 0) / ranked.length;
  if (ranked[0].value - mean < SPECIALIZATION_MARGIN) {
    return {
      name: "Generalist",
      pillars: ["Balanced", "Build"],
      description: "No standout stat. Flexible but not specialized.",
    };
  }

  const [first, second] = ranked;
  const entry = CLASS_BY_PAIR[pairKey(first.key, second.key)];
  return {
    name: entry?.name ?? "Generalist",
    pillars: [STAT_META[first.key].label, STAT_META[second.key].label],
    description: entry?.description ?? "No standout stat. Flexible but not specialized.",
  };
}
