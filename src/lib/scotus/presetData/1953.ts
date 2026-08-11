import type { ScotusPresetSeed } from "./types";

/**
 * 1953 preset SCOTUS content (#3599, spec #3581, core mechanics #3598).
 *
 * Original Roster: the real 9 justices sitting on the US Supreme Court in
 * January 1953 (the Vinson Court, unchanged in membership since Sherman
 * Minton's 1949 confirmation), with each seat's full real succession chain
 * carried forward to whoever is actually seated as of "present" (2026).
 * `historicalOccupants[0].seatedYear` is always 1953 (the preset's start
 * year, per the schema doc comment), even where the real confirmation date
 * was earlier (e.g. Hugo Black, seated 1937) — the game only starts tracking
 * tenure from 1953. A mid-chain occupant's `seatedYear` uses the real
 * confirmation/recess-appointment year. Every occupant who has actually left
 * the real bench by 2026 gets a `departureYear`/`departureReason`; only the
 * final occupant in a chain who is genuinely still sitting today is left
 * `departureYear: null` (matches the schema's literal "still serving as of
 * the docket cutoff" semantics).
 *
 * Seat numbering: seat 1 is the Chief Justice line (Vinson → Warren → Burger
 * → Rehnquist → Roberts); seats 2-9 are the eight Associate Justice seats in
 * no particular order. The core schema has no Chief/Associate distinction —
 * this numbering is purely a content-authoring convenience.
 *
 * ── Sign convention (documented once, held consistent across every seat and
 * every Docket case in this file) ──────────────────────────────────────────
 * `economicLean`/`socialLean` and `historicalMajorityDirection` all share one
 * sign: POSITIVE = conservative/right-leaning, NEGATIVE = liberal/left-leaning.
 * This matches the existing codebase-wide convention already used for
 * `PoliticalParty.economicPosition`/`socialPosition` (Republican = +2,
 * Democrat = -2 — see src/lib/seeds/reference/politicalParties.ts) and for
 * the political-legislation catalog's per-family `lean` (see
 * src/lib/politicalMetrics/families.ts), so a justice's lean and a case's
 * historical majority direction read on the exact same scale as everything
 * else already in the sim.
 *
 * ── Party convention ────────────────────────────────────────────────────
 * `party` is a stringified `PoliticalParty.sequentialId`, matching
 * `Character.party`/`NPP.party` — confirmed against
 * src/lib/seeds/reference/politicalParties.ts (US seedOrder 1 = Democratic
 * Party, seedOrder 2 = Republican Party, so "1" = Democrat, "2" = Republican)
 * and src/lib/seeds/reference/statePartyOrg.ts's DEMOCRAT_SEQ_ID/
 * REPUBLICAN_SEQ_ID constants, which use the identical "1"/"2" strings. Real
 * justices have no game-native party record, so `party` here is authored as
 * the justice's own well-documented personal party registration where it's
 * known to diverge notably from the appointing president's party (Harold
 * Burton: lifelong Republican appointed by Democrat Truman; William Brennan:
 * lifelong Democrat appointed by Republican Eisenhower for 1956
 * election-year balance) — the appointing president's party otherwise.
 *
 * ── Docket effect authoring ─────────────────────────────────────────────
 * 1953-default is the political-legislation preset (`POLITICAL_LEGISLATION_
 * PRESET`, src/lib/politicalLegislation/catalog.ts), so every `effect` below
 * references a real, existing US law from
 * src/lib/politicalLegislation/laws/usLaws.ts by its projected
 * `legislationTypeId` (== `PoliticalLaw.id`) and one of that law's five
 * projected `policyOptionId`s ("l0".."l4", see
 * src/lib/politicalLegislation/project.ts). `effect` always targets the pole
 * OPPOSITE of `historicalMajorityDirection` — a case only ever applies its
 * effect when it diverges, i.e. when the in-game Court decided the opposite
 * of what really happened, so the effect encodes that opposite outcome.
 * `effectDirection` is always set to the same ladder value `project.ts`
 * itself bakes for that option index (l0/l1 → -1, l2 → 0, l3/l4 → +1) so the
 * provision stays internally consistent with the option it names.
 * `economic`/`social` are left undefined so `onBillEnacted` falls through to
 * the policy option's own correctly-signed value (see
 * src/lib/billEnactment.ts `processProvisionEnactment`'s
 * "provision overrides > policy option values" priority) rather than
 * duplicating it here.
 *
 * Six landmark cases below are authored with NO `effect`: Bush v. Gore (a
 * one-off equitable remedy with no lasting law-equivalent to author),
 * Lawrence v. Texas, District of Columbia v. Heller, McDonald v. City of
 * Chicago, United States v. Windsor, and Obergefell v. Hodges (privacy/
 * gun-rights/marriage-equality cases with no plausible existing
 * `legislationTypeId` in the current US catalog — see file header on
 * `docket` below and the ticket's documented fallback: omit rather than
 * force a bad mapping).
 *
 * ── SCOTUS case-catalogue expansion (owner ask: cases beyond race/equality,
 * hardcoded, with real divergent outcomes; see the ops-dashboard report at
 * slug scotus-1953-case-catalogue for the full table) ──────────────────────
 * Seven cases were added beyond the original 21: Watkins v. United States
 * (1957), Baker v. Carr (1962), Engel v. Vitale (1962), Reynolds v. Sims
 * (1964), Wesberry v. Sanders (1964), New York Times v. Sullivan (1964), and
 * Griswold v. Connecticut (1965) — none about race or equal-protection
 * doctrine, spanning congressional-investigation limits, malapportionment,
 * school prayer, press freedom, and privacy.
 *
 * Two cases from the owner's candidate list were evaluated and NOT added:
 * - Youngstown Sheet & Tube v. Sawyer (decided June 1952) predates this
 *   preset's turn-1 starting year (1953) by about seven months — there is no
 *   in-game Court composition at the moment of decision to evaluate
 *   divergence against, so it cannot be scripted as a Docket entry the way
 *   every other case here is. The 1953 Original Roster (the Vinson Court,
 *   unchanged since 1949) already reflects the real-world post-Youngstown
 *   status quo as its starting baseline.
 * - Roth v. United States (1957, obscenity standard) has no plausible
 *   existing `legislationTypeId` in the current US catalog to carry either
 *   branch's effect — same documented fallback as the six no-effect cases
 *   above (omit rather than force a bad mapping).
 *
 * Every case below carries `historicalSummary`; every case EXCEPT the five
 * `historicalOutcomeLocked` race/equal-protection cases (see below) also
 * carries `alternateSummary` — plain-language wire copy consumed by
 * `src/lib/scotus/scotusNews.ts` so EVERY decided case gets a full news post,
 * not just the ones with a mechanical `effect`.
 *
 * Baker v. Carr, Reynolds v. Sims, and Wesberry v. Sanders (the
 * "reapportionment trio") carry `demographicSignal` instead of `effect`:
 * their real consequence is DEMOGRAPHIC — forced reapportionment of
 * malapportioned legislatures/districts — which this system does not model
 * (no `legislationTypeId` moves seat counts or district lines). Per the
 * project's ownership split, that mechanism belongs to a separate,
 * demographic-realignment system (era checkpoints moving demographic base
 * leans); this file only records a well-named signal
 * (`countryHistoryEvents.eventType: "scotus_demographic_signal"`,
 * `scotusDocketTurn.ts`) for that system to consume if/when built.
 *
 * UPDATE (2026-07, demographic-realignment build-out): that system now
 * exists (`src/lib/demographics/eraCheckpoints.ts`). Reynolds v. Sims got a
 * real checkpoint (`REYNOLDS_REAPPORTIONMENT_CHECKPOINT` — chosen as the
 * trio's sole worked example per the "owner-flagged highest-value case" note
 * already on its docket entry below, modeling the rural-to-urban power shift
 * as an approximate LEAN proxy on `wealth:low` in the Midwest, since a true
 * seat/district WEIGHT shift is still out of this mechanism's scope). Baker
 * v. Carr and Wesberry v. Sanders remain signal-only/read-only — authored,
 * not consumed — a deliberate scope call to avoid three near-duplicate
 * checkpoints for the same underlying phenomenon, not an oversight.
 *
 * ── Race/equal-protection cases are HARDCODED to their historical outcome
 * (product decision, 2026-07) ───────────────────────────────────────────────
 * Brown v. Board of Education, Loving v. Virginia, Griggs v. Duke Power,
 * Regents of the Univ. of California v. Bakke, and Shelby County v. Holder
 * all carry `historicalOutcomeLocked: true`. This is a deliberate, permanent
 * design line, not an inconsistency with the rest of the catalogue's genuine
 * composition-driven divergence: there is no "what if segregation were
 * upheld" branch, no alternate ruling on interracial marriage, disparate-
 * impact liability, race-conscious admissions, or VRA preclearance, and none
 * should be added. These five cases therefore author no `effect` and no
 * `alternateSummary` — there is nothing for either field to carry. History
 * happens; the demographic CONSEQUENCES of these rulings (Southern white
 * defection, Black voter consolidation and turnout gains) are still modeled
 * in full, via `src/lib/demographics/eraCheckpoints.ts`'s durable
 * realignment checkpoints, not via this file's `effect` mechanism.
 *
 * Every other case in this catalogue — including ones touching civil
 * liberties (Watkins, Mapp, Miranda, NYT v. Sullivan), religion (Engel),
 * privacy (Griswold), and malapportionment (the reapportionment trio) — is
 * genuine alternate-history territory and uses the ordinary composition-
 * driven `decideCaseOutcome` headcount, unmodified.
 */

const SCOTUS_1953_SEATS: ScotusPresetSeed["seats"] = [
  // ── Seat 1: Chief Justice ─────────────────────────────────────────────
  {
    seatNumber: 1,
    historicalOccupants: [
      {
        key: "vinson-1953",
        name: "Fred M. Vinson",
        party: "1", // Truman (D) appointee
        economicLean: 1,
        socialLean: 1,
        seatedYear: 1953,
        departureYear: 1953, // died in office, Sept 8, 1953
        departureReason: "death",
      },
      {
        key: "warren-1953",
        name: "Earl Warren",
        party: "2", // Eisenhower (R) appointee; jurisprudence ran far more liberal in practice
        economicLean: -2,
        socialLean: -4,
        seatedYear: 1953, // recess-appointed Oct 1953, confirmed Mar 1954
        departureYear: 1969, // retired June 23, 1969
        departureReason: "retirement",
      },
      {
        key: "burger-1969",
        name: "Warren E. Burger",
        party: "2", // Nixon (R) appointee
        economicLean: 2,
        socialLean: 2,
        seatedYear: 1969,
        departureYear: 1986, // retired Sept 26, 1986
        departureReason: "retirement",
      },
      {
        key: "rehnquist-cj-1986",
        name: "William H. Rehnquist",
        party: "2", // Reagan (R) elevation to Chief Justice
        economicLean: 4,
        socialLean: 4,
        seatedYear: 1986,
        departureYear: 2005, // died in office, Sept 3, 2005
        departureReason: "death",
      },
      {
        key: "roberts-2005",
        name: "John G. Roberts Jr.",
        party: "2", // George W. Bush (R) appointee
        economicLean: 3,
        socialLean: 3,
        seatedYear: 2005,
        departureYear: null, // still serving as Chief Justice
        departureReason: null,
      },
    ],
  },
  // ── Seat 2: Hugo Black's seat ─────────────────────────────────────────
  {
    seatNumber: 2,
    historicalOccupants: [
      {
        key: "black-1953",
        name: "Hugo L. Black",
        party: "1", // FDR (D) appointee, 1937
        economicLean: -3,
        socialLean: -3,
        seatedYear: 1953,
        departureYear: 1971, // retired Sept 17, 1971
        departureReason: "retirement",
      },
      {
        key: "powell-1972",
        name: "Lewis F. Powell Jr.",
        party: "2", // Nixon (R) appointee
        economicLean: 1,
        socialLean: 1,
        seatedYear: 1972,
        departureYear: 1987, // retired June 26, 1987
        departureReason: "retirement",
      },
      {
        key: "kennedy-1988",
        name: "Anthony M. Kennedy",
        party: "2", // Reagan (R) appointee
        economicLean: 2,
        socialLean: 0, // famous swing vote; authored Obergefell majority
        seatedYear: 1988,
        departureYear: 2018, // retired July 31, 2018
        departureReason: "retirement",
      },
      {
        key: "kavanaugh-2018",
        name: "Brett M. Kavanaugh",
        party: "2", // Trump (R) appointee
        economicLean: 3,
        socialLean: 3,
        seatedYear: 2018,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
  // ── Seat 3: Stanley Reed's seat ───────────────────────────────────────
  {
    seatNumber: 3,
    historicalOccupants: [
      {
        key: "reed-1953",
        name: "Stanley F. Reed",
        party: "1", // FDR (D) appointee, 1938
        economicLean: 1,
        socialLean: 1,
        seatedYear: 1953,
        departureYear: 1957, // retired Feb 25, 1957
        departureReason: "retirement",
      },
      {
        key: "whittaker-1957",
        name: "Charles E. Whittaker",
        party: "2", // Eisenhower (R) appointee
        economicLean: 1,
        socialLean: 1,
        seatedYear: 1957,
        departureYear: 1962, // retired Mar 31, 1962 (health)
        departureReason: "retirement",
      },
      {
        key: "white-1962",
        name: "Byron R. White",
        party: "1", // Kennedy (D) appointee; dissented in Roe and Miranda
        economicLean: 0,
        socialLean: 2,
        seatedYear: 1962,
        departureYear: 1993, // retired June 28, 1993
        departureReason: "retirement",
      },
      {
        key: "ginsburg-1993",
        name: "Ruth Bader Ginsburg",
        party: "1", // Clinton (D) appointee
        economicLean: -3,
        socialLean: -4,
        seatedYear: 1993,
        departureYear: 2020, // died in office, Sept 18, 2020
        departureReason: "death",
      },
      {
        key: "barrett-2020",
        name: "Amy Coney Barrett",
        party: "2", // Trump (R) appointee
        economicLean: 3,
        socialLean: 4,
        seatedYear: 2020,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
  // ── Seat 4: Felix Frankfurter's seat ──────────────────────────────────
  {
    seatNumber: 4,
    historicalOccupants: [
      {
        key: "frankfurter-1953",
        name: "Felix Frankfurter",
        party: "1", // FDR (D) appointee, 1939; judicial-restraint advocate
        economicLean: 0,
        socialLean: 1,
        seatedYear: 1953,
        departureYear: 1962, // retired Aug 28, 1962 (stroke)
        departureReason: "retirement",
      },
      {
        key: "goldberg-1962",
        name: "Arthur J. Goldberg",
        party: "1", // Kennedy (D) appointee
        economicLean: -2,
        socialLean: -2,
        seatedYear: 1962,
        // Resigned July 25, 1965 to become UN Ambassador — schema's enum has
        // no "resignation" value; "retirement" is the closest fit for a
        // voluntary departure that isn't death.
        departureYear: 1965,
        departureReason: "retirement",
      },
      {
        key: "fortas-1965",
        name: "Abe Fortas",
        party: "1", // Johnson (D) appointee
        economicLean: -2,
        socialLean: -3,
        seatedYear: 1965,
        // Resigned May 14, 1969 amid the Wolfson Foundation scandal — same
        // "retirement" fallback as Goldberg above.
        departureYear: 1969,
        departureReason: "retirement",
      },
      {
        key: "blackmun-1970",
        name: "Harry A. Blackmun",
        party: "2", // Nixon (R) appointee; drifted sharply liberal over his tenure
        economicLean: -1,
        socialLean: -3,
        seatedYear: 1970,
        departureYear: 1994, // retired Aug 3, 1994
        departureReason: "retirement",
      },
      {
        key: "breyer-1994",
        name: "Stephen G. Breyer",
        party: "1", // Clinton (D) appointee
        economicLean: -2,
        socialLean: -2,
        seatedYear: 1994,
        departureYear: 2022, // retired June 30, 2022
        departureReason: "retirement",
      },
      {
        key: "jackson-2022",
        name: "Ketanji Brown Jackson",
        party: "1", // Biden (D) appointee
        economicLean: -3,
        socialLean: -3,
        seatedYear: 2022,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
  // ── Seat 5: William O. Douglas's seat ─────────────────────────────────
  {
    seatNumber: 5,
    historicalOccupants: [
      {
        key: "douglas-1953",
        name: "William O. Douglas",
        party: "1", // FDR (D) appointee, 1939; longest tenure in Court history
        economicLean: -4,
        socialLean: -4,
        seatedYear: 1953,
        departureYear: 1975, // retired Nov 12, 1975 (stroke)
        departureReason: "retirement",
      },
      {
        key: "stevens-1975",
        name: "John Paul Stevens",
        party: "2", // Ford (R) appointee; drifted markedly liberal over his tenure
        economicLean: -2,
        socialLean: -2,
        seatedYear: 1975,
        departureYear: 2010, // retired June 29, 2010
        departureReason: "retirement",
      },
      {
        key: "kagan-2010",
        name: "Elena Kagan",
        party: "1", // Obama (D) appointee
        economicLean: -2,
        socialLean: -2,
        seatedYear: 2010,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
  // ── Seat 6: Robert H. Jackson's seat ──────────────────────────────────
  {
    seatNumber: 6,
    historicalOccupants: [
      {
        key: "rh-jackson-1953",
        name: "Robert H. Jackson",
        party: "1", // FDR (D) appointee, 1941; Nuremberg chief prosecutor
        economicLean: 0,
        socialLean: 0,
        seatedYear: 1953,
        departureYear: 1954, // died in office, Oct 9, 1954
        departureReason: "death",
      },
      {
        key: "harlan-1955",
        name: "John Marshall Harlan II",
        party: "2", // Eisenhower (R) appointee
        economicLean: 2,
        socialLean: 2,
        seatedYear: 1955,
        departureYear: 1971, // retired Sept 23, 1971
        departureReason: "retirement",
      },
      {
        key: "rehnquist-aj-1972",
        name: "William H. Rehnquist",
        party: "2", // Nixon (R) appointee
        economicLean: 4,
        socialLean: 4,
        seatedYear: 1972,
        // Elevated to Chief Justice (seat 1) in 1986 — not a death or
        // retirement, but the schema's enum has no "elevated" value;
        // "retirement" is the closest fit for a departure from THIS seat.
        departureYear: 1986,
        departureReason: "retirement",
      },
      {
        key: "scalia-1986",
        name: "Antonin Scalia",
        party: "2", // Reagan (R) appointee
        economicLean: 4,
        socialLean: 5,
        seatedYear: 1986,
        departureYear: 2016, // died in office, Feb 13, 2016
        departureReason: "death",
      },
      {
        key: "gorsuch-2017",
        name: "Neil M. Gorsuch",
        party: "2", // Trump (R) appointee; seat sat vacant ~14 months (2016-17)
        economicLean: 3,
        socialLean: 3,
        seatedYear: 2017,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
  // ── Seat 7: Harold Burton's seat ──────────────────────────────────────
  {
    seatNumber: 7,
    historicalOccupants: [
      {
        key: "burton-1953",
        name: "Harold Hitz Burton",
        party: "2", // lifelong Republican (former OH senator), appointed by Truman (D)
        economicLean: 1,
        socialLean: 1,
        seatedYear: 1953,
        departureYear: 1958, // retired Oct 13, 1958 (Parkinson's)
        departureReason: "retirement",
      },
      {
        key: "stewart-1958",
        name: "Potter Stewart",
        party: "2", // Eisenhower (R) appointee
        economicLean: 1,
        socialLean: -1,
        seatedYear: 1958,
        departureYear: 1981, // retired July 3, 1981
        departureReason: "retirement",
      },
      {
        key: "oconnor-1981",
        name: "Sandra Day O'Connor",
        party: "2", // Reagan (R) appointee; first woman justice
        economicLean: 1,
        socialLean: 0,
        seatedYear: 1981,
        departureYear: 2006, // retired Jan 31, 2006
        departureReason: "retirement",
      },
      {
        key: "alito-2006",
        name: "Samuel A. Alito Jr.",
        party: "2", // George W. Bush (R) appointee
        economicLean: 4,
        socialLean: 4,
        seatedYear: 2006,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
  // ── Seat 8: Tom C. Clark's seat ───────────────────────────────────────
  {
    seatNumber: 8,
    historicalOccupants: [
      {
        key: "tc-clark-1953",
        name: "Tom C. Clark",
        party: "1", // Truman (D) appointee, 1949
        economicLean: 0,
        socialLean: -1,
        seatedYear: 1953,
        // retired June 12, 1967 when son Ramsey Clark became Attorney General
        departureYear: 1967,
        departureReason: "retirement",
      },
      {
        key: "marshall-1967",
        name: "Thurgood Marshall",
        party: "1", // Johnson (D) appointee; former NAACP chief counsel, argued Brown
        economicLean: -4,
        socialLean: -4,
        seatedYear: 1967,
        departureYear: 1991, // retired Oct 1, 1991
        departureReason: "retirement",
      },
      {
        key: "thomas-1991",
        name: "Clarence Thomas",
        party: "2", // George H.W. Bush (R) appointee
        economicLean: 4,
        socialLean: 5,
        seatedYear: 1991,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
  // ── Seat 9: Sherman Minton's seat ─────────────────────────────────────
  {
    seatNumber: 9,
    historicalOccupants: [
      {
        key: "minton-1953",
        name: "Sherman Minton",
        party: "1", // Truman (D) appointee, 1949
        economicLean: 0,
        socialLean: 1,
        seatedYear: 1953,
        departureYear: 1956, // retired Oct 15, 1956 (poor health)
        departureReason: "retirement",
      },
      {
        key: "brennan-1956",
        name: "William J. Brennan Jr.",
        party: "1", // lifelong Democrat, appointed by Eisenhower (R) for 1956 election-year balance
        economicLean: -4,
        socialLean: -4,
        seatedYear: 1956,
        departureYear: 1990, // retired July 20, 1990 (stroke)
        departureReason: "retirement",
      },
      {
        key: "souter-1990",
        name: "David H. Souter",
        party: "2", // George H.W. Bush (R) appointee; voted markedly more liberal in practice
        economicLean: -1,
        socialLean: -2,
        seatedYear: 1990,
        departureYear: 2009, // retired June 29, 2009
        departureReason: "retirement",
      },
      {
        key: "sotomayor-2009",
        name: "Sonia Sotomayor",
        party: "1", // Obama (D) appointee
        economicLean: -3,
        socialLean: -3,
        seatedYear: 2009,
        departureYear: null, // still serving
        departureReason: null,
      },
    ],
  },
];

const SCOTUS_1953_DOCKET: ScotusPresetSeed["docket"] = [
  {
    caseKey: "brown-v-board-1954",
    title: "Brown v. Board of Education",
    axis: "social",
    historicalMajorityDirection: -1, // unanimous, ended de jure school segregation
    decisionYear: 1954,
    // Race/equal-protection doctrine is hardcoded to its historical outcome —
    // see the file header note above and `historicalOutcomeLocked`'s doc
    // comment (`src/lib/db/types/scotus.ts`). No `effect`/`alternateSummary`:
    // there is no alternate branch, by design, not by omission.
    historicalOutcomeLocked: true,
    historicalSummary:
      "A unanimous Court held that segregated public schools are inherently unequal, overturning Plessy v. Ferguson and ordering the nation's schools desegregated.",
  },
  {
    caseKey: "watkins-v-us-1957",
    title: "Watkins v. United States",
    axis: "social",
    historicalMajorityDirection: -1, // 6-1, curbed unlimited congressional investigative power
    decisionYear: 1957,
    effect: {
      // Approximate mapping: no dedicated "congressional investigation
      // powers" legislationTypeId exists; the Federal Investigations
      // Expansion Act's federal-investigative-reach family is the closest
      // available proxy for "government investigative power expands
      // unchecked" (see project.ts's l0-l4 ladder doc comment above).
      legislationTypeId: "us.sec.investigationsExpansion",
      policyOptionId: "l4",
      effectDirection: 1,
    },
    historicalSummary:
      "By a 6-1 vote, the Court held that Congress's investigative power is not unlimited, overturning a contempt conviction for a witness who refused to name others' political associations and reining in McCarthy-era congressional inquisitions.",
    alternateSummary:
      "The Court instead upheld sweeping congressional investigative authority, giving committees free rein to compel testimony on private political associations with contempt prosecutions as the enforcement backstop.",
  },
  {
    caseKey: "mapp-v-ohio-1961",
    title: "Mapp v. Ohio",
    axis: "social",
    historicalMajorityDirection: -1, // 6-3, exclusionary rule extended to the states
    decisionYear: 1961,
    effect: {
      legislationTypeId: "us.order.communityTrust.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "By a 6-3 vote, the Court extended the exclusionary rule to state courts, barring illegally seized evidence from criminal trials nationwide.",
    alternateSummary:
      "The Court instead left states free to admit illegally obtained evidence at trial, keeping the exclusionary rule a federal-only protection.",
  },
  {
    caseKey: "baker-v-carr-1962",
    title: "Baker v. Carr",
    axis: "social",
    historicalMajorityDirection: -1, // 6-2, held reapportionment claims are justiciable
    decisionYear: 1962,
    // No `effect` authored: the holding is procedural (whether federal courts
    // may even hear malapportionment claims), not a policy-metric change —
    // see demographicSignal below and the file-header note on the
    // reapportionment trio.
    demographicSignal: {
      affirmedSignal: "scotus_reapportionment_doctrine_established",
      divergedSignal: "scotus_political_question_bars_reapportionment",
    },
    historicalSummary:
      "By a 6-2 vote, the Court held that federal courts may hear constitutional challenges to malapportioned state legislative districts, opening the door to the wave of reapportionment suits that followed (Reynolds v. Sims, Wesberry v. Sanders).",
    alternateSummary:
      "The Court instead treated legislative districting as a nonjusticiable 'political question' outside judicial review, shutting the courthouse door on malapportionment challenges and leaving decades-stale, rural-weighted district lines untouchable by any court.",
  },
  {
    caseKey: "engel-v-vitale-1962",
    title: "Engel v. Vitale",
    axis: "social",
    historicalMajorityDirection: -1, // 6-1, banned state-composed school prayer
    decisionYear: 1962,
    effect: {
      legislationTypeId: "us.society.tradition.primary",
      policyOptionId: "l4",
      effectDirection: 1,
    },
    historicalSummary:
      "By a 6-1 vote, the Court held that state-composed, government-sponsored prayer recited in public schools violates the Establishment Clause, ending official classroom prayer.",
    alternateSummary:
      "The Court instead upheld state-sponsored school prayer as consistent with the Constitution, leaving public schools free to open the day with government-composed devotions.",
  },
  {
    caseKey: "gideon-v-wainwright-1963",
    title: "Gideon v. Wainwright",
    axis: "social",
    historicalMajorityDirection: -1, // unanimous, right to appointed counsel
    decisionYear: 1963,
    effect: {
      legislationTypeId: "us.order.legalAid.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "A unanimous Court held that the Sixth Amendment requires states to provide free counsel to criminal defendants who cannot afford a lawyer.",
    alternateSummary:
      "The Court instead left appointed counsel to state discretion, leaving many indigent defendants to face felony trials unrepresented.",
  },
  {
    caseKey: "wesberry-v-sanders-1964",
    title: "Wesberry v. Sanders",
    axis: "social",
    historicalMajorityDirection: -1, // 6-3, mandated equal-population US House districts
    decisionYear: 1964,
    // No `effect` authored — see demographicSignal + file-header note.
    demographicSignal: {
      affirmedSignal: "scotus_congressional_districts_equal_population_mandated",
      divergedSignal: "scotus_congressional_malapportionment_persists",
    },
    historicalSummary:
      "By a 6-3 vote, the Court held that congressional districts within a state must be drawn to as-nearly-equal population as practicable, applying 'one person, one vote' to congressional maps.",
    alternateSummary:
      "The Court instead left congressional districts unequal in population, letting decades-stale lines concentrate outsized voting power in shrinking rural districts at the expense of growing urban and suburban ones.",
  },
  {
    caseKey: "nyt-v-sullivan-1964",
    title: "New York Times Co. v. Sullivan",
    axis: "social",
    historicalMajorityDirection: -1, // unanimous, "actual malice" standard for public-official libel suits
    decisionYear: 1964,
    effect: {
      legislationTypeId: "us.governance.openness.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "A unanimous Court held that public officials suing for libel must prove 'actual malice' — knowledge of falsity or reckless disregard for the truth — sharply limiting officials' ability to use libel suits to punish critical press coverage.",
    alternateSummary:
      "The Court instead left ordinary libel standards in place for public officials, exposing newspapers and critics to ruinous damages for good-faith reporting errors about government conduct.",
  },
  {
    caseKey: "reynolds-v-sims-1964",
    title: "Reynolds v. Sims",
    axis: "social",
    historicalMajorityDirection: -1, // 8-1, mandated "one person, one vote" for state legislatures
    decisionYear: 1964,
    // No `effect` authored — see demographicSignal + file-header note. This
    // is the owner-flagged highest-value case in the window: the engine
    // already models seat allocation and districts, so the alternate
    // outcome (rural over-representation persists) has a direct, visible
    // consequence — but applying it is the demographic-realignment
    // mechanism's job, not this system's.
    demographicSignal: {
      affirmedSignal: "scotus_state_legislature_one_person_one_vote_mandated",
      divergedSignal: "scotus_state_legislature_malapportionment_persists",
    },
    historicalSummary:
      "By an 8-1 vote, the Court mandated that both chambers of every state legislature be apportioned by population — 'one person, one vote' — striking down maps that gave sparsely populated rural districts outsized power over cities and suburbs.",
    alternateSummary:
      "The Court instead upheld state legislatures apportioned on factors other than population, letting rural-weighted maps that dramatically over-represent shrinking districts stand indefinitely, regardless of where the population actually lives.",
  },
  {
    caseKey: "griswold-v-connecticut-1965",
    title: "Griswold v. Connecticut",
    axis: "social",
    historicalMajorityDirection: -1, // 7-2, recognized a constitutional right to marital privacy
    decisionYear: 1965,
    effect: {
      legislationTypeId: "us.society.womensOpportunity.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "By a 7-2 vote, the Court struck down Connecticut's ban on contraceptive use by married couples, recognizing a constitutional right to privacy that later rulings built on.",
    alternateSummary:
      "The Court instead upheld the state's authority to criminalize contraceptive use, leaving no recognized constitutional right to marital privacy.",
  },
  {
    caseKey: "miranda-v-arizona-1966",
    title: "Miranda v. Arizona",
    axis: "social",
    historicalMajorityDirection: -1, // 5-4, mandated custodial-interrogation warnings
    decisionYear: 1966,
    effect: {
      legislationTypeId: "us.order.dueProcess.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "By a 5-4 vote, the Court required police to inform suspects of their rights to silence and counsel before custodial interrogation, creating the now-familiar Miranda warning.",
    alternateSummary:
      "The Court instead left custodial interrogations unregulated by any warning requirement, letting confessions obtained without notice of rights stand as valid evidence.",
  },
  {
    caseKey: "loving-v-virginia-1967",
    title: "Loving v. Virginia",
    axis: "social",
    historicalMajorityDirection: -1, // unanimous, struck interracial-marriage bans
    decisionYear: 1967,
    // Race/equal-protection doctrine — hardcoded to history, see brown-v-board-1954 above.
    historicalOutcomeLocked: true,
    historicalSummary:
      "A unanimous Court struck down state bans on interracial marriage as violations of equal protection and due process.",
  },
  {
    caseKey: "griggs-v-duke-power-1971",
    title: "Griggs v. Duke Power Co.",
    axis: "economic",
    historicalMajorityDirection: -1, // unanimous, established Title VII disparate-impact liability
    decisionYear: 1971,
    // Race/equal-protection doctrine — hardcoded to history, see brown-v-board-1954 above.
    historicalOutcomeLocked: true,
    historicalSummary:
      "A unanimous Court held that employment practices with a discriminatory effect — not just discriminatory intent — violate Title VII, establishing disparate-impact liability.",
  },
  {
    caseKey: "furman-v-georgia-1972",
    title: "Furman v. Georgia",
    axis: "social",
    historicalMajorityDirection: -1, // 5-4, struck down capital punishment as then applied
    decisionYear: 1972,
    effect: {
      legislationTypeId: "us.order.deterrence.primary",
      policyOptionId: "l4",
      effectDirection: 1,
    },
    historicalSummary:
      "By a fractured 5-4 vote, the Court held the death penalty as then administered was unconstitutionally arbitrary, effectively voiding every state's capital-punishment statute.",
    alternateSummary:
      "The Court instead upheld capital punishment as administered, leaving existing death-penalty statutes and scheduled executions in place nationwide.",
  },
  {
    caseKey: "roe-v-wade-1973",
    title: "Roe v. Wade",
    axis: "social",
    historicalMajorityDirection: -1, // 7-2, recognized a constitutional right to abortion
    decisionYear: 1973,
    effect: {
      legislationTypeId: "us.society.womensOpportunity.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "By a 7-2 vote, the Court recognized a constitutional right to abortion prior to fetal viability, striking down state bans nationwide.",
    alternateSummary:
      "The Court instead upheld state authority to ban abortion, leaving no federal constitutional right to the procedure and abortion policy entirely to the states.",
  },
  {
    caseKey: "gregg-v-georgia-1976",
    title: "Gregg v. Georgia",
    axis: "social",
    historicalMajorityDirection: 1, // 7-2, reinstated capital punishment under guided-discretion statutes
    decisionYear: 1976,
    effect: {
      legislationTypeId: "us.order.deterrence.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "By a 7-2 vote, the Court upheld newly rewritten capital-punishment statutes with guided sentencing discretion, reinstating the death penalty.",
    alternateSummary:
      "The Court instead held that no rewritten statute could cure the arbitrariness identified in Furman, keeping the nationwide capital-punishment moratorium in place.",
  },
  {
    caseKey: "bakke-v-regents-1978",
    title: "Regents of the University of California v. Bakke",
    axis: "social",
    historicalMajorityDirection: -1, // fractured 4-1-4, but race permitted as one admissions factor
    decisionYear: 1978,
    // Race/equal-protection doctrine — hardcoded to history, see brown-v-board-1954 above.
    historicalOutcomeLocked: true,
    historicalSummary:
      "In a fractured 4-1-4 ruling, the Court struck down rigid racial quotas in university admissions but held race could still be considered as one factor among many.",
  },
  {
    caseKey: "casey-v-planned-parenthood-1992",
    title: "Planned Parenthood v. Casey",
    axis: "social",
    historicalMajorityDirection: -1, // 5-4, reaffirmed Roe's core holding under an undue-burden standard
    decisionYear: 1992,
    effect: {
      legislationTypeId: "us.society.womensOpportunity.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "By a 5-4 vote, the Court reaffirmed Roe's core holding while replacing its trimester framework with an 'undue burden' standard for abortion restrictions.",
    alternateSummary:
      "The Court instead overturned Roe outright, returning abortion policy fully to the states nearly two decades before that actually happened.",
  },
  {
    caseKey: "bush-v-gore-2000",
    title: "Bush v. Gore",
    axis: "social",
    historicalMajorityDirection: 1, // 5-4, halted the Florida recount
    decisionYear: 2000,
    // No effect authored: a one-off equitable remedy in a single election
    // dispute, with no lasting law-equivalent to model.
    historicalSummary:
      "By a 5-4 vote, the Court halted the Florida ballot recount, effectively deciding the 2000 presidential election in George W. Bush's favor.",
    alternateSummary:
      "The Court instead allowed the statewide recount to proceed to completion under Florida's own timeline, leaving the outcome to whatever the recount produced.",
  },
  {
    caseKey: "lawrence-v-texas-2003",
    title: "Lawrence v. Texas",
    axis: "social",
    historicalMajorityDirection: -1, // 6-3, struck down state sodomy laws
    decisionYear: 2003,
    // No effect authored: no existing legislationTypeId plausibly covers
    // private sexual-conduct criminalization.
    historicalSummary:
      "By a 6-3 vote, the Court struck down state sodomy laws, holding that private consensual sexual conduct between adults is constitutionally protected.",
    alternateSummary:
      "The Court instead upheld state sodomy laws, leaving private consensual sexual conduct between adults criminally prosecutable wherever states chose to keep such statutes on the books.",
  },
  {
    caseKey: "heller-v-dc-2008",
    title: "District of Columbia v. Heller",
    axis: "social",
    historicalMajorityDirection: 1, // 5-4, recognized an individual Second Amendment right
    decisionYear: 2008,
    // No effect authored: no gun-rights legislationTypeId exists in the
    // current US catalog.
    historicalSummary:
      "By a 5-4 vote, the Court recognized an individual right to keep and bear arms for self-defense, striking down the District's handgun ban.",
    alternateSummary:
      "The Court instead held the Second Amendment protects only a collective, militia-related right, upholding the District's handgun ban and similar restrictions.",
  },
  {
    caseKey: "citizens-united-v-fec-2010",
    title: "Citizens United v. FEC",
    axis: "social",
    historicalMajorityDirection: 1, // 5-4, deregulated independent campaign expenditures
    decisionYear: 2010,
    effect: {
      legislationTypeId: "us.governance.participation.primary",
      policyOptionId: "l4",
      effectDirection: 1,
    },
    historicalSummary:
      "By a 5-4 vote, the Court held that corporate and union independent political expenditures are protected speech, striking down limits on such spending.",
    alternateSummary:
      "The Court instead upheld restrictions on corporate and union independent political expenditures, keeping campaign-spending limits in force.",
  },
  {
    caseKey: "mcdonald-v-chicago-2010",
    title: "McDonald v. City of Chicago",
    axis: "social",
    historicalMajorityDirection: 1, // 5-4, incorporated the Second Amendment against the states
    decisionYear: 2010,
    // No effect authored: same reasoning as Heller above.
    historicalSummary:
      "By a 5-4 vote, the Court held the Second Amendment's individual right applies against state and local governments, striking down Chicago's handgun ban.",
    alternateSummary:
      "The Court instead held the Second Amendment does not bind the states, leaving city and state handgun bans like Chicago's enforceable.",
  },
  {
    caseKey: "nfib-v-sebelius-2012",
    title: "National Federation of Independent Business v. Sebelius",
    axis: "economic",
    historicalMajorityDirection: -1, // 5-4, upheld the ACA individual mandate as a tax
    decisionYear: 2012,
    effect: {
      legislationTypeId: "us.health.universalCare.primary",
      policyOptionId: "l0",
      effectDirection: -1,
    },
    historicalSummary:
      "By a 5-4 vote, the Court upheld the Affordable Care Act's individual mandate as a valid exercise of Congress's taxing power.",
    alternateSummary:
      "The Court instead struck down the individual mandate, gutting the ACA's central enforcement mechanism for near-universal coverage.",
  },
  {
    caseKey: "shelby-county-v-holder-2013",
    title: "Shelby County v. Holder",
    axis: "social",
    historicalMajorityDirection: 1, // 5-4, struck the VRA's preclearance coverage formula
    decisionYear: 2013,
    // Race/voting-rights doctrine — hardcoded to history, see brown-v-board-1954 above.
    historicalOutcomeLocked: true,
    historicalSummary:
      "By a 5-4 vote, the Court struck down the Voting Rights Act's coverage formula, ending automatic federal preclearance for covered jurisdictions' election-law changes.",
  },
  {
    caseKey: "windsor-v-united-states-2013",
    title: "United States v. Windsor",
    axis: "social",
    historicalMajorityDirection: -1, // 5-4, struck DOMA's federal marriage-recognition bar
    decisionYear: 2013,
    // No effect authored: no marriage-recognition legislationTypeId exists
    // in the current US catalog.
    historicalSummary:
      "By a 5-4 vote, the Court struck down DOMA's bar on federal recognition of same-sex marriages performed under state law.",
    alternateSummary:
      "The Court instead upheld DOMA, leaving same-sex marriages performed under state law unrecognized for any federal purpose.",
  },
  {
    caseKey: "obergefell-v-hodges-2015",
    title: "Obergefell v. Hodges",
    axis: "social",
    historicalMajorityDirection: -1, // 5-4, nationwide marriage equality
    decisionYear: 2015,
    // No effect authored: same reasoning as Windsor above.
    historicalSummary:
      "By a 5-4 vote, the Court held that the right to marry is guaranteed to same-sex couples, legalizing same-sex marriage nationwide.",
    alternateSummary:
      "The Court instead upheld state authority to limit marriage to opposite-sex couples, leaving same-sex marriage recognition a state-by-state patchwork.",
  },
  {
    caseKey: "dobbs-v-jackson-2022",
    title: "Dobbs v. Jackson Women's Health Organization",
    axis: "social",
    historicalMajorityDirection: 1, // 6-3, overturned Roe and Casey
    decisionYear: 2022,
    effect: {
      legislationTypeId: "us.society.womensOpportunity.primary",
      policyOptionId: "l4",
      effectDirection: 1,
    },
    historicalSummary:
      "By a 6-3 vote, the Court overturned Roe and Casey, holding the Constitution confers no right to abortion and returning the question entirely to the states.",
    alternateSummary:
      "The Court instead reaffirmed Roe and Casey's constitutional protection for abortion, keeping the nationwide right in place instead of overturning it.",
  },
];

export const SCOTUS_1953_SEED: ScotusPresetSeed = {
  seats: SCOTUS_1953_SEATS,
  docket: SCOTUS_1953_DOCKET,
};
