/**
 * Per-region, per-cohort referendum affinity: a RELATIVE Yes-lean offset
 * (−50..+50) layered on the region's independence/reunification desire, then
 * re-centered to that desire at campaign open (see cohortEngine). Buckets with
 * no entry default to 0 (neutral). Because the table is relative and the
 * aggregate is re-centered, these numbers carry only the SHAPE of a coalition,
 * never its level — the level is the region's desire.
 *
 * Keys are Layer-1 census buckets in the UK model's vocabulary
 * (`ethnicity / age / education / income / urbanization` — see
 * `src/lib/seeds/international/uk.ts`), the same ids the targeting picker, the
 * GOTV modifiers and the demographics tab use.
 *
 * WHY THESE ARE HAND-AUTHORED AND NOT PROJECTED
 * ---------------------------------------------
 * The previous table was keyed on the 12 UK voter archetypes, and the obvious
 * migration was to run it through `archetypeValuesToBuckets`. That would have
 * been arithmetically faithful and historically wrong twice over.
 *
 * First, it would have flattened three different questions into one. Scotland,
 * Wales and Northern Ireland shared a single archetype table, and they do not
 * share a coalition: Scottish independence is an age-and-deprivation vote,
 * Welsh independence is an age-and-identity vote with almost no class content,
 * and Irish reunification is a community-background vote that only LOOKS like
 * an age vote because the two are so tightly correlated in the 2021 census.
 * Each region now has its own table.
 *
 * Second, the archetypes encoded the coalition indirectly — "green_activists
 * lean Yes" is a statement about a political disposition, and projecting it
 * onto census buckets turns it into a statement about graduates, which is not
 * the same claim and is weaker than the one the census can support directly.
 * Authoring on buckets says what the evidence says.
 */

/**
 * SCOTLAND — 2014 independence referendum and post-2014 polling.
 *
 * Age is the dominant axis: roughly three quarters of over-65s voted No in
 * 2014 while under-30s were the strongest Yes cohort, and every poll since has
 * kept that gradient. Deprivation is the second: the four council areas that
 * voted Yes (Glasgow, Dundee, West Dunbartonshire, North Lanarkshire) are
 * among Scotland's poorest, and the Yes campaign's late surge ran through
 * low-income urban Scotland. Education is deliberately SHALLOW here — unlike
 * Brexit, the 2014 graduate/non-graduate gap was small and has partly reversed
 * since 2016, so a steep education term would import an English realignment
 * into a Scottish question. Rural Scotland (Borders, Aberdeenshire, the
 * Northern Isles, which voted No by the largest margins in the country) is the
 * unionist end of the urbanization axis. Scots Asians were visibly pro-Yes in
 * 2014, and the white-British bucket in Scotland contains the English-born
 * minority who broke heavily No.
 */
const SCOTLAND_INDEPENDENCE_AFFINITY: Record<string, number> = {
  "age:young": 18,
  "age:mid": 8,
  "age:mature": -4,
  "age:senior": -22,

  "income:low": 14,
  "income:middle": 0,
  "income:high": -12,

  "education:no_qualifications": 5,
  "education:gcse_equivalent": 4,
  "education:a_level_equivalent": 0,
  "education:degree_plus": -3,

  "urbanization:urban": 9,
  "urbanization:suburban": -2,
  "urbanization:rural": -9,

  "ethnicity:white_british": -2,
  "ethnicity:asian_british": 10,
  "ethnicity:black_british": 6,
  "ethnicity:mixed": 5,
  "ethnicity:other": 4,
};

/**
 * WALES — YesCymru-era independence polling.
 *
 * The age gradient is even steeper than Scotland's: independence has polled
 * near or above half among under-25s while sitting in the low teens among
 * over-65s. Class content is much weaker — the Valleys are a Labour-unionist
 * heartland as much as a deprived one, so income gets a mild term rather than
 * Scotland's strong one. The distinctive Welsh feature is that the movement is
 * BIMODAL on both education and geography: it draws on Cardiff's young
 * graduates and, separately, on Welsh-speaking rural Gwynedd and Ceredigion,
 * while the unionist core is anglicised suburban and border Wales. That is why
 * education tilts slightly toward graduates AND rural is positive while
 * suburban is the most negative bucket in the table — a projection from
 * archetypes could not have produced that shape.
 */
const WALES_INDEPENDENCE_AFFINITY: Record<string, number> = {
  "age:young": 24,
  "age:mid": 10,
  "age:mature": -6,
  "age:senior": -26,

  "income:low": 6,
  "income:middle": 0,
  "income:high": -6,

  "education:no_qualifications": 2,
  "education:gcse_equivalent": 0,
  "education:a_level_equivalent": 2,
  "education:degree_plus": 4,

  "urbanization:urban": 8,
  "urbanization:suburban": -10,
  "urbanization:rural": 4,

  "ethnicity:white_british": -1,
  "ethnicity:asian_british": 5,
  "ethnicity:black_british": 5,
  "ethnicity:mixed": 4,
  "ethnicity:other": 3,
};

/**
 * NORTHERN IRELAND — reunification.
 *
 * KNOWN LIMITATION, stated rather than hidden: the actual cleavage is
 * community background, and the UK Layer-1 model has no Catholic/Protestant
 * key. The `ethnicity` dimension is a Great Britain construct and does not
 * carry it. This table therefore works through the proxies the model does
 * have, and it is the weakest of the three for that reason. If NI reunification
 * ever needs to be modelled properly, the fix is a community-background key in
 * the NI census marginals, not a bigger number here.
 *
 * Age is the strongest available proxy and is a real effect in its own right:
 * the 2021 census put Catholics in the majority in every cohort under 40 while
 * Protestants dominate the over-65s, and polling consistently finds under-45s
 * far more open to unity. Deprivation tracks community background closely
 * (West Belfast, Derry), which is why income carries a real term. Urbanization
 * separates nationalist Derry/Strabane, Newry/Mourne and West Belfast from the
 * unionist suburban belt around greater Belfast and North Down; rural
 * mid-Ulster is genuinely mixed and sits near neutral. The graduate term is
 * modest and confounded, and is kept small on purpose.
 */
const NORTHERN_IRELAND_REUNIFICATION_AFFINITY: Record<string, number> = {
  "age:young": 20,
  "age:mid": 12,
  "age:mature": -8,
  "age:senior": -24,

  "income:low": 10,
  "income:middle": 0,
  "income:high": -8,

  "education:no_qualifications": 0,
  "education:gcse_equivalent": 0,
  "education:a_level_equivalent": 2,
  "education:degree_plus": 6,

  "urbanization:urban": 8,
  "urbanization:suburban": -12,
  "urbanization:rural": 2,

  "ethnicity:white_british": -1,
  "ethnicity:asian_british": 4,
  "ethnicity:black_british": 4,
  "ethnicity:mixed": 4,
  "ethnicity:other": 3,
};

export const REFERENDUM_COHORT_AFFINITY: Record<string, Record<string, number>> = {
  SCO: SCOTLAND_INDEPENDENCE_AFFINITY,
  WAL: WALES_INDEPENDENCE_AFFINITY,
  NIR: NORTHERN_IRELAND_REUNIFICATION_AFFINITY,
};

export function cohortAffinitiesFor(regionId: string): Record<string, number> {
  return REFERENDUM_COHORT_AFFINITY[regionId.toUpperCase()] ?? {};
}
