import { z } from "zod";
import { ROULETTE_BETS, spinRoulette } from "./games/roulette";
import { CRASH_MAX_TARGET, CRASH_MIN_TARGET, playCrash } from "./games/crash";
import { playCraps } from "./games/craps";
import { spinSlots } from "./games/slots";
import type { Rng } from "./rng";

/** One-request games: the stake goes in, the server draws, the house settles. */
export const instantPlaySchema = z.discriminatedUnion("game", [
  z.object({
    game: z.literal("slots"),
    discordId: z.string().min(1),
    stake: z.number().int().positive(),
  }),
  z
    .object({
      game: z.literal("roulette"),
      discordId: z.string().min(1),
      stake: z.number().int().positive(),
      bet: z.enum(ROULETTE_BETS),
      number: z.number().int().min(0).max(36).optional(),
    })
    .refine((b) => b.bet !== "straight" || b.number !== undefined, {
      message: "A straight bet needs a number from 0 to 36",
      path: ["number"],
    }),
  z.object({
    game: z.literal("crash"),
    discordId: z.string().min(1),
    stake: z.number().int().positive(),
    target: z.number().min(CRASH_MIN_TARGET).max(CRASH_MAX_TARGET),
  }),
  z.object({
    game: z.literal("craps"),
    discordId: z.string().min(1),
    stake: z.number().int().positive(),
    bet: z.enum(["pass", "dontpass"]),
  }),
]);
export type InstantPlay = z.infer<typeof instantPlaySchema>;

export function drawInstantGame(
  play: InstantPlay,
  rng: Rng
): { multiplier: number; outcome: Record<string, unknown> } {
  switch (play.game) {
    case "slots": {
      const spin = spinSlots(rng);
      return { multiplier: spin.multiplier, outcome: { ...spin } };
    }
    case "roulette": {
      const spin = spinRoulette(rng, play.bet, play.number);
      return {
        multiplier: spin.multiplier,
        outcome: { ...spin, bet: play.bet, number: play.number },
      };
    }
    case "crash": {
      const round = playCrash(rng, Math.floor(play.target * 100) / 100);
      return { multiplier: round.multiplier, outcome: { ...round } };
    }
    case "craps": {
      const round = playCraps(rng, play.bet);
      return { multiplier: round.multiplier, outcome: { ...round, bet: play.bet } };
    }
  }
}
