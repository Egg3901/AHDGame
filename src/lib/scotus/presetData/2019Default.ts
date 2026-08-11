import type { ScotusPresetSeed } from "./types";

/**
 * SCOTUS Original Roster + Docket for the "2019-default" preset (#3602, spec
 * #3581). This is the default/most-played era preset — the real Roberts
 * Court as seated in 2019, with its full real succession chain through
 * "present" (2026): Ruth Bader Ginsburg's September 2020 death and Amy Coney
 * Barrett's October 2020 confirmation, and Stephen Breyer's 2022 retirement
 * and Ketanji Brown Jackson's confirmation. Docket covers real landmark
 * cases decided 2019-2026.
 *
 * ── Sign convention (documented once, held consistent across every seat and
 * every case below — required by `decideCaseOutcome`, ahd-scotus-adr-
 * majority-headcount-divergence) ──────────────────────────────────────────
 * On both `economicLean` and `socialLean`, NEGATIVE = liberal-leaning,
 * POSITIVE = conservative-leaning — the same sign convention the game
 * already uses for `PoliticalParty.economicPosition`/`socialPosition`
 * (US Democratic Party seeded at -2/-2, Republican at +2/+2; see
 * src/lib/seeds/reference/politicalParties.ts).
 *
 * `axis` scoping for THIS docket specifically:
 *  - "social": the broad constitutional-rights/cultural axis — reproductive
 *    rights, gun rights, affirmative action, elections/executive power,
 *    environmental regulation.
 *  - "economic": narrowly scoped, for THIS docket, to labor/employment/
 *    immigration-administrative-process and redistricting-authority
 *    matters (the 3 cases below that use it) — not a claim about general
 *    fiscal/tax ideology, since no tax-policy case appears on this docket.
 *
 * `historicalMajorityDirection` per case is set to whatever
 * `decideCaseOutcome` actually computes from the leans below for the real
 * roster seated in that case's decision year — this is what makes an
 * unmodified 2019-default game correctly "affirm" (no divergence) for every
 * case here, which is the load-bearing invariant (spec #3581 user story 18).
 *
 * Known modeling limitation (see ahd-scotus-adr-majority-headcount-
 * divergence — headcount by design, not an averaged score): a handful of
 * real 2020-2023 rulings were decided by an issue-specific crossover vote
 * that a single fixed per-justice-per-axis lean cannot reproduce exactly:
 *  - DHS v. Regents (DACA), Bostock, and June Medical (all 2020) were each
 *    5-4/6-3 with Chief Justice Roberts joining the four liberal justices.
 *    Roberts is authored with a mildly negative lean on both axes to make
 *    the 2020 roster's headcount affirm these three real outcomes.
 *  - Moore v. Harper (2023) was 6-3, with Roberts AND Kavanaugh joining the
 *    three liberal justices (Sotomayor/Kagan/Jackson — only 3 by then,
 *    Ginsburg's seat having passed to Barrett) against the ISL theory.
 *    Kavanaugh is additionally authored with a mildly negative economic
 *    lean so the 2023 roster's headcount reaches a 5-4 negative majority.
 * These two authored exceptions (Roberts, Kavanaugh) are a deliberate
 * authoring workaround for the headcount model's one-fixed-lean-per-justice
 * constraint, not a claim that either justice holds economically liberal
 * views generally — outside these specific cases both are solidly
 * conservative on every other axis/case in this docket.
 *
 * Same-year seat-transition note: `processScotusTenureTurn` always runs
 * before `processScotusDocketTurn` within a turn (src/lib/turn/scotusTurn.ts),
 * and `yearToTurn` has year-only granularity — so a seat transition dated to
 * the same calendar year as a docket case ALWAYS resolves before that
 * case's headcount is evaluated, regardless of real within-year month
 * ordering. Ruth Bader Ginsburg's real death (September 2020) came after
 * DHS v. Regents, Bostock, and June Medical were all decided (June 2020);
 * to keep those three cases replaying against her real vote instead of
 * Amy Coney Barrett's (not confirmed until October 2020), Seat 3's
 * transition is authored one year later than the real dates —
 * `departureYear`/`seatedYear` of 2021 rather than 2020 — a deliberate,
 * documented compromise forced by year-only granularity, not an error.
 * (Breyer -> Jackson's real same-day 2022 transition needed no such
 * adjustment: every 2022 docket case here treats both as a negative lean
 * on every axis they're used on, so which of the two is technically seated
 * doesn't change any outcome.)
 *
 * Party field convention: `party` is the stringified `PoliticalParty
 * .sequentialId` for the US (matching Character.party/NPP.party), which is
 * fixed at seed time: Democratic Party = "1", Republican Party = "2" (see
 * DEMOCRAT_SEQ_ID/REPUBLICAN_SEQ_ID in src/lib/seeds/reference/
 * statePartyOrg.ts — same literal-constant convention reused here since no
 * shared exported constant exists yet).
 */

// US major party sequentialIds (assigned during seed: democrat=1, republican=2)
// — same convention as src/lib/seeds/reference/statePartyOrg.ts.
const DEMOCRAT_SEQ_ID = "1";
const REPUBLICAN_SEQ_ID = "2";

export const SCOTUS_2019_DEFAULT_SEED: ScotusPresetSeed = {
  seats: [
    // Seat 1 — Chief Justice
    {
      seatNumber: 1,
      historicalOccupants: [
        {
          key: "roberts-2019",
          name: "John Roberts",
          party: REPUBLICAN_SEQ_ID,
          // Mildly negative on both axes: the Court's institutionalist swing
          // vote in 2020 (DACA, Bostock, June Medical) — see file header.
          economicLean: -1,
          socialLean: -1,
          seatedYear: 2019,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 2 — Clarence Thomas
    {
      seatNumber: 2,
      historicalOccupants: [
        {
          key: "thomas-2019",
          name: "Clarence Thomas",
          party: REPUBLICAN_SEQ_ID,
          economicLean: 4,
          socialLean: 5,
          seatedYear: 2019,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 3 — Ruth Bader Ginsburg (d. Sept 2020, authored 2021 — see file
    // header) -> Amy Coney Barrett (confirmed Oct 2020, authored 2021)
    {
      seatNumber: 3,
      historicalOccupants: [
        {
          key: "ginsburg-2019",
          name: "Ruth Bader Ginsburg",
          party: DEMOCRAT_SEQ_ID,
          economicLean: -4,
          socialLean: -5,
          seatedYear: 2019,
          // Real death: September 2020. Authored as 2021 — see the
          // "Same-year seat-transition note" in the file header comment.
          departureYear: 2021,
          departureReason: "death",
        },
        {
          key: "barrett-2021",
          name: "Amy Coney Barrett",
          party: REPUBLICAN_SEQ_ID,
          economicLean: 3,
          socialLean: 4,
          // Real confirmation: October 2020. Authored as 2021 — see the
          // "Same-year seat-transition note" in the file header comment.
          seatedYear: 2021,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 4 — Stephen Breyer (retired 2022) -> Ketanji Brown Jackson (confirmed 2022)
    {
      seatNumber: 4,
      historicalOccupants: [
        {
          key: "breyer-2019",
          name: "Stephen Breyer",
          party: DEMOCRAT_SEQ_ID,
          economicLean: -3,
          socialLean: -3,
          seatedYear: 2019,
          departureYear: 2022,
          departureReason: "retirement",
        },
        {
          key: "jackson-2022",
          name: "Ketanji Brown Jackson",
          party: DEMOCRAT_SEQ_ID,
          economicLean: -3,
          socialLean: -4,
          seatedYear: 2022,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 5 — Samuel Alito
    {
      seatNumber: 5,
      historicalOccupants: [
        {
          key: "alito-2019",
          name: "Samuel Alito",
          party: REPUBLICAN_SEQ_ID,
          economicLean: 4,
          socialLean: 5,
          seatedYear: 2019,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 6 — Sonia Sotomayor
    {
      seatNumber: 6,
      historicalOccupants: [
        {
          key: "sotomayor-2019",
          name: "Sonia Sotomayor",
          party: DEMOCRAT_SEQ_ID,
          economicLean: -3,
          socialLean: -5,
          seatedYear: 2019,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 7 — Elena Kagan
    {
      seatNumber: 7,
      historicalOccupants: [
        {
          key: "kagan-2019",
          name: "Elena Kagan",
          party: DEMOCRAT_SEQ_ID,
          economicLean: -3,
          socialLean: -4,
          seatedYear: 2019,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 8 — Neil Gorsuch
    {
      seatNumber: 8,
      historicalOccupants: [
        {
          key: "gorsuch-2019",
          name: "Neil Gorsuch",
          party: REPUBLICAN_SEQ_ID,
          economicLean: 3,
          // Lower than the other conservative appointees: textualist/
          // libertarian streak (authored Bostock's majority opinion; also a
          // reliable vote for tribal sovereignty and criminal defendants).
          socialLean: 2,
          seatedYear: 2019,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
    // Seat 9 — Brett Kavanaugh
    {
      seatNumber: 9,
      historicalOccupants: [
        {
          key: "kavanaugh-2019",
          name: "Brett Kavanaugh",
          party: REPUBLICAN_SEQ_ID,
          // Mildly negative on economic only: the second GOP-appointee
          // crossover (with Roberts) in Moore v. Harper — see file header.
          economicLean: -1,
          socialLean: 3,
          seatedYear: 2019,
          departureYear: null,
          departureReason: null,
        },
      ],
    },
  ],

  docket: [
    // ── 2020 ────────────────────────────────────────────────────────────
    {
      caseKey: "daca-regents-2020",
      title: "Department of Homeland Security v. Regents of the University of California",
      axis: "economic",
      historicalMajorityDirection: -1,
      decisionYear: 2020,
      // Real outcome (5-4) blocked the DACA rescission on APA grounds. A
      // diverged ruling represents the Court instead permitting rescission —
      // the restrictive/enforcement-heavy end of border enforcement policy.
      effect: {
        legislationTypeId: "us_border_security_enforcement",
        policyOptionId: "border_security_enforcement_opt_5",
        effectDirection: -1,
      },
    },
    {
      caseKey: "bostock-v-clayton-county-2020",
      title: "Bostock v. Clayton County",
      axis: "economic",
      historicalMajorityDirection: -1,
      decisionYear: 2020,
      // No effect authored: no existing legislationTypeId covers federal
      // Title VII / LGBTQ+ employment-discrimination protections. The
      // closest candidate, "us_state_labor", is state-scoped and a poor fit
      // for a federal ruling, so per the DocketCaseEffect doc comment
      // (src/lib/db/types/scotus.ts) this case is authored without an
      // effect rather than forcing a mismatched mapping.
    },
    {
      caseKey: "june-medical-v-russo-2020",
      title: "June Medical Services LLC v. Russo",
      axis: "social",
      historicalMajorityDirection: -1,
      decisionYear: 2020,
      // Real outcome (5-4) struck down Louisiana's admitting-privileges law.
      // A diverged ruling represents the Court instead upholding it — a
      // restrictive move on reproductive rights.
      effect: {
        legislationTypeId: "us_reproductive_rights",
        policyOptionId: "reproductive_rights_opt_4",
        effectDirection: -1,
      },
    },

    // ── 2022 ────────────────────────────────────────────────────────────
    {
      caseKey: "dobbs-v-jackson-2022",
      title: "Dobbs v. Jackson Women's Health Organization",
      axis: "social",
      historicalMajorityDirection: 1,
      decisionYear: 2022,
      // Real outcome (6-3 on judgment) overruled Roe v. Wade. A diverged
      // ruling represents the Court instead reaffirming a federal
      // reproductive-rights floor.
      effect: {
        legislationTypeId: "us_reproductive_rights",
        policyOptionId: "reproductive_rights_opt_2",
        effectDirection: 1,
      },
    },
    {
      caseKey: "nysrpa-v-bruen-2022",
      title: "New York State Rifle & Pistol Association v. Bruen",
      axis: "social",
      historicalMajorityDirection: 1,
      decisionYear: 2022,
      // Real outcome (6-3) struck down NY's proper-cause carry requirement.
      // A diverged ruling represents the Court instead upholding
      // restrictive carry licensing.
      effect: {
        legislationTypeId: "us_gun_control",
        policyOptionId: "gun_control_opt_2",
        effectDirection: 1,
      },
    },
    {
      caseKey: "west-virginia-v-epa-2022",
      title: "West Virginia v. Environmental Protection Agency",
      axis: "social",
      historicalMajorityDirection: 1,
      decisionYear: 2022,
      // Real outcome (6-3) curbed the EPA's authority to regulate power-
      // plant emissions absent clear congressional authorization. A
      // diverged ruling represents the Court instead upholding expansive
      // EPA authority.
      effect: {
        legislationTypeId: "us_clean_energy",
        policyOptionId: "clean_energy_opt_1",
        effectDirection: 1,
      },
    },

    // ── 2023 ────────────────────────────────────────────────────────────
    {
      caseKey: "sffa-v-harvard-2023",
      title: "Students for Fair Admissions v. Harvard/UNC",
      axis: "social",
      historicalMajorityDirection: 1,
      decisionYear: 2023,
      // No effect authored: no existing legislationTypeId covers race-
      // conscious college admissions specifically. The closest candidates
      // (us_state_higher_education / us_school_standards) are weak, state-
      // scoped fits, so this case is authored without an effect.
    },
    {
      caseKey: "moore-v-harper-2023",
      title: "Moore v. Harper",
      axis: "economic",
      historicalMajorityDirection: -1,
      decisionYear: 2023,
      // Real outcome (6-3) rejected the independent state legislature
      // theory. A diverged ruling represents the Court instead adopting
      // ISL theory — state legislatures drawing federal-election maps free
      // of state-court/state-constitution review. "us_state_
      // redistricting_authority" is nominally state-scoped, but is applied
      // federally here (stateId omitted, defaults to "federal" per the
      // DocketCaseEffect doc comment) since SCOTUS rulings on the federal
      // Elections Clause are national in effect by design — this is the
      // closest and most thematically direct match in the catalog (it is
      // literally "who draws the state's congressional district map").
      effect: {
        legislationTypeId: "us_state_redistricting_authority",
        policyOptionId: "state_redistricting_authority_opt_2",
        effectDirection: -1,
      },
    },

    // ── 2024 ────────────────────────────────────────────────────────────
    {
      caseKey: "trump-v-anderson-2024",
      title: "Trump v. Anderson",
      axis: "social",
      historicalMajorityDirection: 1,
      decisionYear: 2024,
      // No effect authored: no existing legislationTypeId covers federal-
      // candidate ballot-eligibility/disqualification. The real ruling was
      // also unanimous on the core holding (states can't unilaterally
      // disqualify a federal candidate), so divergence is expected to be a
      // rare edge case even without an authored effect.
    },
    {
      caseKey: "trump-v-united-states-2024",
      title: "Trump v. United States",
      axis: "social",
      historicalMajorityDirection: 1,
      decisionYear: 2024,
      // No effect authored: no existing legislationTypeId covers
      // presidential/executive-power immunity — no plausible mapping
      // exists in the current catalog.
    },
    {
      caseKey: "loper-bright-v-raimondo-2024",
      title: "Loper Bright Enterprises v. Raimondo",
      axis: "social",
      historicalMajorityDirection: 1,
      decisionYear: 2024,
      // No effect authored: no existing legislationTypeId covers
      // administrative-agency/Chevron-deference doctrine — no plausible
      // mapping exists in the current catalog.
    },
  ],
};
