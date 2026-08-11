/**
 * Justice Ideology (#3598, spec #3581, ahd-scotus-context glossary).
 *
 * Two lean scores per justice — economic and social — never collapsed into a
 * single left-right number. Each is a blended composite: 65% the justice's own
 * personal policy position + 35% their party's matching position, on the
 * existing [-5, +5] scale shared by characters/parties/NPPs today. Applies
 * identically whether the justice is a player character or a generated NPP —
 * this function only ever reads the seated justice's own values.
 */

/** Weight applied to the justice's own personal policy position. */
export const JUSTICE_IDEOLOGY_PERSONAL_WEIGHT = 0.65;
/** Weight applied to the justice's party's matching position. */
export const JUSTICE_IDEOLOGY_PARTY_WEIGHT = 0.35;

export interface JusticePersonalPositions {
  economic: number;
  social: number;
}

export interface JusticePartyPositions {
  economicPosition: number;
  socialPosition: number;
}

export interface JusticeIdeology {
  economicLean: number;
  socialLean: number;
}

const SCALE_MIN = -5;
const SCALE_MAX = 5;

function clampScale(value: number): number {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, value));
}

/**
 * Compute a Justice's blended ideology from their own personal policy
 * positions and their party's platform positions. Pure — no DB access.
 */
export function computeJusticeIdeology(
  personal: JusticePersonalPositions,
  party: JusticePartyPositions
): JusticeIdeology {
  const economicLean = clampScale(
    personal.economic * JUSTICE_IDEOLOGY_PERSONAL_WEIGHT +
      party.economicPosition * JUSTICE_IDEOLOGY_PARTY_WEIGHT
  );
  const socialLean = clampScale(
    personal.social * JUSTICE_IDEOLOGY_PERSONAL_WEIGHT +
      party.socialPosition * JUSTICE_IDEOLOGY_PARTY_WEIGHT
  );
  return {
    economicLean: Math.round(economicLean * 100) / 100,
    socialLean: Math.round(socialLean * 100) / 100,
  };
}
