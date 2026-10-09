import { rollInt, type Rng } from "../rng";

/**
 * Pass and don't-pass line, rolled to resolution in one request. Edges are the
 * game's own: 1.41% on pass, 1.36% on don't pass (a come-out 12 pushes).
 */
export type CrapsBet = "pass" | "dontpass";
export const CRAPS_MAX_MULTIPLIER = 2;
/** A point can in principle run forever; stop and void the round past this many rolls. */
const MAX_ROLLS = 500;

export interface CrapsRound {
  rolls: [number, number][];
  point: number | null;
  result: "win" | "loss" | "push";
  multiplier: number;
}

export function playCraps(rng: Rng, bet: CrapsBet): CrapsRound {
  const rolls: [number, number][] = [];
  const roll = () => {
    const dice: [number, number] = [rollInt(rng, 1, 6), rollInt(rng, 1, 6)];
    rolls.push(dice);
    return dice[0] + dice[1];
  };
  const finish = (passWins: boolean | null, point: number | null): CrapsRound => {
    if (passWins === null) return { rolls, point, result: "push", multiplier: 1 };
    const won = bet === "pass" ? passWins : !passWins;
    return { rolls, point, result: won ? "win" : "loss", multiplier: won ? 2 : 0 };
  };

  const comeOut = roll();
  if (comeOut === 7 || comeOut === 11) return finish(true, null);
  if (comeOut === 2 || comeOut === 3) return finish(false, null);
  if (comeOut === 12) return bet === "dontpass" ? finish(null, null) : finish(false, null);

  const point = comeOut;
  while (rolls.length < MAX_ROLLS) {
    const total = roll();
    if (total === point) return finish(true, point);
    if (total === 7) return finish(false, point);
  }
  return finish(null, point);
}
