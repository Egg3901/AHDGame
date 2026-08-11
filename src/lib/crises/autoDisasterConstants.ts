/** Turns between automatic natural disasters, per country. */
export const AUTO_DISASTER_CADENCE_TURNS = 144;

/** Default crisis duration (turns) when a template has no region-scoped duration. */
export const AUTO_DISASTER_DEFAULT_DURATION_TURNS = 24;

/**
 * Margin penalty (percentage points) applied to sectors in the affected region
 * at disaster onset. Decays linearly to 0 at the crisis's expiry turn.
 */
export const AUTO_DISASTER_MARGIN_PENALTY = -10;
