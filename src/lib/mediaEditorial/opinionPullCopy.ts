import { MEDIA_PULL_TURNS_PER_DAY } from "./opinionPull";

interface StoredPull {
  economic: number;
  social: number;
  slantEconomic?: number;
  slantSocial?: number;
  strength: number;
}

function signed(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return value > 0 ? `+${fixed}` : fixed;
}

/**
 * One line for the state page: where local newsrooms lean and how fast they
 * are moving opinion per game day. Null when no newsroom takes a stance.
 */
export function describeMediaPull(pull: StoredPull | null | undefined): string | null {
  if (!pull || !(pull.strength > 0)) return null;
  if (typeof pull.slantEconomic !== "number" || typeof pull.slantSocial !== "number") return null;
  const econDay = pull.economic * MEDIA_PULL_TURNS_PER_DAY;
  const socDay = pull.social * MEDIA_PULL_TURNS_PER_DAY;
  const lean = `Econ ${signed(pull.slantEconomic, 1)}, Soc ${signed(pull.slantSocial, 1)}`;
  if (econDay === 0 && socDay === 0) {
    return `Local newsrooms lean ${lean}. Opinion here already sits at that position.`;
  }
  return `Local newsrooms lean ${lean}. They are pulling opinion toward it by about Econ ${signed(econDay, 2)}, Soc ${signed(socDay, 2)} per day.`;
}
