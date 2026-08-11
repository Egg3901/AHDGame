/** Max share of per-turn income (₳) that can go to IMF facility payment — rest extends schedule. */
export const IMF_BAILOUT_INCOME_FRACTION_CAP = 0.45;

/** Default capture when activating a bailout or when legacy documents omit the field. */
export const IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION = 0.35;

/** Stored share price multiplier while IMF bailout is active (discipline / stigma). */
export const IMF_BAILOUT_SHARE_PRICE_MULTIPLIER = 0.85;
