import type { ScotusPresetSeed, ScotusPresetSeatSeed, ScotusPresetDocketCaseSeed } from "./types";

/**
 * 1991 preset SCOTUS content (#3601, spec #3581). Seeds the Rehnquist Court
 * at the 1991 preset's start year, plus the real landmark Docket from 1991
 * through present (2026).
 *
 * ============================================================================
 * SIGN CONVENTION (read before editing)
 * ============================================================================
 * `economicLean`/`socialLean` on every occupant, and `historicalMajorityDirection`
 * on every Docket case, share ONE consistent sign:
 *
 *   POSITIVE (> 0) = conservative / right-leaning
 *   NEGATIVE (< 0) = liberal / progressive-leaning
 *   ZERO           = genuinely centrist (counts toward neither side of a headcount)
 *
 * This matches the existing `PoliticalParty.economicPosition`/`socialPosition`
 * convention already in the codebase (see `src/lib/seeds/reference/politicalParties.ts`:
 * US Republican Party = economicPosition +2/socialPosition +2 "Center-right";
 * US Democratic Party = economicPosition -2/socialPosition -2 "Center-left").
 * `decideCaseOutcome` (src/lib/scotus/divergence.ts) headcounts positive vs
 * negative on the case's tagged axis — it never reads sign meaning itself, so
 * this file is the single source of truth for what the sign means.
 *
 * NOTE: `DocketCaseEffect.effectDirection` (and the underlying
 * `LegislationPolicyOption.effectDirection` it's copied from) is a SEPARATE,
 * pre-existing, OPPOSITE-signed convention baked into every legislationType
 * option set (see `src/lib/seeds/reference/policyOptionHelpers.ts`):
 *   left/expansionary option  → effectDirection +1
 *   right/restrictive option  → effectDirection -1
 * Every `effect` below copies its `effectDirection` straight from the chosen
 * `policyOptionId`'s own authored value in `src/lib/seeds/reference/legislationTypes.ts`
 * — do not derive it from this file's economicLean/socialLean convention.
 *
 * PARTY FIELD
 * ============================================================================
 * `party` follows the documented `HistoricalJusticeOccupant.party` convention
 * ("opaque identifier, same convention as Character.party/NPP.party" — a
 * stringified `PoliticalParty.sequentialId`). Real justices don't hold formal
 * party membership, so — matching how the rest of the codebase labels
 * real-world, non-elected historical figures with no game-native party record
 * (see `src/lib/npp/seedHistorical.ts` SLUG_TO_NAME → resolvePartyId) — this
 * uses the party of the president who nominated them, the standard convention
 * for describing a justice's political origin. US party sequentialIds are
 * assigned in `politicalParties.ts` seedOrder: Democratic Party = "1",
 * Republican Party = "2".
 *
 * ROSTER START POINT
 * ============================================================================
 * The 1991 preset's turn 1 is January 1, 1991 (`getStartingYearForPreset`).
 * On that date Thurgood Marshall was still sitting; he announced retirement
 * June 27, 1991 and Clarence Thomas was confirmed October 15, 1991 — both
 * events land inside the preset's first calendar year. Seat 3 therefore
 * carries Marshall as `historicalOccupants[0]` (seatedYear 1991, matching
 * "first entry per seat = the preset's start year" per the schema doc
 * comment) with a same-year departure, immediately followed by Thomas —
 * rather than starting the roster directly on Thomas and silently dropping
 * Marshall from history.
 *
 * SUCCESSION CHAINS
 * ============================================================================
 * Each seat's chain is carried all the way to whoever is really sitting as of
 * 2026 (today): every seat below currently ends on a still-serving justice
 * (departureYear: null) except none — all nine 1991 seats have had at least
 * one real-world succession since 1991, and the resulting nine sitting
 * justices (Roberts, Barrett, Thomas, Jackson, Kagan, Alito, Gorsuch,
 * Kavanaugh, Sotomayor) match the real Court as of this writing.
 */

const US_DEM = "1";
const US_REP = "2";

const seats: ScotusPresetSeatSeed[] = [
  // Seat 1 — Chief Justice line: Rehnquist → Roberts
  {
    seatNumber: 1,
    historicalOccupants: [
      {
        key: "rehnquist-1991",
        name: "William Rehnquist",
        party: US_REP, // elevated to Chief by Reagan, 1986
        economicLean: 4,
        socialLean: 4,
        seatedYear: 1991,
        departureYear: 2005,
        departureReason: "death",
      },
      {
        key: "roberts-2005",
        name: "John Roberts",
        party: US_REP, // nominated by George W. Bush
        economicLean: 3,
        socialLean: 3,
        seatedYear: 2005,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 2 — White → Ginsburg → Barrett
  {
    seatNumber: 2,
    historicalOccupants: [
      {
        key: "white-1991",
        name: "Byron White",
        party: US_DEM, // nominated by JFK, but frequently voted with the Court's conservative bloc (dissented in Roe and Casey)
        economicLean: 1,
        socialLean: 2,
        seatedYear: 1991,
        departureYear: 1993,
        departureReason: "retirement",
      },
      {
        key: "ginsburg-1993",
        name: "Ruth Bader Ginsburg",
        party: US_DEM, // nominated by Clinton
        economicLean: -4,
        socialLean: -4,
        seatedYear: 1993,
        departureYear: 2020,
        departureReason: "death",
      },
      {
        key: "barrett-2020",
        name: "Amy Coney Barrett",
        party: US_REP, // nominated by Trump
        economicLean: 4,
        socialLean: 4,
        seatedYear: 2020,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 3 — Marshall → Thomas
  {
    seatNumber: 3,
    historicalOccupants: [
      {
        key: "marshall-1991",
        name: "Thurgood Marshall",
        party: US_DEM, // nominated by LBJ
        economicLean: -4,
        socialLean: -5,
        seatedYear: 1991,
        departureYear: 1991,
        departureReason: "retirement",
      },
      {
        key: "thomas-1991",
        name: "Clarence Thomas",
        party: US_REP, // nominated by George H.W. Bush
        economicLean: 5,
        socialLean: 5,
        seatedYear: 1991,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 4 — Blackmun → Breyer → Jackson
  {
    seatNumber: 4,
    historicalOccupants: [
      {
        key: "blackmun-1991",
        name: "Harry Blackmun",
        party: US_REP, // nominated by Nixon, but authored Roe and became one of the Court's most liberal members
        economicLean: -2,
        socialLean: -4,
        seatedYear: 1991,
        departureYear: 1994,
        departureReason: "retirement",
      },
      {
        key: "breyer-1994",
        name: "Stephen Breyer",
        party: US_DEM, // nominated by Clinton
        economicLean: -3,
        socialLean: -3,
        seatedYear: 1994,
        departureYear: 2022,
        departureReason: "retirement",
      },
      {
        key: "jackson-2022",
        name: "Ketanji Brown Jackson",
        party: US_DEM, // nominated by Biden
        economicLean: -3,
        socialLean: -3,
        seatedYear: 2022,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 5 — Stevens → Kagan
  {
    seatNumber: 5,
    historicalOccupants: [
      {
        key: "stevens-1991",
        name: "John Paul Stevens",
        party: US_REP, // nominated by Ford, but became a leading liberal voice by the end of his tenure
        economicLean: -2,
        socialLean: -3,
        seatedYear: 1991,
        departureYear: 2010,
        departureReason: "retirement",
      },
      {
        key: "kagan-2010",
        name: "Elena Kagan",
        party: US_DEM, // nominated by Obama
        economicLean: -3,
        socialLean: -3,
        seatedYear: 2010,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 6 — O'Connor → Alito
  {
    seatNumber: 6,
    historicalOccupants: [
      {
        key: "oconnor-1991",
        name: "Sandra Day O'Connor",
        party: US_REP, // nominated by Reagan; the Court's pivotal swing vote for most of her tenure
        economicLean: 1,
        socialLean: -1,
        seatedYear: 1991,
        departureYear: 2006,
        departureReason: "retirement",
      },
      {
        key: "alito-2006",
        name: "Samuel Alito",
        party: US_REP, // nominated by George W. Bush
        economicLean: 4,
        socialLean: 4,
        seatedYear: 2006,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 7 — Scalia → Gorsuch (seat sat vacant Feb 2016-Apr 2017 in real
  // history; the tenure-turn processor auto-advances with no vacancy gap
  // between chain entries, so that real-world gap isn't separately modeled)
  {
    seatNumber: 7,
    historicalOccupants: [
      {
        key: "scalia-1991",
        name: "Antonin Scalia",
        party: US_REP, // nominated by Reagan
        economicLean: 4,
        socialLean: 5,
        seatedYear: 1991,
        departureYear: 2016,
        departureReason: "death",
      },
      {
        key: "gorsuch-2017",
        name: "Neil Gorsuch",
        party: US_REP, // nominated by Trump
        economicLean: 3,
        socialLean: 3,
        seatedYear: 2017,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 8 — Kennedy → Kavanaugh
  {
    seatNumber: 8,
    historicalOccupants: [
      {
        key: "kennedy-1991",
        name: "Anthony Kennedy",
        party: US_REP, // nominated by Reagan; the Roberts Court's swing vote — authored Romer, Lawrence, and Obergefell
        economicLean: 2,
        socialLean: -1,
        seatedYear: 1991,
        departureYear: 2018,
        departureReason: "retirement",
      },
      {
        key: "kavanaugh-2018",
        name: "Brett Kavanaugh",
        party: US_REP, // nominated by Trump
        economicLean: 3,
        socialLean: 3,
        seatedYear: 2018,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
  // Seat 9 — Souter → Sotomayor
  {
    seatNumber: 9,
    historicalOccupants: [
      {
        key: "souter-1991",
        name: "David Souter",
        party: US_REP, // nominated by George H.W. Bush, but became a reliably liberal vote
        economicLean: -2,
        socialLean: -3,
        seatedYear: 1991,
        departureYear: 2009,
        departureReason: "retirement",
      },
      {
        key: "sotomayor-2009",
        name: "Sonia Sotomayor",
        party: US_DEM, // nominated by Obama
        economicLean: -4,
        socialLean: -4,
        seatedYear: 2009,
        departureYear: null,
        departureReason: null,
      },
    ],
  },
];

/**
 * Real landmark cases, 1991-2026. `effect` is authored only where an
 * existing `legislationTypeId`/`policyOptionId` (src/lib/seeds/reference/legislationTypes.ts)
 * plausibly captures the divergent-ruling outcome; cases with no clean
 * mapping (documented inline) are left without an `effect` per the schema's
 * documented behavior for cases not expected to diverge into a concrete
 * policy change.
 */
const docket: ScotusPresetDocketCaseSeed[] = [
  {
    caseKey: "planned-parenthood-v-casey-1992",
    title: "Planned Parenthood v. Casey",
    axis: "social",
    historicalMajorityDirection: -1, // O'Connor/Kennedy/Souter plurality + Blackmun/Stevens reaffirmed the core of Roe
    decisionYear: 1992,
    effect: {
      // Divergent (conservative majority) path: an early, sharper rollback of
      // abortion access than history actually produced at this point.
      legislationTypeId: "us_reproductive_rights",
      policyOptionId: "reproductive_rights_opt_5",
      effectDirection: -1,
    },
  },
  {
    caseKey: "united-states-v-lopez-1995",
    title: "United States v. Lopez",
    axis: "economic", // Commerce Clause federalism — scope of federal regulatory power
    historicalMajorityDirection: 1, // Rehnquist/O'Connor/Scalia/Kennedy/Thomas struck down the Gun-Free School Zones Act as beyond the Commerce Clause
    decisionYear: 1995,
    effect: {
      // Divergent (liberal majority upholds broad federal Commerce Clause
      // reach) closest real-world artifact: the federal gun regulation Lopez
      // itself struck down.
      legislationTypeId: "us_gun_control",
      policyOptionId: "gun_control_opt_2",
      effectDirection: 1,
    },
  },
  {
    caseKey: "romer-v-evans-1996",
    title: "Romer v. Evans",
    axis: "social",
    historicalMajorityDirection: -1, // Kennedy authored; Stevens/O'Connor/Souter/Ginsburg/Breyer joined, striking down Colorado's Amendment 2
    decisionYear: 1996,
    // No effect: no LGBT-anti-discrimination legislationType exists in this
    // codebase to plug a divergent (upheld Amendment 2) ruling into.
  },
  {
    caseKey: "lawrence-v-texas-2003",
    title: "Lawrence v. Texas",
    axis: "social",
    historicalMajorityDirection: -1, // Kennedy authored the majority striking down state sodomy laws
    decisionYear: 2003,
    // No effect: no LGBT-rights/criminal-sodomy-law legislationType exists.
  },
  {
    caseKey: "grutter-v-bollinger-2003",
    title: "Grutter v. Bollinger",
    axis: "social",
    historicalMajorityDirection: -1, // O'Connor authored the majority upholding race-conscious university admissions
    decisionYear: 2003,
    // No effect: no affirmative-action/college-admissions legislationType exists.
  },
  {
    caseKey: "district-of-columbia-v-heller-2008",
    title: "District of Columbia v. Heller",
    axis: "social",
    historicalMajorityDirection: 1, // Scalia authored; Roberts/Kennedy/Thomas/Alito joined, affirming an individual Second Amendment right
    decisionYear: 2008,
    effect: {
      // Divergent (liberal majority) path: DC's handgun ban stands.
      legislationTypeId: "us_gun_control",
      policyOptionId: "gun_control_opt_0",
      effectDirection: 1,
    },
  },
  {
    caseKey: "citizens-united-v-fec-2010",
    title: "Citizens United v. FEC",
    axis: "economic",
    historicalMajorityDirection: 1, // Kennedy authored; Roberts/Scalia/Alito/Thomas joined, striking down corporate campaign-spending restrictions
    decisionYear: 2010,
    effect: {
      // Divergent (liberal majority) path: campaign-finance/lobbying
      // restrictions survive — closest existing analog is the ethics/
      // transparency legislationType.
      legislationTypeId: "us_government_ethics",
      policyOptionId: "government_ethics_opt_0",
      effectDirection: 1,
    },
  },
  {
    caseKey: "nfib-v-sebelius-2012",
    title: "National Federation of Independent Business v. Sebelius",
    axis: "economic",
    historicalMajorityDirection: -1, // Roberts joined Ginsburg/Breyer/Sotomayor/Kagan to uphold the ACA's individual mandate as a tax
    decisionYear: 2012,
    effect: {
      // Divergent (conservative majority) path: the ACA (and its Medicaid
      // expansion) is struck down rather than upheld.
      legislationTypeId: "us_medicaid_expansion",
      policyOptionId: "medicaid_expansion_opt_6",
      effectDirection: -1,
    },
  },
  {
    caseKey: "shelby-county-v-holder-2013",
    title: "Shelby County v. Holder",
    axis: "social",
    historicalMajorityDirection: 1, // Roberts authored; Scalia/Kennedy/Thomas/Alito joined, striking down the VRA's Section 4(b) coverage formula
    decisionYear: 2013,
    effect: {
      // Divergent (liberal majority) path: full Voting Rights Act
      // preclearance enforcement survives.
      legislationTypeId: "us_civics_voting_rights",
      policyOptionId: "civics_voting_rights_opt_1",
      effectDirection: 1,
    },
  },
  {
    caseKey: "burwell-v-hobby-lobby-2014",
    title: "Burwell v. Hobby Lobby Stores",
    axis: "social",
    historicalMajorityDirection: 1, // Alito authored; Roberts/Scalia/Kennedy/Thomas joined, upholding a closely-held corporation's religious exemption from the contraceptive mandate
    decisionYear: 2014,
    effect: {
      // Divergent (liberal majority) path: no religious exemption, full
      // contraceptive-coverage mandate stands.
      legislationTypeId: "us_reproductive_rights",
      policyOptionId: "reproductive_rights_opt_2",
      effectDirection: 1,
    },
  },
  {
    caseKey: "obergefell-v-hodges-2015",
    title: "Obergefell v. Hodges",
    axis: "social",
    historicalMajorityDirection: -1, // Kennedy authored; Ginsburg/Breyer/Sotomayor/Kagan joined, establishing a nationwide right to same-sex marriage
    decisionYear: 2015,
    // No effect: no marriage-equality legislationType exists.
  },
  {
    caseKey: "janus-v-afscme-2018",
    title: "Janus v. AFSCME",
    axis: "economic",
    historicalMajorityDirection: 1, // Alito authored; Roberts/Kennedy/Thomas/Gorsuch joined, ruling mandatory public-sector union agency fees unconstitutional
    decisionYear: 2018,
    effect: {
      // Divergent (liberal majority) path: mandatory agency fees (and
      // union bargaining power) stand.
      legislationTypeId: "us_state_labor",
      policyOptionId: "state_labor_opt_0",
      effectDirection: 1,
    },
  },
  {
    caseKey: "trump-v-hawaii-2018",
    title: "Trump v. Hawaii",
    axis: "social",
    historicalMajorityDirection: 1, // Roberts authored; Kennedy/Thomas/Alito/Gorsuch joined, upholding the travel-ban proclamation
    decisionYear: 2018,
    effect: {
      // Divergent (liberal majority) path: the travel ban is struck down.
      legislationTypeId: "us_border_security_enforcement",
      policyOptionId: "border_security_enforcement_opt_2",
      effectDirection: 1,
    },
  },
  {
    caseKey: "bostock-v-clayton-county-2020",
    title: "Bostock v. Clayton County",
    axis: "social",
    historicalMajorityDirection: -1, // Gorsuch authored; Roberts/Ginsburg/Breyer/Sotomayor/Kagan joined, extending Title VII protection to LGBT employees
    decisionYear: 2020,
    // No effect: no LGBT-employment-discrimination legislationType exists.
  },
  {
    caseKey: "dobbs-v-jackson-2022",
    title: "Dobbs v. Jackson Women's Health Organization",
    axis: "social",
    historicalMajorityDirection: 1, // Alito authored; Thomas/Gorsuch/Kavanaugh/Barrett joined, overturning Roe v. Wade and Planned Parenthood v. Casey
    decisionYear: 2022,
    effect: {
      // Divergent (liberal majority) path: Roe/Casey's federal abortion
      // right is preserved rather than overturned.
      legislationTypeId: "us_reproductive_rights",
      policyOptionId: "reproductive_rights_opt_1",
      effectDirection: 1,
    },
  },
  {
    caseKey: "west-virginia-v-epa-2022",
    title: "West Virginia v. EPA",
    axis: "economic",
    historicalMajorityDirection: 1, // Roberts authored; Thomas/Alito/Gorsuch/Kavanaugh/Barrett joined, limiting EPA's authority to regulate power-plant emissions under the "major questions" doctrine
    decisionYear: 2022,
    effect: {
      // Divergent (liberal majority) path: broad EPA regulatory authority
      // over emissions is upheld.
      legislationTypeId: "us_clean_energy",
      policyOptionId: "clean_energy_opt_2",
      effectDirection: 1,
    },
  },
  {
    caseKey: "students-for-fair-admissions-v-harvard-2023",
    title: "Students for Fair Admissions v. Harvard",
    axis: "social",
    historicalMajorityDirection: 1, // Roberts authored; Thomas/Alito/Gorsuch/Kavanaugh/Barrett joined, striking down race-conscious college admissions
    decisionYear: 2023,
    // No effect: no affirmative-action/college-admissions legislationType exists.
  },
  {
    caseKey: "303-creative-v-elenis-2023",
    title: "303 Creative v. Elenis",
    axis: "social",
    historicalMajorityDirection: 1, // Gorsuch authored; Roberts/Thomas/Alito/Kavanaugh/Barrett joined, siding with a website designer's free-speech objection over a state anti-discrimination law
    decisionYear: 2023,
    // No effect: no free-speech-vs-anti-discrimination legislationType exists.
  },
  {
    caseKey: "loper-bright-v-raimondo-2024",
    title: "Loper Bright Enterprises v. Raimondo",
    axis: "economic",
    historicalMajorityDirection: 1, // Roberts authored; Thomas/Alito/Gorsuch/Kavanaugh/Barrett joined, overturning Chevron deference and narrowing federal agencies' regulatory latitude
    decisionYear: 2024,
    // No effect: the ruling narrows deference across every federal agency at
    // once — no single existing legislationType captures a cross-cutting
    // administrative-law doctrine shift.
  },
];

export const SCOTUS_1991_PRESET_DATA: ScotusPresetSeed = { seats, docket };
