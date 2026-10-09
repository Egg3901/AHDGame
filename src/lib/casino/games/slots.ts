import { pickWeighted, type Rng } from "../rng";

/**
 * Three-reel weighted slot machine, ported from the POWER bot paytable.
 * Multipliers are the total return on the stake (2.5 returns 2.5x the wager).
 * POWER's table returned 161% of every stake. Wild weight and the small
 * doubles were cut to bring it to about 95%; slots.test.ts pins the exact
 * figure, so retune there and not by feel.
 */
export const SLOT_SYMBOLS = [
  "CHERRY",
  "LEMON",
  "ORANGE",
  "GRAPE",
  "BELL",
  "STAR",
  "SEVEN",
  "DIAMOND",
  "WILD",
] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

export const SLOT_WEIGHTS: Record<SlotSymbol, number> = {
  CHERRY: 18,
  LEMON: 15,
  ORANGE: 14,
  GRAPE: 12,
  BELL: 15,
  STAR: 12,
  SEVEN: 10,
  DIAMOND: 6,
  WILD: 2,
};

export const SLOT_TRIPLES: Record<SlotSymbol, { multiplier: number; name: string }> = {
  WILD: { multiplier: 250, name: "Wild Jackpot" },
  DIAMOND: { multiplier: 180, name: "Diamond Jackpot" },
  SEVEN: { multiplier: 90, name: "Lucky Sevens" },
  STAR: { multiplier: 40, name: "Star Power" },
  BELL: { multiplier: 20, name: "Bell Ringer" },
  GRAPE: { multiplier: 10, name: "Grape Harvest" },
  ORANGE: { multiplier: 6, name: "Orange Burst" },
  LEMON: { multiplier: 3.5, name: "Lemon Drop" },
  CHERRY: { multiplier: 2.5, name: "Cherry Bomb" },
};

export const SLOT_DOUBLES: Record<Exclude<SlotSymbol, "WILD">, number> = {
  DIAMOND: 3.5,
  SEVEN: 2.5,
  STAR: 1.1,
  BELL: 0.8,
  GRAPE: 0.5,
  ORANGE: 0.4,
  LEMON: 0.3,
  CHERRY: 0.25,
};

const SPECIAL_COMBOS: Record<string, { multiplier: number; name: string }> = {
  "CHERRY,CHERRY,BELL": { multiplier: 5, name: "Cherry Bells" },
  "BELL,CHERRY,CHERRY": { multiplier: 5, name: "Cherry Bells" },
  "STAR,SEVEN,STAR": { multiplier: 12, name: "Lucky Star" },
  "DIAMOND,WILD,DIAMOND": { multiplier: 60, name: "Wild Diamonds" },
  "SEVEN,WILD,SEVEN": { multiplier: 50, name: "Wild Sevens" },
};

/** A wild completing a line lifts the payout by this factor. */
const WILD_TRIPLE_BONUS = 1.6;
const WILD_DOUBLE_BONUS = 1.3;

/** Diamond, diamond, wild: the best line once the wild bonus applies. */
export const SLOT_MAX_MULTIPLIER = round2(SLOT_TRIPLES.DIAMOND.multiplier * WILD_TRIPLE_BONUS);

export interface SlotSpin {
  reels: [SlotSymbol, SlotSymbol, SlotSymbol];
  multiplier: number;
  kind: "special" | "triple" | "double" | "none";
  name: string | null;
  jackpot: boolean;
}

const REEL = SLOT_SYMBOLS.map((value) => ({ value, weight: SLOT_WEIGHTS[value] }));

function matches(a: SlotSymbol, b: SlotSymbol): boolean {
  return a === "WILD" || b === "WILD" || a === b;
}

function leadSymbol(symbols: SlotSymbol[]): SlotSymbol {
  return symbols.find((s) => s !== "WILD") ?? "WILD";
}

/** Score a fixed set of reels. Exported so the expected-return test can enumerate every stop. */
export function scoreSlotReels(reels: [SlotSymbol, SlotSymbol, SlotSymbol]): SlotSpin {
  const special = SPECIAL_COMBOS[reels.join(",")];
  if (special) {
    return {
      reels,
      multiplier: special.multiplier,
      kind: "special",
      name: special.name,
      jackpot: false,
    };
  }

  const [a, b, c] = reels;
  const hasWild = reels.includes("WILD");
  if (matches(a, b) && matches(b, c) && matches(a, c)) {
    const lead = leadSymbol(reels);
    const triple = SLOT_TRIPLES[lead];
    const bonus = hasWild && lead !== "WILD" ? WILD_TRIPLE_BONUS : 1;
    return {
      reels,
      multiplier: round2(triple.multiplier * bonus),
      kind: "triple",
      name: triple.name,
      jackpot: lead === "DIAMOND" || lead === "WILD",
    };
  }

  let best = 0;
  let bestName: string | null = null;
  for (const [x, y] of [
    [a, b],
    [b, c],
    [a, c],
  ] as const) {
    if (!matches(x, y)) continue;
    const lead = leadSymbol([x, y]);
    // Two wilds and a mismatch: the pair has no symbol to pay, so it pays the cherry rate.
    const base = lead === "WILD" ? SLOT_DOUBLES.CHERRY : SLOT_DOUBLES[lead];
    const bonus = (x === "WILD" || y === "WILD") && lead !== "WILD" ? WILD_DOUBLE_BONUS : 1;
    const value = round2(base * bonus);
    if (value > best) {
      best = value;
      bestName = `Double ${lead === "WILD" ? "Wild" : titleCase(lead)}`;
    }
  }
  if (best > 0) return { reels, multiplier: best, kind: "double", name: bestName, jackpot: false };
  return { reels, multiplier: 0, kind: "none", name: null, jackpot: false };
}

export function spinSlots(rng: Rng): SlotSpin {
  return scoreSlotReels([
    pickWeighted(rng, REEL),
    pickWeighted(rng, REEL),
    pickWeighted(rng, REEL),
  ]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
