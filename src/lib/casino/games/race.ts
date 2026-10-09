import { rollInt, type Rng } from "../rng";

/**
 * Animal race, ported from POWER. Every racer wins with equal probability;
 * the styles only change how the race looks on the way there. The winner is
 * drawn first and the frames are generated to finish with it in front, so the
 * animation can never disagree with the payout.
 */
export const RACERS = [
  { id: "turtle", name: "Turtle", emoji: "🐢", style: "steady" },
  { id: "snake", name: "Snake", emoji: "🐍", style: "slippery" },
  { id: "rabbit", name: "Rabbit", emoji: "🐇", style: "fast" },
  { id: "dragon", name: "Dragon", emoji: "🐉", style: "unpredictable" },
] as const;
export type RacerId = (typeof RACERS)[number]["id"];
export const RACER_IDS = RACERS.map((r) => r.id) as RacerId[];
export const RACE_TRACK_LENGTH = 20;

export interface RaceResult {
  winner: RacerId;
  /** Positions per frame, one entry per racer in RACERS order. The last frame has the winner at the line. */
  frames: number[][];
}

function stride(rng: Rng, style: (typeof RACERS)[number]["style"]): number {
  switch (style) {
    case "steady":
      return 1 + rng() * 0.6;
    case "slippery":
      return 0.6 + rng() * 1.4;
    case "fast":
      return rng() < 0.2 ? 0.2 : 1 + rng() * 1.2;
    case "unpredictable":
      return rng() < 0.25 ? 2.5 + rng() : rng() * 1.2;
  }
}

export function runRace(rng: Rng): RaceResult {
  const winnerIndex = rollInt(rng, 0, RACERS.length - 1);
  const positions = RACERS.map(() => 0);
  const frames: number[][] = [];
  for (let frame = 0; frame < 60; frame++) {
    RACERS.forEach((racer, i) => {
      positions[i] = Math.min(RACE_TRACK_LENGTH, positions[i] + stride(rng, racer.style));
    });
    // Losers are held short of the line until the winner crosses it.
    RACERS.forEach((_, i) => {
      if (i !== winnerIndex) positions[i] = Math.min(positions[i], RACE_TRACK_LENGTH - 1);
    });
    if (frame >= 3 && positions[winnerIndex] >= RACE_TRACK_LENGTH) break;
    // A slow winner gets a late surge rather than a race that never ends.
    if (frame >= 12)
      positions[winnerIndex] = Math.min(RACE_TRACK_LENGTH, positions[winnerIndex] + 1.5);
    frames.push(positions.map((p) => Math.round(p * 10) / 10));
  }
  positions[winnerIndex] = RACE_TRACK_LENGTH;
  frames.push(positions.map((p) => Math.round(p * 10) / 10));
  return { winner: RACERS[winnerIndex].id, frames };
}
