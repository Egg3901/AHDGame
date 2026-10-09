import { rollInt, type Rng } from "../rng";

/** Single-zero (European) wheel. The zero is the whole house edge: 1/37, about 2.7%. */
export const ROULETTE_RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const ROULETTE_BETS = [
  "red",
  "black",
  "odd",
  "even",
  "low",
  "high",
  "dozen1",
  "dozen2",
  "dozen3",
  "column1",
  "column2",
  "column3",
  "straight",
] as const;
export type RouletteBet = (typeof ROULETTE_BETS)[number];

/** Total return on a straight-up hit. */
export const ROULETTE_MAX_MULTIPLIER = 36;

export interface RouletteSpin {
  pocket: number;
  color: "red" | "black" | "green";
  won: boolean;
  multiplier: number;
}

export function rouletteColor(pocket: number): RouletteSpin["color"] {
  if (pocket === 0) return "green";
  return ROULETTE_RED.has(pocket) ? "red" : "black";
}

/** Whether `bet` covers `pocket`, and the total return when it does. Zero loses every outside bet. */
export function scoreRoulette(
  bet: RouletteBet,
  pocket: number,
  number?: number
): { won: boolean; multiplier: number } {
  if (bet === "straight") {
    const won = number === pocket;
    return { won, multiplier: won ? ROULETTE_MAX_MULTIPLIER : 0 };
  }
  if (pocket === 0) return { won: false, multiplier: 0 };
  let won: boolean;
  let pays = 2;
  switch (bet) {
    case "red":
      won = ROULETTE_RED.has(pocket);
      break;
    case "black":
      won = !ROULETTE_RED.has(pocket);
      break;
    case "odd":
      won = pocket % 2 === 1;
      break;
    case "even":
      won = pocket % 2 === 0;
      break;
    case "low":
      won = pocket <= 18;
      break;
    case "high":
      won = pocket >= 19;
      break;
    case "dozen1":
    case "dozen2":
    case "dozen3": {
      const dozen = Number(bet.slice(-1));
      won = Math.ceil(pocket / 12) === dozen;
      pays = 3;
      break;
    }
    case "column1":
    case "column2":
    case "column3": {
      const column = Number(bet.slice(-1));
      won = ((pocket - 1) % 3) + 1 === column;
      pays = 3;
      break;
    }
  }
  return { won, multiplier: won ? pays : 0 };
}

export function spinRoulette(rng: Rng, bet: RouletteBet, number?: number): RouletteSpin {
  const pocket = rollInt(rng, 0, 36);
  return { pocket, color: rouletteColor(pocket), ...scoreRoulette(bet, pocket, number) };
}
