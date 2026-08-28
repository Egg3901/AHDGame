import * as R from "./config";
import { clamp } from "./engineCore";
import type { RegionCode } from "@/lib/military/types";
import type { RegionChannels } from "./types";

/**
 * Persistent regional control: air superiority and sea control.
 *
 * The model is a contest, not a winner. Each country holds a 0..100 figure per region
 * that moves toward the share of the contest it is actually winning, and moves SLOWER up
 * than down. That asymmetry is the whole design: a lane you have held for ten turns is
 * worth something, and stepping away from it costs you more than stepping back in earns.
 *
 * Two things follow that a binary "who won the last battle" model cannot express:
 *
 *   - Uncontested presence still builds. Sitting in empty water for six turns gives you
 *     the sea, which is how blockades actually work.
 *   - Losing a battle does not hand the region over. It moves the number.
 */

/**
 * Build and decay rates.
 *
 * These are NOT invented. They are the measured values from the prototype's lane
 * pressure track (`config.EMBARGO`), where 25 was tried for decay and recorded as too
 * punitive: one turn off station cost two turns of rebuilding, so reacting to anything
 * meant permanently losing the race. Air and sea are split so they can be tuned apart
 * later, and start at the same tested numbers rather than at a guess.
 */
export const CHANNEL_RATES = {
  seaControl: { build: R.EMBARGO.buildPerTurn, decay: R.EMBARGO.decayPerTurn },
  /**
   * Air starts identical to sea deliberately. It is tempting to assume air should swing
   * faster because a sortie is quicker than a voyage, but that is an assumption, not a
   * measurement, and baking it in before the replay runs would hide it. If the replay
   * shows air needs to move faster, that is a finding to record here.
   */
  airSuperiority: { build: R.EMBARGO.buildPerTurn, decay: R.EMBARGO.decayPerTurn },
  /** Detection decays a band at a time rather than vanishing. See `config.DETECTION`. */
  detection: { decay: R.DETECTION.DECAY },
} as const;

export type ChannelKey = "airSuperiority" | "seaControl";

/**
 * Weight one country brings to a contest in one region, and the weight opposing it.
 *
 * `hostile` is the sum over countries this one is actually at war with, NOT every other
 * country present. A neutral fleet sitting in the same water is not contesting anything,
 * and treating it as opposition would mean a superpower could deny a region by parking a
 * ship in it without ever declaring war.
 */
export interface ContestInput {
  own: number;
  hostile: number;
}

/**
 * The level this contest is worth holding, 0..100.
 *
 * Share of the contest, so parity sits at 50 and uncontested presence goes to 100. A
 * country with no presence at all has no claim and falls to 0 whatever the enemy does,
 * which is what makes leaving a region cost something.
 */
export function contestTarget({ own, hostile }: ContestInput): number {
  if (own <= 0) return 0;
  const total = own + hostile;
  if (total <= 0) return 0;
  return clamp((own / total) * 100, 0, 100);
}

/**
 * Move one channel one turn toward its target.
 *
 * Rising uses the build rate, falling uses the decay rate, and neither overshoots: a
 * channel never jumps past where it was heading, so a large gap takes several turns and
 * the crossing is always visible to a player watching it.
 */
export function advanceChannel(current: number, target: number, key: ChannelKey): number {
  const rate = CHANNEL_RATES[key];
  if (target > current) return clamp(Math.min(target, current + rate.build), 0, 100);
  if (target < current) return clamp(Math.max(target, current - rate.decay), 0, 100);
  return clamp(current, 0, 100);
}

/** Advance every channel for one country in one region by one turn. */
export function advanceChannels(
  current: RegionChannels,
  contest: { air: ContestInput; sea: ContestInput },
  detectionNow: number,
  turn: number
): RegionChannels {
  return {
    airSuperiority: advanceChannel(
      current.airSuperiority,
      contestTarget(contest.air),
      "airSuperiority"
    ),
    seaControl: advanceChannel(current.seaControl, contestTarget(contest.sea), "seaControl"),
    // Detection is recomputed from presence each turn rather than accumulated, but a
    // contact held last turn and lost this turn decays a band instead of blanking, so
    // losing a patrol degrades the picture rather than erasing it.
    detection: Math.max(detectionNow, current.detection - CHANNEL_RATES.detection.decay, 0),
    updatedTurn: turn,
  };
}

/** A channel record for a region nobody has contested yet. */
export function emptyChannels(turn: number): RegionChannels {
  return { airSuperiority: 0, seaControl: 0, detection: 0, updatedTurn: turn };
}

/**
 * One side's channel level over a region, aggregated across its member countries.
 *
 * Takes the BEST holding on the side rather than the sum or the mean. Air superiority is
 * not additive: if the United States holds the sky at 80 and a minor ally holds it at 10,
 * the sky over that region is held at 80, and averaging it to 45 would make joining a
 * coalition actively harm the strongest member.
 */
export function sideChannel(
  channels: ReadonlyMap<string, RegionChannels>,
  countries: readonly string[],
  region: RegionCode,
  key: ChannelKey
): number {
  let best = 0;
  for (const c of countries) {
    const row = channels.get(channelKey(c, region));
    if (row && row[key] > best) best = row[key];
  }
  return best;
}

/**
 * Map key for a country's channel record in a region.
 *
 * Takes a bare string, not `CountryId`. Country ids arrive here from conflict sides and
 * unit rows as plain strings, and narrowing at this boundary would mean asserting a
 * shape the database does not guarantee.
 */
export function channelKey(countryId: string, region: RegionCode): string {
  return `${countryId}:${region}`;
}
