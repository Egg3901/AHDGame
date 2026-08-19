import type { DemographicCategory } from "@/lib/db/types";
import type { EraId } from "./presetSelector";

export interface VoterGroupCompositionEntry {
  weights: Array<{ dim: keyof typeof DEMOGRAPHIC_TURNOUT_RATES; key: string; w: number }>;
  civicMultiplier?: number;
}

/** Structural shape of the Layer-1 turnout-rate table — era files supply their own values. */
export interface DemographicTurnoutRates {
  race: { white: number; black: number; hispanic: number; asian: number; other: number };
  age: { young: number; mid: number; mature: number; senior: number };
  education: { no_college: number; college: number; graduate: number };
  wealth: { low: number; middle: number; high: number };
  ideology: {
    evangelicals: number;
    environmentalists: number;
    libertarians: number;
    progressives: number;
    patriots: number;
    gunowners: number;
  };
}

export interface EraComposition {
  groupIds: readonly string[];
  voterGroupComposition: Record<string, VoterGroupCompositionEntry>;
  turnoutRates: DemographicTurnoutRates;
  defaultLeans: Record<string, { economicLean: number; socialLean: number }>;
  defaultTurnouts: Record<string, number>;
}

/**
 * National baseline turnout rates (%) by Layer-1 demographic dimension.
 * Used to derive voter group turnout from their demographic composition.
 * Sources: US Census CPS Voting Supplement, CIRCLE, and Pew Research averages.
 */
export const DEMOGRAPHIC_TURNOUT_RATES = {
  race: { white: 63, black: 60, hispanic: 48, asian: 52, other: 52 },
  age: { young: 38, mid: 56, mature: 66, senior: 76 }, // seniors: CPS validated ~76% in 2020
  education: { no_college: 52, college: 66, graduate: 74 },
  wealth: { low: 44, middle: 60, high: 74 },
  ideology: {
    evangelicals: 77, // high organizational mobilization
    environmentalists: 66,
    libertarians: 64,
    progressives: 64,
    patriots: 69,
    gunowners: 67,
  },
} as const;

/**
 * Per-era national baseline turnout rates, the year-anchor counterpart of
 * {@link DEMOGRAPHIC_TURNOUT_RATES}.
 *
 * `DEMOGRAPHIC_TURNOUT_RATES` is a single modern table. Without these per-era
 * anchors every world would model participation with 2019 propensities no
 * matter what year it was in - a 1953 world would have 2020's steep youth
 * deficit and 2020's senior surge, neither of which existed then. These
 * anchors let turnout slide along the same clock as everything else.
 *
 * **The 2019 entry IS `DEMOGRAPHIC_TURNOUT_RATES`**, by reference, so a 2019
 * world is unchanged and every existing calibration test stays green.
 *
 * WHAT THESE ARE NOT: they are not the state-level franchise. The Voting
 * Rights Act's enfranchisement of Black voters in the covered South is owned by
 * `VOTING_RIGHTS_ACT_ENFRANCHISEMENT_CHECKPOINT` (+40pp in MS/AL, +20pp in
 * LA/GA/SC/VA) and is subtracted back out of these baselines per state by
 * `checkpointBakedShifts.ts`, exactly as the position tables are. So the
 * `race.black` numbers below describe national participation ABSENT that
 * state-specific suppression-and-recovery, not the raw national average of a
 * year in which most Southern Black adults could not register at all.
 *
 * Sources: US Census CPS Voting and Registration Supplement (biennial, 1964–),
 * ANES for the pre-1964 era, CIRCLE for youth series, Pew validated-voter
 * studies for the recent cycles. National VAP/VEP turnout for the anchor
 * elections: 1952 ~61.6%, 1980 ~54.2%, 1992 ~58.1%, 2000 ~54.2%, 2008 ~61.6%,
 * 2020 ~66.8%, 2024 ~63.9%.
 */
export const ERA_TURNOUT_RATES: Record<EraId, DemographicTurnoutRates> = {
  // 1952. Turnout was HIGH by modern standards and the age curve ran the other
  // way: under-21s could not vote at all, and seniors — pre-Medicare, before
  // the organised retiree bloc existed — voted LESS than the mature cohort,
  // not more. The education gradient was steep in relative terms precisely
  // because a degree was rare (~6% of adults).
  "1953": {
    race: { white: 65, black: 40, hispanic: 40, asian: 42, other: 42 },
    age: { young: 45, mid: 62, mature: 68, senior: 62 },
    education: { no_college: 57, college: 76, graduate: 82 },
    wealth: { low: 46, middle: 64, high: 78 },
    ideology: {
      evangelicals: 60, // pre-Moral Majority: devout but politically unorganised
      environmentalists: 60,
      libertarians: 58,
      progressives: 66, // peak union density carries the left's mobilisation
      patriots: 68,
      gunowners: 62,
    },
  },
  // 1980. The post-1971 collapse in youth turnout is now visible (26th
  // Amendment enfranchised 18-20s into the least-participatory cohort), the
  // senior curve has inverted upward, and Hispanic/Asian turnout is low on a
  // largely non-citizen adult population.
  "1979": {
    race: { white: 61, black: 51, hispanic: 30, asian: 32, other: 35 },
    age: { young: 36, mid: 55, mature: 65, senior: 69 },
    education: { no_college: 46, college: 67, graduate: 77 },
    wealth: { low: 39, middle: 56, high: 72 },
    ideology: {
      evangelicals: 72, // Moral Majority founded 1979 — organised mobilisation begins
      environmentalists: 62,
      libertarians: 60,
      progressives: 60,
      patriots: 66,
      gunowners: 66,
    },
  },
  // 1992. Perot's third-party surge and an unusually engaged cycle lift every
  // bucket off the 1980 floor.
  "1991": {
    race: { white: 64, black: 54, hispanic: 29, asian: 31, other: 36 },
    age: { young: 43, mid: 58, mature: 68, senior: 70 },
    education: { no_college: 49, college: 70, graduate: 79 },
    wealth: { low: 41, middle: 59, high: 74 },
    ideology: {
      evangelicals: 75, // Christian Coalition high tide
      environmentalists: 64,
      libertarians: 62,
      progressives: 62,
      patriots: 68,
      gunowners: 67,
    },
  },
  // 2000. Back down to the 1980-ish floor; the education gradient keeps widening.
  "1999": {
    race: { white: 62, black: 55, hispanic: 28, asian: 30, other: 35 },
    age: { young: 36, mid: 55, mature: 66, senior: 70 },
    education: { no_college: 45, college: 68, graduate: 78 },
    wealth: { low: 38, middle: 57, high: 73 },
    ideology: {
      evangelicals: 76,
      environmentalists: 64,
      libertarians: 62,
      progressives: 61,
      patriots: 68,
      gunowners: 67,
    },
  },
  // 2008. The defining change of the series: Black turnout reaches parity with
  // white for the first time (CPS put it within a point, and above it in 2012),
  // and youth turnout jumps ~15 points off its 2000 low.
  "2007": {
    race: { white: 66, black: 65, hispanic: 50, asian: 48, other: 49 },
    age: { young: 51, mid: 60, mature: 69, senior: 72 },
    education: { no_college: 50, college: 71, graduate: 80 },
    wealth: { low: 42, middle: 60, high: 75 },
    ideology: {
      evangelicals: 76,
      environmentalists: 66,
      libertarians: 63,
      progressives: 65,
      patriots: 69,
      gunowners: 67,
    },
  },
  // 2020 — the live modern table, by reference. Editing DEMOGRAPHIC_TURNOUT_RATES
  // moves this anchor with it, which is the intended coupling.
  "2019": DEMOGRAPHIC_TURNOUT_RATES,
  // 2024. Overall participation eased off the 2020 peak, concentrated in the
  // groups 2020's mail-ballot expansion had lifted most; the education gradient
  // narrowed slightly as non-college turnout held up better than college.
  "2023": {
    race: { white: 62, black: 58, hispanic: 47, asian: 51, other: 51 },
    age: { young: 40, mid: 56, mature: 65, senior: 74 },
    education: { no_college: 51, college: 65, graduate: 73 },
    wealth: { low: 43, middle: 59, high: 73 },
    ideology: {
      evangelicals: 77,
      environmentalists: 65,
      libertarians: 64,
      progressives: 63,
      patriots: 70,
      gunowners: 68,
    },
  },
};

/**
 * Human-readable labels for each Layer-1 demographic sub-group.
 */
export const DEMOGRAPHIC_LABELS: Record<string, Record<string, string>> = {
  race: { white: "White", black: "Black", hispanic: "Hispanic", asian: "Asian", other: "Other" },
  age: {
    young: "Young (18–34)",
    mid: "Middle-Aged (35–49)",
    mature: "Mature (50–64)",
    senior: "Senior (65+)",
  },
  education: { no_college: "No College", college: "College Degree", graduate: "Graduate Degree" },
  wealth: { low: "Low Income", middle: "Middle Income", high: "High Income" },
};

/**
 * Raw composition formula weights for each voter group, mirroring deriveGroupPopulations().
 * Normalized at use time; the raw weights encode relative demographic contribution.
 * Civic engagement multiplier applied for groups with structural participation barriers.
 *
 * These are the 2019-era weights; each era in `ERA_COMPOSITIONS` carries its own
 * independently-authored composition table.
 */
export const VOTER_GROUP_COMPOSITION: Record<
  string,
  {
    weights: Array<{ dim: keyof typeof DEMOGRAPHIC_TURNOUT_RATES; key: string; w: number }>;
    civicMultiplier?: number;
  }
> = {
  young_renters: {
    weights: [
      { dim: "age", key: "young", w: 0.35 },
      { dim: "wealth", key: "low", w: 0.25 },
      { dim: "education", key: "no_college", w: 0.15 },
    ],
  },
  evangelicals: {
    weights: [
      { dim: "ideology", key: "evangelicals", w: 1.0 },
      { dim: "race", key: "white", w: 0.2 },
    ],
  },
  rural_traditionalists: {
    weights: [
      { dim: "race", key: "white", w: 0.2 },
      { dim: "education", key: "no_college", w: 0.15 },
      { dim: "ideology", key: "patriots", w: 0.4 },
      { dim: "ideology", key: "gunowners", w: 0.4 },
    ],
  },
  union_trades: {
    weights: [
      { dim: "education", key: "no_college", w: 0.2 },
      { dim: "wealth", key: "low", w: 0.3 },
      { dim: "race", key: "black", w: 0.2 },
      { dim: "race", key: "white", w: 0.1 },
    ],
  },
  soccer_moms: {
    weights: [
      { dim: "age", key: "mid", w: 0.4 },
      { dim: "wealth", key: "middle", w: 0.4 },
      { dim: "race", key: "white", w: 0.15 },
    ],
  },
  college_liberals: {
    weights: [
      { dim: "education", key: "college", w: 0.15 },
      { dim: "education", key: "graduate", w: 0.15 },
      { dim: "ideology", key: "progressives", w: 0.3 },
      { dim: "ideology", key: "environmentalists", w: 0.3 },
      { dim: "race", key: "white", w: 0.1 },
    ],
  },
  small_business: {
    weights: [
      { dim: "wealth", key: "high", w: 0.35 },
      { dim: "ideology", key: "libertarians", w: 0.35 },
      { dim: "age", key: "mature", w: 0.2 },
      { dim: "race", key: "white", w: 0.15 },
    ],
  },
  public_sector: {
    weights: [
      { dim: "education", key: "college", w: 0.12 },
      { dim: "education", key: "graduate", w: 0.15 },
      { dim: "ideology", key: "progressives", w: 0.3 },
      { dim: "wealth", key: "middle", w: 0.2 },
      { dim: "race", key: "black", w: 0.1 },
    ],
  },
  retirees: {
    weights: [
      { dim: "age", key: "senior", w: 0.4 },
      { dim: "age", key: "mature", w: 0.15 },
      { dim: "race", key: "white", w: 0.15 },
    ],
  },
  libertarians: {
    weights: [
      { dim: "ideology", key: "libertarians", w: 1.0 },
      { dim: "race", key: "white", w: 0.15 },
    ],
  },
  new_immigrants: {
    weights: [
      { dim: "race", key: "hispanic", w: 0.5 },
      { dim: "race", key: "asian", w: 0.3 },
      { dim: "race", key: "other", w: 0.2 },
    ],
    civicMultiplier: 0.8,
  },
  secular_professionals: {
    weights: [
      { dim: "education", key: "graduate", w: 0.2 },
      { dim: "wealth", key: "high", w: 0.2 },
      { dim: "ideology", key: "environmentalists", w: 0.2 },
      { dim: "ideology", key: "progressives", w: 0.2 },
      { dim: "race", key: "white", w: 0.1 },
    ],
  },
};

/**
 * 12 Voter Archetypes (Phase 2 demographic overhaul)
 * Single category — mutually exclusive groups, no double-counting.
 * defaultTurnout is kept as a fallback; real derived turnout is computed in stateDemographics.
 */
export const demographicCategories: DemographicCategory[] = [
  {
    _id: "voterGroups",
    name: "Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "young_renters",
        name: "Young Renters",
        defaultEconomicLean: -4,
        defaultSocialLean: -4,
        defaultTurnout: 46, // CPS: 18-29 turnout ~45% in presidential years
      },
      {
        id: "evangelicals",
        name: "Evangelicals",
        defaultEconomicLean: 4,
        defaultSocialLean: 5,
        defaultTurnout: 73, // High organizational mobilization through churches
      },
      {
        id: "rural_traditionalists",
        name: "Rural Traditionalists",
        defaultEconomicLean: 4,
        defaultSocialLean: 4,
        defaultTurnout: 71, // Older demographic with stable civic habits
      },
      {
        id: "union_trades",
        name: "Union & Trades",
        defaultEconomicLean: -3, // Economically populist but not hard-left; shifted rightward since 2016
        // Culturally traditional: the economically-left/socially-right quadrant,
        // which is the whole reason two axes exist. Authored at -0.5 it sat on
        // the same diagonal as everything else and that quadrant was empty too.
        defaultSocialLean: 1,
        defaultTurnout: 63, // Unions actively organize GOTV
      },
      {
        id: "soccer_moms",
        name: "Soccer Moms",
        defaultEconomicLean: -1,
        defaultSocialLean: -0.5, // Suburban women are a genuine swing group
        defaultTurnout: 60,
      },
      {
        id: "college_liberals",
        name: "College Liberals",
        defaultEconomicLean: -4.5, // Very progressive but not uniformly at the ceiling
        defaultSocialLean: -5,
        defaultTurnout: 67,
      },
      {
        id: "small_business",
        name: "Small Business",
        defaultEconomicLean: 4,
        defaultSocialLean: 2,
        defaultTurnout: 72,
      },
      {
        id: "public_sector",
        name: "Public Sector Workers",
        defaultEconomicLean: -3,
        defaultSocialLean: -3,
        defaultTurnout: 67,
      },
      {
        id: "retirees",
        name: "Retirees",
        defaultEconomicLean: 1, // Consistently center-right; Medicare/SS recipients but net tax-cutters
        defaultSocialLean: 2, // More socially conservative than national average across all states
        defaultTurnout: 76, // Highest-turnout cohort; CPS: 65+ at 76-78%
      },
      {
        id: "libertarians",
        name: "Libertarians",
        defaultEconomicLean: 5,
        // Socially PERMISSIVE, not conservative — this is the defining
        // economically-right/socially-left quadrant. It was authored at +1,
        // which put it on the same diagonal as every other group and left that
        // quadrant empty.
        defaultSocialLean: -3,
        defaultTurnout: 68,
      },
      {
        id: "new_immigrants",
        name: "New Americans",
        defaultEconomicLean: -3,
        defaultSocialLean: -2,
        defaultTurnout: 42, // Naturalization and registration barriers lower effective turnout
      },
      {
        id: "secular_professionals",
        name: "Secular Professionals",
        defaultEconomicLean: -3, // Left-leaning but not uniformly socialist; includes high earners
        defaultSocialLean: -4.5,
        defaultTurnout: 68, // Well-educated high turnout but not highest; capped below retirees
      },
    ],
  },
];

/** The 12 voter archetypes — stable across all eras (their composition/leans/turnouts shift). */
const ERA_GROUP_IDS = [
  "young_renters",
  "evangelicals",
  "rural_traditionalists",
  "union_trades",
  "soccer_moms",
  "college_liberals",
  "small_business",
  "public_sector",
  "retirees",
  "libertarians",
  "new_immigrants",
  "secular_professionals",
] as const;

/**
 * Era-specific composition registry. Every era is independently authored —
 * turnout rates, ideological leans, default turnouts, and composition weights
 * are grounded in that era's electoral reality, NOT derived from 2019 values.
 *
 * Era anchors:
 *   1979 — Post-Watergate, pre-Reagan. New Deal coalition fraying; union
 *     density ~24%; Moral Majority founded 1979 (evangelical mobilization
 *     just starting); senior turnout NOT yet dominant (pre-AARP machine);
 *     hispanic electorate tiny and low-turnout (pre-NVRA registration).
 *   1991 — Post-Cold-War. Evangelical mobilization at high tide; Reagan
 *     Democrats; union density ~16%; Motor-Voter not yet passed (low
 *     minority registration); weak youth turnout.
 *   1999 — Dot-com peak, lowest-turnout era of the six (1996/1998 nadir);
 *     partisan sorting beginning; soccer-mom swing peak.
 *   2007 — Iraq-War polarization; post-2004 mobilization high; early
 *     social-media organizing lifts young/progressive turnout.
 *   2019 — The original baseline (matches legacy static exports).
 *   2023 — Post-2020 record-turnout environment; Gen-Z entry; mail/early
 *     voting expansion lifts all groups; education realignment peak.
 */
export const ERA_COMPOSITIONS: Record<EraId, EraComposition> = {
  // 1953 — Early Cold War. FDR coalition fragmenting; union density ~35%; McCarthy
  // era; evangelical bloc not yet organized; Black turnout suppressed in South.
  "1953": {
    groupIds: ERA_GROUP_IDS,
    voterGroupComposition: {
      young_renters: {
        weights: [
          { dim: "age", key: "young", w: 0.5 },
          { dim: "wealth", key: "low", w: 0.35 },
          { dim: "education", key: "no_college", w: 0.15 },
        ],
      },
      evangelicals: {
        weights: [{ dim: "ideology", key: "evangelicals", w: 1.0 }],
      },
      rural_traditionalists: {
        weights: [
          { dim: "ideology", key: "patriots", w: 0.6 },
          { dim: "ideology", key: "gunowners", w: 0.6 },
        ],
      },
      union_trades: {
        weights: [
          { dim: "race", key: "black", w: 0.3 },
          { dim: "ideology", key: "progressives", w: 0.5 },
          { dim: "wealth", key: "low", w: 0.2 },
        ],
      },
      soccer_moms: {
        weights: [
          { dim: "age", key: "mid", w: 0.4 },
          { dim: "wealth", key: "middle", w: 0.45 },
          { dim: "ideology", key: "patriots", w: 0.15 },
        ],
      },
      college_liberals: {
        weights: [
          { dim: "ideology", key: "progressives", w: 0.6 },
          { dim: "education", key: "college", w: 0.25 },
          { dim: "education", key: "graduate", w: 0.15 },
        ],
      },
      small_business: {
        weights: [
          { dim: "ideology", key: "libertarians", w: 0.4 },
          { dim: "wealth", key: "high", w: 0.4 },
          { dim: "age", key: "mature", w: 0.2 },
        ],
      },
      public_sector: {
        weights: [
          { dim: "ideology", key: "progressives", w: 0.8 },
          { dim: "education", key: "college", w: 0.2 },
        ],
      },
      retirees: {
        weights: [
          { dim: "age", key: "senior", w: 0.65 },
          { dim: "age", key: "mature", w: 0.35 },
        ],
      },
      libertarians: {
        weights: [{ dim: "ideology", key: "libertarians", w: 1.0 }],
      },
      new_immigrants: {
        weights: [
          { dim: "race", key: "hispanic", w: 0.4 },
          { dim: "race", key: "other", w: 0.3 },
          { dim: "wealth", key: "low", w: 0.3 },
        ],
      },
      secular_professionals: {
        weights: [
          { dim: "ideology", key: "progressives", w: 0.5 },
          { dim: "education", key: "graduate", w: 0.3 },
          { dim: "wealth", key: "high", w: 0.2 },
        ],
      },
    },
    turnoutRates: {
      // 1952 presidential election baseline; Black turnout nationally ~30%
      // (suppressed in South); Hispanic electorate tiny.
      race: { white: 65, black: 30, hispanic: 15, asian: 20, other: 25 },
      age: { young: 35, mid: 55, mature: 62, senior: 60 },
      education: { no_college: 54, college: 64, graduate: 69 },
      wealth: { low: 43, middle: 58, high: 68 },
      ideology: {
        evangelicals: 58, // not yet politically organized
        environmentalists: 45,
        libertarians: 58,
        progressives: 62,
        patriots: 64, // Korean War patriotism
        gunowners: 63,
      },
    },
    defaultLeans: {
      young_renters: { economicLean: -1.5, socialLean: -1.5 }, // pre-counterculture
      evangelicals: { economicLean: 2.0, socialLean: 3.5 }, // not yet Moral Majority
      rural_traditionalists: { economicLean: 2.5, socialLean: 3.0 }, // Solid South fragmenting
      union_trades: { economicLean: -4.5, socialLean: -0.5 }, // peak CIO/AFL, New Deal heirs
      soccer_moms: { economicLean: 0.5, socialLean: 0.5 }, // postwar suburban growth
      college_liberals: { economicLean: -3.5, socialLean: -3.0 }, // small educated left
      small_business: { economicLean: 4.0, socialLean: 1.5 },
      public_sector: { economicLean: -3.5, socialLean: -2.0 },
      retirees: { economicLean: 0.0, socialLean: 0.5 }, // New Deal loyalists
      libertarians: { economicLean: 4.5, socialLean: 0.0 },
      new_immigrants: { economicLean: -2.5, socialLean: -2.0 },
      secular_professionals: { economicLean: -2.0, socialLean: -2.5 },
    },
    defaultTurnouts: {
      young_renters: 36,
      evangelicals: 55,
      rural_traditionalists: 60,
      union_trades: 67,
      soccer_moms: 56,
      college_liberals: 58,
      small_business: 66,
      public_sector: 62,
      retirees: 60,
      libertarians: 60,
      new_immigrants: 28,
      secular_professionals: 60,
    },
  },
  "1979": {
    groupIds: ERA_GROUP_IDS,
    voterGroupComposition: {
      young_renters: {
        weights: [
          { dim: "age", key: "young", w: 0.5 },
          { dim: "wealth", key: "low", w: 0.3 },
          { dim: "education", key: "no_college", w: 0.2 },
        ],
      },
      evangelicals: {
        weights: [
          { dim: "ideology", key: "evangelicals", w: 1.0 },
          // race weight removed — ideology is the defining dimension;
          // adding race dilutes the lean by blending with white voters' position
        ],
      },
      rural_traditionalists: {
        weights: [
          { dim: "ideology", key: "patriots", w: 0.6 },
          { dim: "ideology", key: "gunowners", w: 0.6 },
        ],
      },
      union_trades: {
        weights: [
          { dim: "race", key: "black", w: 0.4 },
          { dim: "ideology", key: "progressives", w: 0.4 },
          { dim: "wealth", key: "low", w: 0.2 },
        ],
      },
      soccer_moms: {
        weights: [
          { dim: "age", key: "mid", w: 0.4 },
          { dim: "wealth", key: "middle", w: 0.4 },
          { dim: "ideology", key: "patriots", w: 0.1 },
        ],
      },
      college_liberals: {
        weights: [
          { dim: "ideology", key: "progressives", w: 0.5 },
          { dim: "ideology", key: "environmentalists", w: 0.4 },
          { dim: "education", key: "college", w: 0.2 },
          { dim: "education", key: "graduate", w: 0.15 },
        ],
      },
      small_business: {
        weights: [
          { dim: "ideology", key: "libertarians", w: 0.5 },
          { dim: "wealth", key: "high", w: 0.4 },
          { dim: "age", key: "mature", w: 0.2 },
        ],
      },
      public_sector: {
        weights: [
          { dim: "ideology", key: "progressives", w: 0.8 },
          { dim: "education", key: "college", w: 0.1 },
          { dim: "education", key: "graduate", w: 0.1 },
        ],
      },
      retirees: {
        weights: [
          { dim: "age", key: "senior", w: 0.6 },
          { dim: "age", key: "mature", w: 0.2 },
        ],
      },
      libertarians: {
        weights: [{ dim: "ideology", key: "libertarians", w: 1.0 }],
      },
      new_immigrants: {
        weights: [
          { dim: "race", key: "hispanic", w: 0.6 },
          { dim: "race", key: "asian", w: 0.3 },
          { dim: "race", key: "other", w: 0.1 },
        ],
        civicMultiplier: 0.7,
      },
      secular_professionals: {
        weights: [
          { dim: "ideology", key: "environmentalists", w: 0.4 },
          { dim: "ideology", key: "progressives", w: 0.4 },
          { dim: "education", key: "graduate", w: 0.25 },
          { dim: "wealth", key: "high", w: 0.2 },
        ],
      },
    },
    turnoutRates: {
      race: { white: 61, black: 49, hispanic: 30, asian: 35, other: 38 },
      age: { young: 40, mid: 58, mature: 64, senior: 65 },
      education: { no_college: 52, college: 64, graduate: 70 },
      wealth: { low: 44, middle: 58, high: 70 },
      ideology: {
        evangelicals: 70, // mobilizing post-Moral Majority
        environmentalists: 58,
        libertarians: 60,
        progressives: 65,
        patriots: 68,
        gunowners: 68,
      },
    },
    defaultLeans: {
      young_renters: { economicLean: -3, socialLean: -2.5 },
      evangelicals: { economicLean: 4, socialLean: 4.5 },
      rural_traditionalists: { economicLean: 3.5, socialLean: 3.5 },
      union_trades: { economicLean: -4, socialLean: 0 },
      soccer_moms: { economicLean: 0, socialLean: 0 },
      college_liberals: { economicLean: -4, socialLean: -4 },
      small_business: { economicLean: 4, socialLean: 1.5 },
      public_sector: { economicLean: -3.5, socialLean: -2.5 },
      retirees: { economicLean: 0.5, socialLean: 1.5 },
      libertarians: { economicLean: 5, socialLean: 0 },
      new_immigrants: { economicLean: -3, socialLean: -2 },
      secular_professionals: { economicLean: -2.5, socialLean: -3.5 },
    },
    defaultTurnouts: {
      young_renters: 42,
      evangelicals: 60,
      rural_traditionalists: 62,
      union_trades: 65, // union GOTV at peak strength
      soccer_moms: 58,
      college_liberals: 62,
      small_business: 68,
      public_sector: 64,
      retirees: 65, // senior turnout dominance not yet established
      libertarians: 62,
      new_immigrants: 35,
      secular_professionals: 64,
    },
  },
  "1991": {
    groupIds: ERA_GROUP_IDS,
    voterGroupComposition: {
      young_renters: {
        weights: [
          { dim: "age", key: "young", w: 0.5 },
          { dim: "wealth", key: "low", w: 0.3 },
          { dim: "education", key: "no_college", w: 0.2 },
        ],
      },
      evangelicals: {
        weights: [
          { dim: "ideology", key: "evangelicals", w: 1.0 },
          // race weight removed — ideology is the defining dimension
        ],
      },
      rural_traditionalists: {
        weights: [
          { dim: "ideology", key: "patriots", w: 0.6 },
          { dim: "ideology", key: "gunowners", w: 0.6 },
        ],
      },
      union_trades: {
        weights: [
          { dim: "race", key: "black", w: 0.4 },
          { dim: "ideology", key: "progressives", w: 0.4 },
          { dim: "wealth", key: "low", w: 0.2 },
        ],
      },
      soccer_moms: {
        weights: [
          { dim: "age", key: "mid", w: 0.4 },
          { dim: "wealth", key: "middle", w: 0.4 },
          { dim: "ideology", key: "patriots", w: 0.1 },
        ],
      },
      college_liberals: {
        weights: [
          { dim: "ideology", key: "progressives", w: 0.5 },
          { dim: "ideology", key: "environmentalists", w: 0.4 },
          { dim: "education", key: "college", w: 0.2 },
          { dim: "education", key: "graduate", w: 0.15 },
        ],
      },
      small_business: {
        weights: [
          { dim: "ideology", key: "libertarians", w: 0.5 },
          { dim: "wealth", key: "high", w: 0.4 },
          { dim: "age", key: "mature", w: 0.2 },
        ],
      },
      public_sector: {
        weights: [
          { dim: "ideology", key: "progressives", w: 0.8 },
          { dim: "education", key: "college", w: 0.1 },
          { dim: "education", key: "graduate", w: 0.1 },
        ],
      },
      retirees: {
        weights: [
          { dim: "age", key: "senior", w: 0.6 },
          { dim: "age", key: "mature", w: 0.2 },
        ],
      },
      libertarians: {
        weights: [{ dim: "ideology", key: "libertarians", w: 1.0 }],
      },
      new_immigrants: {
        weights: [
          { dim: "race", key: "hispanic", w: 0.6 },
          { dim: "race", key: "asian", w: 0.3 },
          { dim: "race", key: "other", w: 0.1 },
        ],
        civicMultiplier: 0.75,
      },
      secular_professionals: {
        weights: [
          { dim: "ideology", key: "environmentalists", w: 0.4 },
          { dim: "ideology", key: "progressives", w: 0.4 },
          { dim: "education", key: "graduate", w: 0.25 },
          { dim: "wealth", key: "high", w: 0.2 },
        ],
      },
    },
    turnoutRates: {
      race: { white: 60, black: 52, hispanic: 38, asian: 40, other: 40 },
      age: { young: 42, mid: 58, mature: 66, senior: 72 },
      education: { no_college: 50, college: 62, graduate: 70 },
      wealth: { low: 42, middle: 58, high: 72 },
      ideology: {
        evangelicals: 75,
        environmentalists: 58,
        libertarians: 60,
        progressives: 56,
        patriots: 65,
        gunowners: 64,
      },
    },
    defaultLeans: {
      young_renters: { economicLean: -3.5, socialLean: -3 },
      evangelicals: { economicLean: 3.5, socialLean: 5 },
      rural_traditionalists: { economicLean: 3.5, socialLean: 3.5 },
      union_trades: { economicLean: -3.5, socialLean: 0 },
      soccer_moms: { economicLean: -0.5, socialLean: 0 },
      college_liberals: { economicLean: -4, socialLean: -4 },
      small_business: { economicLean: 4, socialLean: 2 },
      public_sector: { economicLean: -3, socialLean: -2.5 },
      retirees: { economicLean: 0.5, socialLean: 2 },
      libertarians: { economicLean: 5, socialLean: 1 },
      new_immigrants: { economicLean: -2.5, socialLean: -1.5 },
      secular_professionals: { economicLean: -2.5, socialLean: -3.5 },
    },
    defaultTurnouts: {
      young_renters: 44,
      evangelicals: 71,
      rural_traditionalists: 68,
      union_trades: 64,
      soccer_moms: 59,
      college_liberals: 64,
      small_business: 70,
      public_sector: 65,
      retirees: 72,
      libertarians: 65,
      new_immigrants: 38,
      secular_professionals: 66,
    },
  },
  "1999": {
    groupIds: ERA_GROUP_IDS,
    voterGroupComposition: {
      young_renters: {
        weights: [
          { dim: "age", key: "young", w: 0.35 },
          { dim: "wealth", key: "low", w: 0.25 },
          { dim: "education", key: "no_college", w: 0.15 },
        ],
      },
      evangelicals: {
        weights: [
          { dim: "ideology", key: "evangelicals", w: 1.0 },
          { dim: "race", key: "white", w: 0.21 },
        ],
      },
      rural_traditionalists: {
        weights: [
          { dim: "race", key: "white", w: 0.21 },
          { dim: "education", key: "no_college", w: 0.16 },
          { dim: "ideology", key: "patriots", w: 0.4 },
          { dim: "ideology", key: "gunowners", w: 0.39 },
        ],
      },
      union_trades: {
        weights: [
          { dim: "education", key: "no_college", w: 0.22 },
          { dim: "wealth", key: "low", w: 0.32 },
          { dim: "race", key: "black", w: 0.18 },
          { dim: "race", key: "white", w: 0.1 },
        ],
      },
      soccer_moms: {
        weights: [
          { dim: "age", key: "mid", w: 0.42 }, // peak soccer-mom electorate
          { dim: "wealth", key: "middle", w: 0.4 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      college_liberals: {
        weights: [
          { dim: "education", key: "college", w: 0.15 },
          { dim: "education", key: "graduate", w: 0.14 },
          { dim: "ideology", key: "progressives", w: 0.3 },
          { dim: "ideology", key: "environmentalists", w: 0.29 },
          { dim: "race", key: "white", w: 0.1 },
        ],
      },
      small_business: {
        weights: [
          { dim: "wealth", key: "high", w: 0.35 }, // dot-com prosperity
          { dim: "ideology", key: "libertarians", w: 0.34 },
          { dim: "age", key: "mature", w: 0.2 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      public_sector: {
        weights: [
          { dim: "education", key: "college", w: 0.12 },
          { dim: "education", key: "graduate", w: 0.15 },
          { dim: "ideology", key: "progressives", w: 0.3 },
          { dim: "wealth", key: "middle", w: 0.21 },
          { dim: "race", key: "black", w: 0.1 },
        ],
      },
      retirees: {
        weights: [
          { dim: "age", key: "senior", w: 0.39 },
          { dim: "age", key: "mature", w: 0.15 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      libertarians: {
        weights: [
          { dim: "ideology", key: "libertarians", w: 1.0 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      new_immigrants: {
        weights: [
          { dim: "race", key: "hispanic", w: 0.51 },
          { dim: "race", key: "asian", w: 0.29 },
          { dim: "race", key: "other", w: 0.2 },
        ],
        civicMultiplier: 0.78,
      },
      secular_professionals: {
        weights: [
          { dim: "education", key: "graduate", w: 0.2 },
          { dim: "wealth", key: "high", w: 0.2 },
          { dim: "ideology", key: "environmentalists", w: 0.2 },
          { dim: "ideology", key: "progressives", w: 0.2 },
          { dim: "race", key: "white", w: 0.1 },
        ],
      },
    },
    turnoutRates: {
      race: { white: 61, black: 53, hispanic: 40, asian: 43, other: 44 },
      age: { young: 35, mid: 54, mature: 64, senior: 72 }, // 1996/1998 youth-turnout nadir
      education: { no_college: 49, college: 63, graduate: 71 },
      wealth: { low: 41, middle: 57, high: 72 },
      ideology: {
        evangelicals: 74,
        environmentalists: 62,
        libertarians: 61,
        progressives: 59,
        patriots: 65,
        gunowners: 64,
      },
    },
    defaultLeans: {
      young_renters: { economicLean: -3.5, socialLean: -3.5 },
      evangelicals: { economicLean: 4, socialLean: 5 },
      rural_traditionalists: { economicLean: 3.5, socialLean: 3.5 },
      union_trades: { economicLean: -3.5, socialLean: -0.5 },
      soccer_moms: { economicLean: -1, socialLean: -0.5 },
      college_liberals: { economicLean: -4, socialLean: -4.5 },
      small_business: { economicLean: 4, socialLean: 2 },
      public_sector: { economicLean: -3, socialLean: -3 },
      retirees: { economicLean: 1, socialLean: 2 },
      libertarians: { economicLean: 5, socialLean: 1 },
      new_immigrants: { economicLean: -3, socialLean: -1.5 },
      secular_professionals: { economicLean: -3, socialLean: -4 },
    },
    defaultTurnouts: {
      young_renters: 43,
      evangelicals: 70,
      rural_traditionalists: 68,
      union_trades: 62,
      soccer_moms: 58,
      college_liberals: 63,
      small_business: 70,
      public_sector: 64,
      retirees: 72,
      libertarians: 64,
      new_immigrants: 38,
      secular_professionals: 65,
    },
  },
  "2007": {
    groupIds: ERA_GROUP_IDS,
    voterGroupComposition: {
      young_renters: {
        weights: [
          { dim: "age", key: "young", w: 0.35 },
          { dim: "wealth", key: "low", w: 0.25 },
          { dim: "education", key: "no_college", w: 0.15 },
        ],
      },
      evangelicals: {
        weights: [
          { dim: "ideology", key: "evangelicals", w: 1.0 },
          { dim: "race", key: "white", w: 0.2 },
        ],
      },
      rural_traditionalists: {
        weights: [
          { dim: "race", key: "white", w: 0.2 },
          { dim: "education", key: "no_college", w: 0.15 },
          { dim: "ideology", key: "patriots", w: 0.4 },
          { dim: "ideology", key: "gunowners", w: 0.4 },
        ],
      },
      union_trades: {
        weights: [
          { dim: "education", key: "no_college", w: 0.21 },
          { dim: "wealth", key: "low", w: 0.31 },
          { dim: "race", key: "black", w: 0.19 },
          { dim: "race", key: "white", w: 0.1 },
        ],
      },
      soccer_moms: {
        weights: [
          { dim: "age", key: "mid", w: 0.4 },
          { dim: "wealth", key: "middle", w: 0.4 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      college_liberals: {
        weights: [
          { dim: "education", key: "college", w: 0.15 },
          { dim: "education", key: "graduate", w: 0.15 },
          { dim: "ideology", key: "progressives", w: 0.3 },
          { dim: "ideology", key: "environmentalists", w: 0.3 },
          { dim: "race", key: "white", w: 0.1 },
        ],
      },
      small_business: {
        weights: [
          { dim: "wealth", key: "high", w: 0.35 },
          { dim: "ideology", key: "libertarians", w: 0.35 },
          { dim: "age", key: "mature", w: 0.2 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      public_sector: {
        weights: [
          { dim: "education", key: "college", w: 0.12 },
          { dim: "education", key: "graduate", w: 0.15 },
          { dim: "ideology", key: "progressives", w: 0.3 },
          { dim: "wealth", key: "middle", w: 0.2 },
          { dim: "race", key: "black", w: 0.1 },
        ],
      },
      retirees: {
        weights: [
          { dim: "age", key: "senior", w: 0.4 },
          { dim: "age", key: "mature", w: 0.15 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      libertarians: {
        weights: [
          { dim: "ideology", key: "libertarians", w: 1.0 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      new_immigrants: {
        weights: [
          { dim: "race", key: "hispanic", w: 0.5 },
          { dim: "race", key: "asian", w: 0.3 },
          { dim: "race", key: "other", w: 0.2 },
        ],
        civicMultiplier: 0.8,
      },
      secular_professionals: {
        weights: [
          { dim: "education", key: "graduate", w: 0.2 },
          { dim: "wealth", key: "high", w: 0.2 },
          { dim: "ideology", key: "environmentalists", w: 0.2 },
          { dim: "ideology", key: "progressives", w: 0.2 },
          { dim: "race", key: "white", w: 0.1 },
        ],
      },
    },
    turnoutRates: {
      race: { white: 64, black: 58, hispanic: 45, asian: 47, other: 48 },
      age: { young: 42, mid: 56, mature: 66, senior: 74 },
      education: { no_college: 51, college: 65, graduate: 73 },
      wealth: { low: 43, middle: 59, high: 73 },
      ideology: {
        evangelicals: 77, // 2004 values-voter mobilization peak
        environmentalists: 64,
        libertarians: 62,
        progressives: 63, // netroots / anti-war organizing
        patriots: 68,
        gunowners: 66,
      },
    },
    defaultLeans: {
      young_renters: { economicLean: -4, socialLean: -4 },
      evangelicals: { economicLean: 4, socialLean: 5 },
      rural_traditionalists: { economicLean: 4, socialLean: 4 },
      union_trades: { economicLean: -3, socialLean: -0.5 },
      soccer_moms: { economicLean: -1, socialLean: -0.5 },
      college_liberals: { economicLean: -4.5, socialLean: -5 },
      small_business: { economicLean: 4, socialLean: 2 },
      public_sector: { economicLean: -3, socialLean: -3 },
      retirees: { economicLean: 1, socialLean: 2 },
      libertarians: { economicLean: 5, socialLean: 1 },
      new_immigrants: { economicLean: -3, socialLean: -2 },
      secular_professionals: { economicLean: -3, socialLean: -4.5 },
    },
    defaultTurnouts: {
      young_renters: 45,
      evangelicals: 72,
      rural_traditionalists: 70,
      union_trades: 62,
      soccer_moms: 60,
      college_liberals: 65,
      small_business: 71,
      public_sector: 66,
      retirees: 75,
      libertarians: 66,
      new_immigrants: 40,
      secular_professionals: 67,
    },
  },
  "2019": {
    groupIds: ERA_GROUP_IDS,
    voterGroupComposition: VOTER_GROUP_COMPOSITION,
    turnoutRates: DEMOGRAPHIC_TURNOUT_RATES,
    defaultLeans: {
      young_renters: { economicLean: -4, socialLean: -4 },
      evangelicals: { economicLean: 4, socialLean: 5 },
      rural_traditionalists: { economicLean: 4, socialLean: 4 },
      union_trades: { economicLean: -3, socialLean: -0.5 },
      soccer_moms: { economicLean: -1, socialLean: -0.5 },
      college_liberals: { economicLean: -4.5, socialLean: -5 },
      small_business: { economicLean: 4, socialLean: 2 },
      public_sector: { economicLean: -3, socialLean: -3 },
      retirees: { economicLean: 1, socialLean: 2 },
      libertarians: { economicLean: 5, socialLean: 1 },
      new_immigrants: { economicLean: -3, socialLean: -2 },
      secular_professionals: { economicLean: -3, socialLean: -4.5 },
    },
    defaultTurnouts: {
      young_renters: 46,
      evangelicals: 73,
      rural_traditionalists: 71,
      union_trades: 63,
      soccer_moms: 60,
      college_liberals: 67,
      small_business: 72,
      public_sector: 67,
      retirees: 76,
      libertarians: 68,
      new_immigrants: 42,
      secular_professionals: 68,
    },
  },
  "2023": {
    groupIds: ERA_GROUP_IDS,
    voterGroupComposition: {
      young_renters: {
        weights: [
          { dim: "age", key: "young", w: 0.35 },
          { dim: "wealth", key: "low", w: 0.26 }, // housing-cost squeeze widens the renter class
          { dim: "education", key: "no_college", w: 0.14 },
        ],
      },
      evangelicals: {
        weights: [
          { dim: "ideology", key: "evangelicals", w: 1.0 },
          { dim: "race", key: "white", w: 0.18 }, // growing latino-evangelical share
        ],
      },
      rural_traditionalists: {
        weights: [
          { dim: "race", key: "white", w: 0.2 },
          { dim: "education", key: "no_college", w: 0.16 }, // education realignment deepens
          { dim: "ideology", key: "patriots", w: 0.4 },
          { dim: "ideology", key: "gunowners", w: 0.4 },
        ],
      },
      union_trades: {
        weights: [
          { dim: "education", key: "no_college", w: 0.2 },
          { dim: "wealth", key: "low", w: 0.29 },
          { dim: "race", key: "black", w: 0.2 },
          { dim: "race", key: "hispanic", w: 0.06 }, // growing latino trades cohort
          { dim: "race", key: "white", w: 0.08 },
        ],
      },
      soccer_moms: {
        weights: [
          { dim: "age", key: "mid", w: 0.4 },
          { dim: "wealth", key: "middle", w: 0.4 },
          { dim: "race", key: "white", w: 0.14 },
        ],
      },
      college_liberals: {
        weights: [
          { dim: "education", key: "college", w: 0.17 },
          { dim: "education", key: "graduate", w: 0.17 }, // largest college cohort of any era
          { dim: "ideology", key: "progressives", w: 0.3 },
          { dim: "ideology", key: "environmentalists", w: 0.3 },
          { dim: "race", key: "white", w: 0.09 },
        ],
      },
      small_business: {
        weights: [
          { dim: "wealth", key: "high", w: 0.35 },
          { dim: "ideology", key: "libertarians", w: 0.35 },
          { dim: "age", key: "mature", w: 0.2 },
          { dim: "race", key: "white", w: 0.14 },
        ],
      },
      public_sector: {
        weights: [
          { dim: "education", key: "college", w: 0.13 },
          { dim: "education", key: "graduate", w: 0.16 },
          { dim: "ideology", key: "progressives", w: 0.3 },
          { dim: "wealth", key: "middle", w: 0.19 },
          { dim: "race", key: "black", w: 0.1 },
        ],
      },
      retirees: {
        weights: [
          { dim: "age", key: "senior", w: 0.42 }, // boomer retirement bulge
          { dim: "age", key: "mature", w: 0.14 },
          { dim: "race", key: "white", w: 0.15 },
        ],
      },
      libertarians: {
        weights: [
          { dim: "ideology", key: "libertarians", w: 1.0 },
          { dim: "race", key: "white", w: 0.14 },
        ],
      },
      new_immigrants: {
        weights: [
          { dim: "race", key: "hispanic", w: 0.48 },
          { dim: "race", key: "asian", w: 0.32 }, // fastest-growing naturalized cohort
          { dim: "race", key: "other", w: 0.2 },
        ],
        civicMultiplier: 0.85, // naturalized-citizen registration gap narrowing
      },
      secular_professionals: {
        weights: [
          { dim: "education", key: "graduate", w: 0.21 },
          { dim: "wealth", key: "high", w: 0.2 },
          { dim: "ideology", key: "environmentalists", w: 0.2 },
          { dim: "ideology", key: "progressives", w: 0.2 },
          { dim: "race", key: "white", w: 0.09 },
        ],
      },
    },
    turnoutRates: {
      race: { white: 65, black: 60, hispanic: 50, asian: 56, other: 54 },
      age: { young: 45, mid: 58, mature: 66, senior: 76 }, // post-2020 youth surge persists
      education: { no_college: 53, college: 68, graduate: 76 },
      wealth: { low: 46, middle: 61, high: 75 },
      ideology: {
        evangelicals: 78,
        environmentalists: 68,
        libertarians: 65,
        progressives: 68, // anger-driven mobilization both poles
        patriots: 71,
        gunowners: 68,
      },
    },
    defaultLeans: {
      young_renters: { economicLean: -4.5, socialLean: -4.5 },
      evangelicals: { economicLean: 4.5, socialLean: 5 },
      rural_traditionalists: { economicLean: 4.5, socialLean: 4.5 },
      union_trades: { economicLean: -2.5, socialLean: 0.5 }, // continued working-class right drift
      soccer_moms: { economicLean: -1.5, socialLean: -1 }, // suburban realignment post-2016
      college_liberals: { economicLean: -5, socialLean: -5 },
      small_business: { economicLean: 4, socialLean: 2.5 },
      public_sector: { economicLean: -3, socialLean: -3.5 },
      retirees: { economicLean: 1.5, socialLean: 2 },
      libertarians: { economicLean: 5, socialLean: 1 },
      new_immigrants: { economicLean: -2.5, socialLean: -1.5 }, // hispanic right drift
      secular_professionals: { economicLean: -3, socialLean: -5 },
    },
    defaultTurnouts: {
      young_renters: 50,
      evangelicals: 74,
      rural_traditionalists: 72,
      union_trades: 63,
      soccer_moms: 62,
      college_liberals: 70,
      small_business: 73,
      public_sector: 68,
      retirees: 78,
      libertarians: 69,
      new_immigrants: 45,
      secular_professionals: 70,
    },
  },
};

export interface DemographicPosition {
  economicLean: number; // -5..+5
  socialLean: number; // -5..+5
}

/** Per-era econ/social position of each Layer-1 demographic key. Drives
 *  deriveGroupLeanFromLayer1 when the feature flag is enabled. Authored/tuned
 *  via scripts/calibrate-layer1-positions.ts to match each era's defaultLeans. */
export const DEMOGRAPHIC_POSITIONS: Record<
  EraId,
  Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>>
> = {
  "2019": {
    race: {
      // `white` is ~60-80% of every state and high-turnout, so its position sets the
      // baseline level for ALL states. Kept modest so blue states aren't dragged right —
      // per-state character lives in each state's `stateCensusData` position overrides
      // (white / no_college / middle / senior), calibrated 2026-08 against real 2020
      // two-party margins so every state's turnout-weighted mean lean matches its
      // real-world lean (scripts/calibrate-2019-state-positions.ts). Before that
      // recalibration the electorate aggregated ~0.72 left of centre with no
      // conservative tail anywhere, and a mirrored presidential race broke 429/106 EV.
      white: { economicLean: 0.8, socialLean: 1 },
      black: { economicLean: -4, socialLean: -2.5 },
      hispanic: { economicLean: -3, socialLean: -2 },
      asian: { economicLean: -2.5, socialLean: -2.5 },
      other: { economicLean: -2, socialLean: -1.5 },
    },
    age: {
      // young/mature are NOT state-overridden, so their values reach every state's
      // cells directly; 2026-08: young -3.5→-3, mature 0.8→1.4 (part of the
      // recentring — the old table made a strongly conservative cell unreachable).
      young: { economicLean: -3, socialLean: -3 },
      mid: { economicLean: -0.5, socialLean: -0.5 },
      mature: { economicLean: 1.4, socialLean: 1.4 },
      senior: { economicLean: 1.2, socialLean: 2 },
    },
    education: {
      no_college: { economicLean: 0.5, socialLean: 2 },
      college: { economicLean: -1.5, socialLean: -2 },
      graduate: { economicLean: -3.5, socialLean: -4.5 },
    },
    wealth: {
      low: { economicLean: -2.5, socialLean: -0.5 },
      middle: { economicLean: 0.2, socialLean: 0.3 },
      // high is not state-overridden; 2026-08: 2→2.6 (recentring, see race.white note).
      high: { economicLean: 2.6, socialLean: -0.5 },
    },
    ideology: {
      evangelicals: { economicLean: 4, socialLean: 5 },
      environmentalists: { economicLean: -4.5, socialLean: -4.5 },
      libertarians: { economicLean: 5, socialLean: 0 },
      progressives: { economicLean: -5, socialLean: -5 },
      patriots: { economicLean: 3.5, socialLean: 4 },
      gunowners: { economicLean: 3.5, socialLean: 3.5 },
    },
  },
  "1953": {} as Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>>,
  "1979": {} as Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>>,
  "1991": {} as Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>>,
  "1999": {} as Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>>,
  "2007": {} as Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>>,
  "2023": {} as Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>>,
};

/**
 * Per-era position deltas from the 2019 base, capturing each era's demographic character.
 * The era census shares + composition weights already differ per era; these overrides add the
 * era-specific *positions* of demographic groups. Each entry is [dim, key, economicLean, socialLean].
 * Anchored to the era notes in ERA_COMPOSITIONS. 2019 is the base table;
 * every other era overlays the entries below (including a full 2007 table).
 */
const ERA_POSITION_OVERRIDES: Partial<
  Record<EraId, Array<[keyof DemographicTurnoutRates, string, number, number]>>
> = {
  // 1952 presidential anchor (Eisenhower landslide 55.2% vs Stevenson 44.3%).
  // The table is calibrated to the 1952 VOTE, not the FDR-era REGISTRATION
  // picture: registration was still heavily Democratic (Solid South, union
  // rolls), but the electorate that actually voted broke ~R+11 nationally.
  // Gallup 1952: Ike won college voters ~2:1, the middle class and suburbs
  // decisively, and every age cohort; Stevenson held union households,
  // low-income and grade-school-only voters, and Black voters (though Ike took
  // ~21% of the Black vote — far more than post-1964 Republicans). The Solid
  // South stayed Democratic — that regional counterweight lives in
  // STATE_POSITION_OVERRIDES["1953"] below (applied via getEraPositions(era,
  // stateId)), so THIS era-wide table carries the non-South national baseline.
  // Population-weighted aggregate over the census dims (race/age/education/
  // wealth × 1953-preset census shares) lands at ~+0.36 econ — a mild R tilt
  // reflecting the '52 landslide over an underlying Dem-registration floor
  // (the pre-recalibration table aggregated to ~−1.3, seeding a uniformly
  // left electorate that re-elected a Democrat 79/21 in 1956 sims).
  "1953": [
    ["race", "white", 1.5, 0.5], // Ike won whites solidly outside the South (South overridden per state)
    ["age", "senior", -0.5, 0.3], // FDR generation — most Democratic cohort economically (New Deal loyalty), socially traditional
    ["age", "mature", 0.9, 0.5], // Established workforce broke for Ike; socially traditional
    ["age", "mid", 0.5, 0.3], // Korean War vets: Ike-leaning, union cross-pressure
    ["age", "young", 0, -0.3], // Post-WWII generation: union households vs "I Like Ike" — split; pre-counterculture
    ["ideology", "evangelicals", 1, 2], // Pre-Moral Majority: religious but socially center-right, not yet weaponized
    ["ideology", "patriots", 2, 1.5], // Korean War / WWII patriotism leans Republican (Eisenhower effect)
    ["ideology", "gunowners", 1.5, 1], // Rural hunters, slight Republican lean but lower salience
    ["ideology", "progressives", -5, -5], // Labor left — strongly Democratic
    ["ideology", "environmentalists", -2, -2], // Conservation wing (FDR-era Pinchot tradition), Democratic
    ["education", "no_college", -0.2, 0.6], // Peak union density ~25% keeps the working class D-leaning economically, but socially traditional; Ike carried HS-educated voters
    ["education", "graduate", 0.8, -1], // Professionals R-leaning in '52; Stevenson's academic "eggheads" a minority slice
    ["education", "college", 1.6, -0.3], // College voters went ~2:1 Eisenhower (pre-realignment inverse of 2019)
    ["wealth", "low", -2.5, -0.6], // Low-income FDR coalition — the strongest remaining Democratic bloc (econ-left, socially traditional)
    ["wealth", "middle", 1, 0.6], // Middle class / suburbs: decisively Eisenhower, era of conformity
    ["wealth", "high", 3.2, 0.8], // Business class — Republican (anti-New Deal economic right)
    ["race", "black", -3.5, -2], // Strongly Democratic (Truman deseg 1948 + FDR coalition), Ike ~21%; suppressed in South
    ["race", "hispanic", -2, -1], // Southwest Democratic lean; labor/agrarian coalition, Ike inroads
    ["race", "asian", -1, -1], // Post-WWII anti-discrimination sentiment, mild Democratic lean
    ["race", "other", -1, -1], // Broadly Democratic minority lean, tempered by the '52 wave
  ],
  // 1980 presidential anchor (Reagan landslide). Positions tuned to produce
  // state leans on the -5..+5 scale matching 1980 election results.
  // Spread target: DC ~ -4.5, UT ~ +3.5, most states between -2 and +2.
  "1979": [
    ["race", "white", 1.5, 1.5], // Reagan won whites by ~15pts, but not uniform
    ["age", "senior", 0.5, 1.5], // Seniors split, slightly Republican on social
    ["age", "mature", 0.5, 0.5], // Middle-aged split
    ["age", "mid", -0.5, -0.5], // Swing / slightly Democratic
    ["age", "young", -2.5, -2.5], // Carter won young
    ["ideology", "evangelicals", 4.5, 5], // Strongly Republican
    ["ideology", "patriots", 4.5, 4.5], // Strongly Republican
    ["ideology", "gunowners", 4.5, 4], // Strongly Republican
    ["ideology", "progressives", -5, -5], // Strongly Democratic
    ["ideology", "environmentalists", -4.5, -4.5], // Democratic
    ["education", "no_college", 0.5, 1.5], // Working class split, slightly Republican on social
    ["education", "graduate", -3.5, -4], // Democratic
    ["education", "college", -2, -2.5], // Democratic
    ["wealth", "low", -4, -1.5], // Democratic
    ["wealth", "middle", 0.5, 0.5], // Middle class split
    ["wealth", "high", 3, -0.5], // Republican econ, libertarian social
    ["race", "black", -5, -3], // Strongly Democratic
    ["race", "hispanic", -3.5, -2.5], // Democratic
    ["race", "asian", -3, -3], // Democratic
    ["race", "other", -2.5, -2], // Democratic
  ],
  // 1992 presidential anchor (Clinton victory). White working class drifting right but
  // still cross-pressured; Christian Coalition high tide; education polarization milder than 2019.
  "1991": [
    ["race", "white", 1.0, 1.5], // Clinton lost whites by ~10pts, but not uniform
    ["age", "senior", 0.5, 1.5], // Seniors slightly Republican on social
    ["age", "mature", 0.5, 0.5], // Middle-aged split
    ["age", "mid", -0.5, -0.5], // Swing / slightly Democratic
    ["age", "young", -3.0, -3.0], // Clinton won young strongly
    ["ideology", "evangelicals", 4.0, 5], // Christian Coalition high tide
    ["ideology", "patriots", 3.5, 4], // Gulf War patriotism
    ["ideology", "gunowners", 3.5, 3.5], // Strong in rural South/West
    ["ideology", "progressives", -5, -5], // Strongly Democratic
    ["ideology", "environmentalists", -4, -4], // Post-Earth Day presence
    ["education", "no_college", 0.5, 1.5], // Reagan Democrats still drifting right
    ["education", "graduate", -3, -4], // Democratic
    ["education", "college", -1.5, -2], // Democratic
    ["wealth", "low", -3, -1], // Democratic
    ["wealth", "middle", 0.5, 0.5], // Middle class split
    ["wealth", "high", 2.5, -0.5], // Republican econ, libertarian social
    ["race", "black", -4.5, -2.5], // Strongly Democratic
    ["race", "hispanic", -3, -2], // Democratic
    ["race", "asian", -2.5, -2.5], // Democratic
    ["race", "other", -2, -1.5], // Democratic
  ],
  // 2000 presidential anchor (Bush 47.9 / Gore 48.4 — the closest cycle in the
  // series). Partisan sorting is under way but the education realignment is
  // roughly half its 2019 depth, and the age curve has not yet inverted: in
  // 2000 SENIORS were the most economically Democratic cohort (Social Security
  // and the prescription-drug fight were Gore's closing argument), while young
  // voters split near-evenly. Asian voters had only recently begun their move
  // to the Democrats (~55% Gore, versus the near-2:1 margins of the 2010s).
  // Authored in full: with the clock live, a sparse anchor is not
  // "unspecified", it is the 2019 table wearing a 2000 label.
  "1999": [
    ["race", "white", 0.6, 1.2],
    ["race", "black", -4.5, -2.5],
    ["race", "hispanic", -3.2, -2.2],
    ["race", "asian", -1.5, -2.0], // pre-realignment: Gore ~55%, not the 2:1 of later cycles
    ["race", "other", -2.0, -1.5],
    ["age", "young", -1.5, -2.0], // 2000 youth split nearly evenly — no Obama/Gen-Z gap yet
    ["age", "mid", -0.3, -0.3],
    ["age", "mature", 0.5, 0.8],
    ["age", "senior", 0.5, 1.5], // econ-left on entitlements, socially traditional
    ["education", "no_college", 0.3, 1.5],
    ["education", "college", -1.0, -1.5],
    ["education", "graduate", -3.0, -4.0],
    ["wealth", "low", -3.0, -1.0],
    ["wealth", "middle", 0.3, 0.5],
    ["wealth", "high", 2.5, -0.5],
    ["ideology", "evangelicals", 4.5, 5],
    ["ideology", "environmentalists", -4.5, -4.5],
    ["ideology", "libertarians", 5, 0],
    ["ideology", "progressives", -5, -5],
    ["ideology", "patriots", 3.5, 4],
    ["ideology", "gunowners", 4.0, 4.0],
  ],
  // 2008 presidential anchor (Obama 52.9 / McCain 45.7). The age gap opens
  // decisively — Obama carried 18-29 by ~34 points while McCain won seniors,
  // inverting the 2000 relationship — and Black turnout and margin both peak.
  // The education gradient deepens but has not reached its 2019 extreme.
  "2007": [
    ["race", "white", 1.0, 1.2], // Obama lost white voters by ~12
    ["race", "black", -5, -3], // ~95% Obama, peak consolidation
    ["race", "hispanic", -3.5, -2.2],
    ["race", "asian", -3.0, -2.5],
    ["race", "other", -2.5, -2.0],
    ["age", "young", -4.0, -4.0], // the defining gap of the cycle
    ["age", "mid", -0.5, -0.5],
    ["age", "mature", 0.8, 1.0],
    ["age", "senior", 1.5, 2.2], // McCain's only winning age cohort
    ["education", "no_college", 0.5, 1.8],
    ["education", "college", -1.2, -1.8],
    ["education", "graduate", -3.5, -4.5],
    ["wealth", "low", -3.0, -1.0],
    ["wealth", "middle", 0.0, 0.3],
    ["wealth", "high", 1.5, -1.2], // financial-crisis year: high earners least Republican of the series
    ["ideology", "evangelicals", 4.5, 5],
    ["ideology", "environmentalists", -4.5, -4.5],
    ["ideology", "libertarians", 5, 0],
    ["ideology", "progressives", -5, -5],
    ["ideology", "patriots", 3.5, 4],
    ["ideology", "gunowners", 3.8, 3.8],
  ],
  // Education realignment peak; working-class (non-college) right drift; hispanic right drift;
  // Gen-Z entry pulls young further left.
  "2023": [
    ["education", "no_college", 1.5, 2.5],
    ["education", "graduate", -4, -5],
    ["education", "college", -2, -2.5],
    ["race", "hispanic", -2, -1],
    ["age", "young", -4, -4],
    ["race", "white", 1.2, 1.2],
  ],
};

// Build each non-2019 era from the 2019 base + its overrides.
for (const era of ["1953", "1979", "1991", "1999", "2007", "2023"] as const) {
  if (Object.keys(DEMOGRAPHIC_POSITIONS[era]).length === 0) {
    DEMOGRAPHIC_POSITIONS[era] = JSON.parse(JSON.stringify(DEMOGRAPHIC_POSITIONS["2019"]));
  }
  for (const [dim, key, econ, social] of ERA_POSITION_OVERRIDES[era] ?? []) {
    DEMOGRAPHIC_POSITIONS[era][dim][key] = { economicLean: econ, socialLean: social };
  }
}

/**
 * Per-state, per-era position overrides for Layer-1 demographics.
 * Allows whites in MA to lean Democratic while whites in GA lean Republican.
 * Each entry: [dimension, key, economicLean, socialLean].
 */
const STATE_POSITION_OVERRIDES: Partial<
  Record<EraId, Record<string, Array<[keyof DemographicTurnoutRates, string, number, number]>>>
> = {
  // 1953: The Solid South — every Deep South state is HEAVILY Democratic in registration.
  // Whites in the South lean strongly Democratic (opposite of all later eras).
  // Northern/Rust Belt whites remain union-Democratic. Mountain West leans Republican.
  //
  // Two mechanics notes (2026-07 recalibration):
  //  • The 1953 archetype composition contains NO `race.white` weight, so the
  //    white overrides flow into the granular-cell electorate but barely into
  //    archetype leans. The Solid South's party-D anchor therefore ALSO
  //    overrides the ideology buckets that DO carry archetype weight
  //    (evangelicals/patriots/gunowners): in 1953 the white southern
  //    evangelical/rural-patriot bloc was yellow-dog DEMOCRATIC — the Moral
  //    Majority realignment is decades away. Symmetrically, VT/NH/ME and the
  //    Pacific coast override `progressives` rightward (Yankee reform /
  //    Warren-era Republicans), since their modern-shaped ideology census
  //    shares otherwise drag these Ike-landslide states left.
  //  • The white entries authored as R-relative-to-baseline (Mountain West /
  //    Plains / northern New England / Pacific) are re-based +1.0 econ /
  //    +0.3 social — the same shift race.white received in the era-wide table
  //    (0.5→1.5 / 0→0.3) — preserving their authored deltas. The Solid South /
  //    Border / Northeast values are ABSOLUTE registration anchors and stay
  //    as authored.
  "1953": {
    // Deep Solid South — white voters + the evangelical/rural blocs strongly
    // Democratic (opposition to GOP = Reconstruction legacy; Stevenson won
    // AL D+29.9, MS D+20.8, SC D+1.5, GA D+39.4, LA D+5.8, AR D+12.1).
    AL: [
      ["race", "white", -2.4, 4],
      ["ideology", "evangelicals", -2, 2],
      ["ideology", "patriots", -1.5, 1.5],
      ["ideology", "gunowners", -1.5, 1],
    ],
    MS: [
      ["race", "white", 0.3, 4.5],
      ["ideology", "evangelicals", -2, 2],
      ["ideology", "patriots", -1.5, 1.5],
      ["ideology", "gunowners", -1.5, 1],
    ],
    SC: [
      ["race", "white", -0.6, 4.2],
      ["ideology", "evangelicals", -2, 2],
      ["ideology", "patriots", -1.5, 1.5],
      ["ideology", "gunowners", -1.5, 1],
    ],
    LA: [
      ["race", "white", -1.1, 3.5],
      ["ideology", "evangelicals", -1.5, 2],
      ["ideology", "patriots", -1, 1.5],
      ["ideology", "gunowners", -1, 1],
    ],
    GA: [
      ["race", "white", -2.5, 4],
      ["ideology", "evangelicals", -1.5, 2],
      ["ideology", "patriots", -1, 1.5],
      ["ideology", "gunowners", -1, 1],
    ],
    AR: [
      // Deep-strength overrides: AR stayed D+12.1 in '52 despite the wave.
      ["race", "white", -1.1, 3],
      ["ideology", "evangelicals", -2, 2],
      ["ideology", "patriots", -1.5, 1.5],
      ["ideology", "gunowners", -1.5, 1],
    ],
    NC: [
      ["race", "white", 0.3, 2.5],
      ["ideology", "evangelicals", -1, 2],
      ["ideology", "patriots", -0.5, 1.5],
      ["ideology", "gunowners", -0.5, 1],
    ],
    // Peripheral South — Ike cracked these in '52 (TX R+6.6, FL R+10.0,
    // VA R+12.9, TN R+0.3). 2026-08 recalibration: white values are now
    // solved per state against the 1952 VOTE (target = -margin/30, same
    // mapping as the 2019 calibration) via
    // scripts/calibrate-1953-state-positions.ts — the old D-tinged
    // registration anchors left every Ike state with a Democratic-mean
    // electorate and the sim re-electing Democrats through the 1950s.
    // No ideology-bloc override, letting the national wave carry them.
    TX: [["race", "white", 0.8, 2.4]],
    FL: [["race", "white", 1.1, 2.3]],
    VA: [["race", "white", 1.3, 3.2]],
    TN: [["race", "white", 0.5, 2]],
    // Border South — still leaning Democratic but less intense
    KY: [["race", "white", 0.3, 1.5]],
    WV: [
      // Union + South: very Democratic — coal-union whites held D+3.8 in '52;
      // the rural-patriot bloc here is union-Democratic, not Republican.
      ["race", "white", 0, 1],
      ["ideology", "patriots", -1, 1],
      ["ideology", "gunowners", -1, 0.5],
    ],
    MO: [["race", "white", -0.1, 1.3]],
    OK: [["race", "white", 0.4, 1.9]],
    // Northeast / Rust Belt — union + FDR coalition in registration, but the
    // '52 VOTE is the anchor (Ike swept the region: NY R+11.9, MA R+8.8,
    // WI R+22.2): whites sit modestly right so state means match the vote;
    // the D registration story survives in the minority/low-income/young cells.
    MA: [["race", "white", -0.4, -0.5]],
    RI: [["race", "white", -0.6, -0.5]],
    NY: [["race", "white", 0.1, -1.1]],
    CT: [["race", "white", -0.6, -0.5]],
    NJ: [["race", "white", 0, -0.3]],
    PA: [["race", "white", -0.1, -0.2]],
    MI: [["race", "white", 0, -0.9]], // UAW/CIO stronghold
    WI: [["race", "white", 0.6, -0.5]],
    OH: [["race", "white", 0.1, 0]],
    IL: [["race", "white", -0.1, -0.4]],
    MN: [["race", "white", 0, -1.3]],
    // Mountain West / Plains — the Republican heartland (even in 1953);
    // re-based +1.0/+0.3 with the era-wide white baseline.
    UT: [["race", "white", 0.5, 2.2]], // LDS Republican stronghold
    ID: [["race", "white", 1.7, 1.4]],
    WY: [["race", "white", 0.8, 1.1]],
    ND: [["race", "white", 2.5, 0.9]],
    SD: [["race", "white", 2.4, 0.9]],
    NE: [["race", "white", 2, 1]],
    KS: [["race", "white", 2.1, 0.8]],
    IA: [["race", "white", 1.3, 0.6]], // Farm-Republican lean
    // New England — split: Vermont/Maine Republican, MA Catholic Democratic.
    // The 1953 "progressive" bucket here is the Yankee reform tradition —
    // REPUBLICAN in this era (VT was the strongest GOP state in '52, R+43.3).
    VT: [
      ["race", "white", 2.5, -0.4], // Yankee Republican — strongest GOP bastion in 1953
      ["ideology", "progressives", -2, -3],
      ["ideology", "environmentalists", -0.5, -1],
    ],
    NH: [
      ["race", "white", 0.6, 0.4],
      ["ideology", "progressives", -2.5, -3],
    ],
    ME: [
      ["race", "white", 1.8, 0.2],
      ["ideology", "progressives", -2.5, -3],
    ],
    // Pacific Coast — Warren-era Republican California (R+13.6), OR R+21.6,
    // WA R+9.6: moderate whites, reform-Republican "progressive" tradition.
    CA: [
      ["race", "white", 0.3, 0.5],
      ["ideology", "progressives", -3, -3.5],
    ],
    OR: [
      ["race", "white", 0.7, 0.3],
      ["ideology", "progressives", -3, -3.5],
    ],
    WA: [
      ["race", "white", -0.1, -0.2],
      ["ideology", "progressives", -3.5, -4],
    ],
    // Remaining states (2026-08 recalibration): white solved per state against
    // the 1952 two-party vote via scripts/calibrate-1953-state-positions.ts —
    // these had no authored entry, so the era-wide white (1.5/0.5) undershot
    // the Ike landslide in the Mountain West / Southwest and the Border.
    MD: [["race", "white", 0.4, 1.4]],
    DE: [["race", "white", -0.3, 0.9]],
    IN: [["race", "white", 0.6, 0.7]],
    MT: [["race", "white", 0.9, 1]],
    CO: [["race", "white", 0.8, 0.7]],
    NM: [["race", "white", 2.1, 1.1]],
    AZ: [["race", "white", 1.1, 1.4]],
    NV: [["race", "white", 0.8, 1]],
  },
  "1979": {
    // Northeast — white working class still Democratic in 1980
    MA: [["race", "white", -0.5, -1.8]],
    RI: [["race", "white", -0.5, -1.2]],
    NY: [["race", "white", -0.5, -1.4]],
    CT: [["race", "white", -0.5, -1]],
    NJ: [["race", "white", -0.5, -0.6]],
    // Rust Belt — union/working-class Democratic
    PA: [["race", "white", 0, 0.8]],
    MI: [["race", "white", 0, 0.8]],
    WI: [["race", "white", 0, 0.2]],
    OH: [["race", "white", 0.5, 1]],
    IL: [["race", "white", -0.5, 0.4]],
    MN: [["race", "white", -1, -0.4]],
    IA: [["race", "white", 0.5, 0.8]],
    MO: [["race", "white", 0.5, 1.8]],
    // Upper South / Border — moderate, some Democratic residue
    WV: [["race", "white", -0.5, 2]],
    KY: [["race", "white", 0.5, 2.4]],
    TN: [["race", "white", 1, 2.6]],
    AR: [["race", "white", 1, 2.8]],
    // Deep South — strongly Republican by 1980
    AL: [["race", "white", 2.5, 3.5]],
    MS: [["race", "white", 2.5, 3.5]],
    LA: [["race", "white", 2, 3]],
    SC: [["race", "white", 2, 3.2]],
    NC: [["race", "white", 1.5, 2.6]],
    // Mountain West — strongly Republican
    UT: [["race", "white", 3, 3.4]],
    ID: [["race", "white", 3, 2.6]],
    WY: [["race", "white", 3, 2]],
    AK: [["race", "white", 2, 1.4]],
    MT: [["race", "white", 2, 1.2]],
    ND: [["race", "white", 2, 1.6]],
    SD: [["race", "white", 2, 1.6]],
    NE: [["race", "white", 2, 1.8]],
    KS: [["race", "white", 2, 1.6]],
    OK: [["race", "white", 2, 2.6]],
    // Pacific Coast — Democratic
    CA: [["race", "white", -1, -0.6]],
    OR: [["race", "white", -0.5, -0.8]],
    WA: [["race", "white", -0.5, -0.6]],
    HI: [["race", "white", -1, -1.2]],
    // Southwest — mixed
    AZ: [["race", "white", 1, 1.6]],
    NM: [["race", "white", 0, 0.8]],
    NV: [["race", "white", 0.5, 0.6]],
    CO: [["race", "white", 0.5, 0.2]],
    // New England / Liberal
    VT: [["race", "white", -1, -1]],
    NH: [["race", "white", 0, 0.4]],
    ME: [["race", "white", 0, -0.4]],
    DE: [["race", "white", -0.5, -0.4]],
    MD: [["race", "white", -1, -0.8]],
    DC: [["race", "white", -2, -1.5]],
    VA: [["race", "white", 0.5, 2.8]],
    FL: [["race", "white", 1, 1.8]],
    TX: [["race", "white", 1.5, 2.4]],
    IN: [["race", "white", 1, 1.4]],
    // Carter's home state + Democratic holdouts
    GA: [["race", "white", 0.5, 3.2]], // override: Carter home state effect
  },
  // 1992 presidential anchor (Clinton 43.0 / Bush 37.4 / Perot 18.9).
  //
  // Authored because the table previously stopped at 1979, and with the era
  // clock live an absent anchor is not neutral — every state's regional
  // character would be carried forward from 1980 unchanged for forty years.
  // (`eraPositionsForYear.ts` carries it forward rather than letting it decay,
  // which is safe, but real anchors are better than a frozen one.)
  //
  // The story of this map versus 1979: the Deep South keeps moving right while
  // APPALACHIA HAS NOT YET FLIPPED. Clinton carried West Virginia by 13 and
  // Kentucky by 3 — the New Deal coalition still held there on economics even
  // as it collapsed further south. WV is authored economically LEFT of the
  // national white baseline here and reverses hard by 2019, which is the
  // single largest regional swing in the series and should be visible as such.
  "1991": {
    // Deep South — white defection continues past the Reagan realignment.
    MS: [["race", "white", 3, 3.2]],
    AL: [["race", "white", 3.0, 3.0]],
    SC: [["race", "white", 2.5, 3]],
    LA: [["race", "white", 2.2, 2.8]],
    GA: [["race", "white", 2, 2.6]],
    NC: [["race", "white", 2.0, 2.2]],
    OK: [["race", "white", 2.5, 2.6]],
    TX: [["race", "white", 1.8, 2.2]],
    VA: [["race", "white", 1.8, 2.0]],
    FL: [["race", "white", 1.5, 1.4]],
    TN: [["race", "white", 1.5, 2.4]], // Gore on the ticket blunts the drift
    AR: [["race", "white", 0.5, 2.2]], // Clinton's home state — a +17.7 outlier
    // Appalachia / Border — still Democratic on economics in 1992.
    WV: [["race", "white", -1, 1.8]], // Clinton +13; socially traditional, econ-left
    KY: [["race", "white", 1, 2.2]],
    MO: [["race", "white", 0.8, 1.6]],
    // Mountain West / Plains — the most Republican region of the cycle.
    UT: [["race", "white", 3.5, 3.4]],
    ID: [["race", "white", 3.2, 2.8]],
    WY: [["race", "white", 2.8, 2]],
    NE: [["race", "white", 2.2, 1.8]],
    KS: [["race", "white", 2.2, 1.6]],
    AK: [["race", "white", 2.2, 1.2]],
    ND: [["race", "white", 2, 1.4]],
    SD: [["race", "white", 2, 1.4]],
    AZ: [["race", "white", 2, 1.4]],
    MT: [["race", "white", 1.5, 1]],
    NV: [["race", "white", 1.2, 0.4]],
    CO: [["race", "white", 1.2, 0]],
    NM: [["race", "white", 0.5, 0.6]],
    // Rust Belt / Midwest — union economics still binding.
    IN: [["race", "white", 1.5, 1.4]],
    OH: [["race", "white", 0.8, 0.8]],
    IA: [["race", "white", 0.3, 0.6]],
    PA: [["race", "white", 0.3, 0.6]],
    MI: [["race", "white", 0.2, 0.4]],
    WI: [["race", "white", 0, 0]],
    IL: [["race", "white", -0.3, 0.2]],
    MN: [["race", "white", -0.5, -0.6]],
    // Northeast.
    NH: [["race", "white", 0.8, 0.2]],
    NJ: [["race", "white", -0.3, -0.8]],
    DE: [["race", "white", -0.5, -0.6]],
    ME: [["race", "white", -0.5, -0.8]],
    CT: [["race", "white", -0.5, -1.2]],
    NY: [["race", "white", -1, -1.6]],
    MD: [["race", "white", -1, -1]],
    VT: [["race", "white", -1, -1.4]],
    MA: [["race", "white", -1.5, -2]],
    RI: [["race", "white", -1.5, -1.4]],
    DC: [["race", "white", -2.5, -2.0]],
    // Pacific.
    OR: [["race", "white", 0, -1]],
    WA: [["race", "white", 0, -0.8]],
    CA: [["race", "white", -0.5, -1]],
    HI: [["race", "white", -1, -1.6]],
  },
  // 2020 presidential anchor (Biden 51.3 / Trump 46.9).
  //
  // Two structural changes from 1992 dominate this map. APPALACHIA HAS
  // INVERTED: West Virginia moves from -1.0 to +3.5 on economics, the largest
  // single regional swing the series contains, and Kentucky follows it. And the
  // SUN BELT SUBURBS have moved the other way: Georgia, Arizona, Virginia and
  // Colorado are all markedly less Republican relative to the national white
  // baseline than their 1992 selves, which is why Georgia and Arizona are
  // competitive here and were not then.
  //
  // Utah is deliberately NOT at the top of the range despite being the most
  // Republican state of 1992: Trump ran well behind the historical Republican
  // share there in both 2016 and 2020.
  "2019": {
    // Deep South + the inverted Border.
    AL: [["race", "white", 3.5, 2.4]],
    MS: [["race", "white", 3.5, 2.4]],
    WY: [["race", "white", 3.5, 2]],
    OK: [["race", "white", 3.5, 2.6]],
    WV: [["race", "white", 3.5, 2.6]], // was -1.0 in 1992 — the series' biggest swing
    AR: [["race", "white", 3.2, 2.2]],
    ID: [["race", "white", 3.2, 2.2]],
    ND: [["race", "white", 3.2, 1.6]],
    KY: [["race", "white", 3, 2.4]],
    LA: [["race", "white", 3, 2.2]],
    TN: [["race", "white", 3, 2.2]],
    SD: [["race", "white", 3, 1.6]],
    SC: [["race", "white", 2.8, 2]],
    MT: [["race", "white", 2.5, 1]],
    NE: [["race", "white", 2.5, 1.4]],
    IN: [["race", "white", 2.2, 1.4]],
    IA: [["race", "white", 2.2, 0.8]],
    MO: [["race", "white", 2.2, 1.4]],
    KS: [["race", "white", 2.2, 1.2]],
    NC: [["race", "white", 2.2, 0.6]],
    GA: [["race", "white", 2.2, 0.8]], // Atlanta suburbs pull it off the Deep South line
    AK: [["race", "white", 2.2, 1]],
    OH: [["race", "white", 2, 1]],
    TX: [["race", "white", 2, 1.2]],
    FL: [["race", "white", 2, 0.8]],
    UT: [["race", "white", 2, 1.6]], // Trump underperformed the historical R share
    // The Rust Belt tips — but only just.
    AZ: [["race", "white", 1.2, 0.4]],
    NV: [["race", "white", 1, -0.4]],
    MI: [["race", "white", 1, -0.2]],
    WI: [["race", "white", 1, -0.2]],
    PA: [["race", "white", 1, -0.2]],
    VA: [["race", "white", 1, -0.4]], // northern-Virginia suburbs
    MN: [["race", "white", 0.8, -0.6]],
    NH: [["race", "white", 0, -0.4]],
    ME: [["race", "white", 0, -0.8]],
    IL: [["race", "white", 0.3, -0.8]],
    CO: [["race", "white", 0.3, -0.6]], // fully realigned away from its 1992 position
    NM: [["race", "white", 0.3, -0.6]],
    // Coasts + Northeast.
    OR: [["race", "white", -0.3, -1.4]],
    WA: [["race", "white", -0.3, -1.4]],
    CA: [["race", "white", -0.5, -1.6]],
    NY: [["race", "white", -0.5, -1.4]],
    NJ: [["race", "white", -0.5, -1]],
    RI: [["race", "white", -0.5, -1.2]],
    DE: [["race", "white", -0.5, -1]],
    CT: [["race", "white", -0.8, -1.2]],
    MD: [["race", "white", -1, -1.4]],
    HI: [["race", "white", -1, -1.8]],
    MA: [["race", "white", -1.2, -1.8]],
    VT: [["race", "white", -1.5, -1.8]],
    DC: [["race", "white", -3.0, -2.5]],
  },
};

export function getEraPositions(
  era: EraId,
  stateId?: string
): Record<keyof DemographicTurnoutRates, Record<string, DemographicPosition>> {
  const base = DEMOGRAPHIC_POSITIONS[era] ?? DEMOGRAPHIC_POSITIONS["2019"];
  if (!stateId) return base;

  const overrides = STATE_POSITION_OVERRIDES[era]?.[stateId];
  if (!overrides || overrides.length === 0) return base;

  const merged = JSON.parse(JSON.stringify(base));
  for (const [dim, key, econ, social] of overrides) {
    merged[dim][key] = { economicLean: econ, socialLean: social };
  }
  return merged;
}

/**
 * Era anchors that author ANY per-state position override, ascending.
 *
 * `STATE_POSITION_OVERRIDES` is deliberately sparse: 1953, 1979, 1991, and
 * 2019 carry a full regional map of the United States; 1999, 2007, and 2023
 * do not. Callers blending positions across years need to know which anchors
 * are REAL so they can interpolate between authored maps and carry the last
 * one forward rather than read a missing anchor as "this state has no
 * regional character" - see `getEraPositionsForYear` in
 * `eraPositionsForYear.ts` for why that distinction is load-bearing.
 */
export const STATE_OVERRIDE_ANCHOR_ERAS: readonly EraId[] = (
  Object.keys(STATE_POSITION_OVERRIDES) as EraId[]
).sort((a, b) => Number(a) - Number(b));

/** True when `era` authors an explicit position override for `stateId`. */
export function hasStateOverrides(era: EraId, stateId: string): boolean {
  return (STATE_POSITION_OVERRIDES[era]?.[stateId]?.length ?? 0) > 0;
}

export function getEraComposition(era: EraId): EraComposition {
  const comp = ERA_COMPOSITIONS[era];
  if (!comp) {
    throw new Error(`No composition defined for era "${era}"`);
  }
  return comp;
}

export default demographicCategories;
