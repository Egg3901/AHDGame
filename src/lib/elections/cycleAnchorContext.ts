/**
 * Preset-aware canonical cycle-1 anchors.
 *
 * Per-preset real-world election years drive every canonical cycle-1
 * end-turn. For the 2019-default preset that's the next post-2019
 * election in each family (US House 2022, UK GE 2024, JP Sangiin 2022,
 * etc.). For 1991-default it's the next post-1991 election (US House
 * 1992, UK GE 1992, JP Sangiin Class A 1992 / Class B 1995, …).
 *
 * `getCycleAnchors(ctx)` converts those year anchors to turn anchors
 * using the preset's `startingYear` (the calendar year of turn 1).
 *
 * Callers fetch ctx from `GameState` via `cycleAnchorContextFromGameState`
 * and pass it into `canonicalTurnsForCycle` / `pickNextCanonicalCycle`.
 * Tests can use `DEFAULT_CYCLE_ANCHOR_CONTEXT` for the 2019-default
 * back-compat behavior.
 */

import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { GameState } from "@/lib/db/types/gameState";

export interface CycleAnchorContext {
  /** Calendar year of turn 1 — `GameState.startingYear`. */
  startingYear: number;
  /** Reset-preset id — `GameState.preset`. Selects the per-era real-election-year map. */
  preset: string;
  /**
   * `GameState.preIterationTurns` — additive raw-turn offset applied by a
   * completed pre-iteration (founding) phase. Every cycle-1 anchor is shifted
   * forward by this amount so that, after the calendar unpins at the era start,
   * real-world election years still map to the correct RAW turns. Zero/undefined
   * on normal worlds (identity — the historical mapping is unchanged).
   */
  preIterationTurns?: number;
  /**
   * `GameState.preIteration?.active` — while true, `pickNextCanonicalCycle`
   * returns a one-off "founding" cycle (cycle 0) that runs a full normal
   * campaign starting now for EVERY in-scope race (all staggered classes at
   * once), ignoring the historical anchor, so the whole world seats together.
   * Undefined/false on normal worlds → the canonical schedule is unchanged.
   */
  preIterationActive?: boolean;
}

/**
 * Per-preset real-world election years used as the cycle-1 anchor for
 * each election family. The `(realYear − startingYear + 1) × TURNS_PER_YEAR`
 * formula in `getCycleAnchors` converts these to turn numbers.
 *
 * UK Commons + JP Sangiin use the `(realYear − startingYear) × 48 + 27`
 * formula instead (their real elections happen in week 27 / July rather
 * than at end-of-year), so those are stored as the same year value but
 * consumed differently below.
 */
export interface PresetElectionYears {
  /** US House: next bootstrap mid-term post-preset-start. */
  house: number;
  /** US Senate Class 1 (was 1988/1994/2000/2006/2012/2018/2024/2030/…). */
  senateClass1: number;
  /** US Senate Class 2 (was 1990/1996/2002/2008/2014/2020/2026/…). */
  senateClass2: number;
  /** US Senate Class 3 (was 1986/1992/1998/2004/2010/2016/2022/2028/…). */
  senateClass3: number;
  /** US Governor / State Senate (mid-term anchor). */
  governorStateSenate: number;
  /** US President (4-year cycle anchor). */
  president: number;
  /** NG concurrent general election (President + NASS + Governors), 4-year cycle. */
  ngGeneral: number;
  /** UK Commons GE (week 27 of this year). */
  ukCommons: number;
  /** JP Sangiin Class A (week 27 / July of this year). */
  jpSangiinClass1: number;
  /** JP Sangiin Class B (week 27 / July of this year). */
  jpSangiinClass2: number;
  /** JP Shugiin (lower house). */
  jpShugiin: number;
  /** DE Bundestag. */
  deBundestag: number;
  /**
   * DE Landtag fallback: per-Land overrides live in
   * `LANDTAG_CYCLE1_END_TURN_BY_LAND_BY_PRESET`. This field is the
   * preset-wide fallback anchor used when a Land has no per-Land entry.
   */
  deLandtag: number;
  /**
   * CN NPC Delegate (and Provincial People's Congress — they share the
   * canonical cycle). Real-world plenary years: 13th NPC 2018, 14th NPC
   * 2023, etc. Used by both `npcDelegate` and `peoplesCongress` election
   * types since they sync on the same 5-year cadence.
   */
  cnNpcDelegate: number;
  /** BR Câmara dos Deputados (4-year cycle; 1990/1994/1998/2002/…). */
  brChamber: number;
  /** BR Senate — staggered terms; this is the next post-preset elective year. */
  brSenate: number;
  /** IE Dáil Éireann (variable 4-5 year cycle; next post-preset GE year). */
  ieDail: number;
  /**
   * IE Uachtarán na hÉireann (President of Ireland) — 7-year direct nationwide
   * election. Next post-preset presidential election year.
   */
  ieUachtaran: number;
  /**
   * IE Local Council — 5-year synchronized cycle. Real-world Irish local
   * elections happen alongside European Parliament elections every 5 years
   * (2019, 2024, 2029…). Next post-preset local-election year.
   */
  ieLocalCouncil: number;
  /**
   * SCO Scottish Parliament (Holyrood) — 5-year AMS cycle (2016, 2021, 2026…).
   * Only stood up when Scotland secedes (mid-game); the anchor is the nearest
   * canonical Holyrood year and the cycle math rolls forward to the next one
   * after the secession turn. Pre-devolution presets anchor to the 1999 first
   * election.
   */
  scoHolyrood: number;
  /** WAL Senedd Cymru — 5-year AMS cycle (2016, 2021, 2026…); same model as Holyrood. */
  walSenedd: number;
  /** FR Assemblée nationale — 5-year cycle (modeled; IV Republic terms were 5y too). */
  frAssembly: number;
  /** IT Camera dei Deputati — 5-year cycle. */
  itCamera: number;
  /**
   * ES Congreso de los Diputados — 4-year cycle. `null` era-gates the cycle
   * OFF for presets where Spain holds no elections (1953-default: Franco
   * dictatorship — the Cortes Españolas were not democratically elected, so
   * the country stays static by design; see issue #3239).
   */
  esCongreso: number | null;
  /** SE Riksdag — 4-year cycle (real cadence was 3y 1970-1994; modeled as 4). */
  seRiksdag: number;
  /** TR Grand National Assembly (Millet Meclisi) — 4-year cycle. */
  trMeclis: number;
  /** GR Vouli ton Ellinon (Hellenic Parliament) — 4-year cycle (#3791). */
  grVouli: number;
  /** AT Nationalrat — 4-year cycle (#3791). */
  atNationalrat: number;
  /** FI Eduskunta — 4-year cycle (#3791). */
  fiEduskunta: number;
  /**
   * FR Sénat — 9-year cycle (matches `upperElectionSystem.termYears: 9`).
   * SIMPLIFICATION (#3791): the real Sénat renews by series (thirds pre-2004,
   * halves 2004+) every 3 years, not the whole chamber at once — there is no
   * seat-series/class data model for FR (unlike the US Senate's
   * `senateClass`), so this models a full-chamber re-election every 9 years,
   * matching the country config's own `seatsContested: "all"` declaration.
   */
  frSenat: number;
  /**
   * TR Senate of the Republic (Cumhuriyet Senatosu) — `null` = no cycle this
   * preset (#3791). The real chamber only existed 1961-1980 (one-third
   * renewed every 2 years, abolished after the 1980 coup); this is NOT
   * modeled — every preset except 1953-default gates the cycle off entirely
   * (modern Turkey has been unicameral since 1980). 1953-default anchors to
   * the real 1961 founding election on a simplified full-chamber 6-year
   * cycle (matches `upperElectionSystem.termYears: 6`); the TR Senate's 16
   * seats are already seeded from turn 1 in that preset regardless of the
   * real 1961 founding date (existing seed simplification, not new here).
   */
  trSenato: number | null;
  /**
   * RU Supreme Soviet — ONE shared anchor for both chambers (Soviet of the
   * Union + Soviet of Nationalities were elected the same day). `null`
   * era-gates RU elections OFF (2019/1991: no USSR — RU stays static, the
   * esCongreso pattern). 4-year cadence via the cycle table's periodHours.
   */
  ruSupremeSoviet: number | null;
  /**
   * Republic Supreme Soviets + First Secretary anchor. Same null-gating.
   *
   * Used for BOTH RU's sub-national republic soviets AND the three union
   * republics that are their own countries here (UKR/BLR/BAL): the Ukrainian,
   * Byelorussian and Baltic Supreme Soviets were elected on this same all-Union
   * republic cycle - 1947, 1951, 1955, 1959 - one year offset from the USSR
   * Supreme Soviet, so they share the anchor rather than needing one each.
   */
  ruRepublicSoviet: number | null;
  /**
   * DD GDR Volkskammer — single-list National Front cycle. `null` era-gates DD
   * elections OFF (2019/1991/2023 — no GDR, reunified 1990). 5-year period via
   * the cycle table's periodHours (DD config termYears:5).
   */
  ddVolkskammer: number | null;
}

/**
 * Real-world election years per preset.
 *
 * 2019-default = era starting Jan 2019. Next post-1/1/2019 events:
 *   - US House: Nov 2022 (skipping Nov 2020 in our bootstrap-data model)
 *   - US Senate: Class 1 → 2024, Class 2 → 2026, Class 3 → 2022
 *   - US Pres / Gov / State Senate: 2024
 *   - UK Commons: Jul 2024 (Dec 2019 GE bootstrap-skipped)
 *   - JP Sangiin Class A: Jul 2022 ; Class B: Jul 2025 (skipping Jul 2019)
 *   - JP Shugiin: anchored to 2024 in the existing model
 *   - DE Bundestag: anchored to 2024 in the existing model
 *
 * 1991-default = era starting Jan 1991. Next post-1/1/1991 events:
 *   - US House: Nov 1992 (no 1990s skip — bootstrap-data is mid-102nd Congress)
 *   - US Senate: Class 1 → 1994, Class 2 → 1996, Class 3 → 1992
 *   - US Pres: 1992 ; Gov / State Senate: 1994 (next mid-term)
 *   - UK Commons: Apr 1992 (Major's win)
 *   - JP Sangiin Class A: Jul 1992 (24th regular election) ; Class B: Jul 1995 (skipping Jul 1989/Jul 1986 baseline)
 *   - JP Shugiin: 1993 (next post-1990 election)
 *   - DE Bundestag: 1994 (post-1990 reunification election)
 *
 * 1953-default = era starting Jan 1953 (Eisenhower's first year). Next
 * post-1/1/1953 events — added for sandbox-seed-audit-t101 (before this
 * entry existed, every 1953-default election silently fell through to the
 * 2019-default years below, anchoring cycle-1 ~69 years in the future —
 * e.g. house's 2022 anchor computed to endTurn 3360, nowhere near reachable):
 *   - US House: Nov 1954 (first midterm after the 1953 start)
 *   - US Senate: Class 3 → 1954, Class 1 → 1956, Class 2 → 1958 (spread
 *     across the three biennial post-start years, same convention as 1991)
 *   - US Pres: 1956 (Eisenhower re-election) ; Gov / State Senate: 1954 (midterm)
 *   - UK Commons: May 1955 (Churchill hands off to Eden, Conservative win)
 *   - JP Sangiin Class A: Jul 1956 ; Class B: Jul 1959 (real House of Councillors elections)
 *   - JP Shugiin: Feb 1955 (real House of Representatives election)
 *   - DE Bundestag: Sep 1957 (next Bundestag election after the Sep 1953 one)
 */
export const CANONICAL_REAL_ELECTION_YEARS_BY_PRESET: Record<string, PresetElectionYears> = {
  "2019-default": {
    house: 2022,
    senateClass1: 2024,
    senateClass2: 2026,
    senateClass3: 2022,
    governorStateSenate: 2024,
    president: 2024,
    ngGeneral: 2023,
    ukCommons: 2024,
    jpSangiinClass1: 2022,
    jpSangiinClass2: 2025,
    jpShugiin: 2024,
    deBundestag: 2024,
    deLandtag: 2026,
    // 14th NPC convened March 2023 (replaces 13th NPC from 2018 baseline).
    cnNpcDelegate: 2023,
    brChamber: 2022,
    brSenate: 2022,
    ieDail: 2024,
    // Higgins won 2018 (term 2018-2025); next election Oct/Nov 2025.
    ieUachtaran: 2025,
    // Irish local elections June 2024 (held with EP elections).
    ieLocalCouncil: 2024,
    // Holyrood / Senedd elections both held May 2021; next May 2026.
    scoHolyrood: 2021,
    walSenedd: 2021,
    // FR legislative June 2022 (post-presidential); IT snap September 2022;
    // ES general July 2023; SE Riksdag September 2022; TR general May 2023.
    frAssembly: 2022,
    itCamera: 2022,
    esCongreso: 2023,
    seRiksdag: 2022,
    trMeclis: 2023,
    // GR July 2019 / AT Sept 2019 / FI Apr 2019 are all start-adjacent (Jan
    // 2019 start) — next real elections instead.
    grVouli: 2023, // GR held two 2023 elections (May/June); anchors to that year
    atNationalrat: 2024,
    fiEduskunta: 2023,
    frSenat: 2020, // real Sept 2020 Sénat renewal (series 2)
    // No Cumhuriyet Senatosu in this era — abolished 1980, modern TR is unicameral.
    trSenato: null,
    // No USSR in this era — RU holds no elections by design.
    ruSupremeSoviet: null,
    ruRepublicSoviet: null,
    // No GDR in this era (reunified 1990) — DD holds no elections by design.
    ddVolkskammer: null,
  },
  "1991-default": {
    house: 1992,
    senateClass1: 1994,
    senateClass2: 1996,
    senateClass3: 1992,
    governorStateSenate: 1994,
    president: 1992,
    ngGeneral: 1993,
    ukCommons: 1992,
    jpSangiinClass1: 1992,
    jpSangiinClass2: 1995,
    jpShugiin: 1993,
    deBundestag: 1994,
    deLandtag: 1995, // post-1990 Land cycle mid-point fallback
    // 8th NPC convened March 1993 (replaces 7th NPC from 1988 baseline).
    cnNpcDelegate: 1993,
    brChamber: 1994, // 1994 Brazilian general election
    brSenate: 1994,
    ieDail: 1992, // 1992 IE general election (Reynolds-Spring coalition)
    // Robinson won 1990 (term 1990-1997); next election Oct/Nov 1997.
    ieUachtaran: 1997,
    // Irish local elections held June 1991.
    ieLocalCouncil: 1991,
    // Pre-devolution era: first Scottish Parliament / Welsh Assembly election 1999.
    scoHolyrood: 1999,
    walSenedd: 1999,
    // FR legislative March 1993 (Balladur cohabitation); IT general April 1992;
    // ES general June 1993; SE Riksdag September 1994; TR general December 1995.
    frAssembly: 1993,
    itCamera: 1992,
    esCongreso: 1993,
    seRiksdag: 1994,
    trMeclis: 1995,
    grVouli: 1993,
    atNationalrat: 1994,
    // FI Mar 1991 is start-adjacent (Jan 1991 start) — next real election.
    fiEduskunta: 1995,
    frSenat: 1992, // real Sept 1992 Sénat renewal (series 1)
    trSenato: null, // abolished 1980 — no Cumhuriyet Senatosu by this era
    // The USSR dissolves as this era opens — RU holds no elections by design.
    ruSupremeSoviet: null,
    ruRepublicSoviet: null,
    ddVolkskammer: null, // GDR reunified into DE in 1990 — no elections
  },
  "1953-default": {
    house: 1954,
    senateClass3: 1954,
    senateClass1: 1956,
    senateClass2: 1958,
    governorStateSenate: 1954,
    president: 1956, // Eisenhower re-election
    // NG isn't independent until 1960 in real history; this era treats it as
    // playable from the 1953 start regardless (same abstraction the other
    // presets already make), so anchor its first cycle near the US midterm.
    ngGeneral: 1954,
    ukCommons: 1955, // Churchill -> Eden, Conservative win
    jpSangiinClass1: 1956,
    jpSangiinClass2: 1959,
    jpShugiin: 1955,
    deBundestag: 1957, // next Bundestag election after the Sep 1953 one
    deLandtag: 1957, // fallback, mirrors the Bundestag anchor
    // 1st NPC convened September 1954 — a real, well-documented date.
    cnNpcDelegate: 1954,
    brChamber: 1954, // 1954 Brazilian general election
    brSenate: 1954,
    ieDail: 1954, // 1954 IE general election (Costello's 2nd government)
    // O'Kelly's term (1952-1959) is the first full term under the 1937
    // constitution's direct election model; next election 1959.
    ieUachtaran: 1959,
    ieLocalCouncil: 1955, // Irish local elections held 1955
    // Pre-devolution era: first Scottish Parliament / Welsh Assembly election 1999.
    scoHolyrood: 1999,
    walSenedd: 1999,
    // FR: IV Republic National Assembly — 1951 election, next January 1956.
    frAssembly: 1956,
    // IT: Chamber of Deputies — June 1953 election just held, next 1958.
    itCamera: 1958,
    // ES: Franco dictatorship — NO elections in this era (era-gated OFF).
    esCongreso: null,
    // SE: bicameral-era Second Chamber — 1952 election, next September 1956.
    seRiksdag: 1956,
    // TR: Grand National Assembly — 1950 election, next May 1954 (real 1957
    // snap is approximated by the fixed 4-year period → 1958).
    trMeclis: 1954,
    // GR: 1952 Vouli election, next 1956. AT: 1953 Nationalrat just held,
    // next 1956. FI: 1951 Eduskunta, next 1954.
    grVouli: 1956,
    atNationalrat: 1956,
    fiEduskunta: 1954,
    // FR: pre-Fifth-Republic Conseil de la République partial renewal 1955
    // (nearest real Senate-family election after 1953; the whole-Senate model
    // used here is a simplification regardless of era — see PresetElectionYears).
    frSenat: 1955,
    // TR: Cumhuriyet Senatosu didn't exist until the 1961 constitution — this
    // preset anchors to the real 1961 founding election anyway (rather than
    // era-gating it off) because the TR Senate's 16 seats are already seeded
    // from turn 1 in this preset regardless of the real founding date
    // (existing seed simplification); `pickNextCanonicalCycle`'s forward-walk
    // handles the out-of-the-gate cycle-1 anchor fine.
    trSenato: 1961,
    // RU: 4th-convocation Supreme Soviet election March 1954; republic
    // Supreme Soviet elections Feb-Mar 1955. The Ukrainian and Byelorussian SSR
    // Supreme Soviets were last elected in 1951, so 1955 is genuinely their next
    // one; the Baltic republics ran the same four-year cycle.
    ruSupremeSoviet: 1954,
    ruRepublicSoviet: 1955,
    // DD: GDR Volkskammer elected Oct 1950 (4-yr term); next election Oct 1954.
    ddVolkskammer: 1954,
  },
  // 1979-default = era starting Jan 1979. This entry also closes the silent
  // 2019-fallback gap for the whole preset (same class of bug the 1953 entry
  // fixed — see the sandbox-seed-audit-t101 note above): before it existed,
  // every 1979-default election anchored to the 2019-default years, ~40 years
  // out of reach.
  "1979-default": {
    house: 1980,
    senateClass3: 1980,
    senateClass1: 1982,
    senateClass2: 1984,
    governorStateSenate: 1982,
    president: 1980, // Reagan defeats Carter
    // Real Nigerian 1979 general is too close to turn 1 to run (the cycle
    // gate skips it), so cycle math lands on the real 1983 general.
    ngGeneral: 1979,
    // Real May 1979 GE (Thatcher) is pre-start-adjacent; anchor the next GE.
    ukCommons: 1983,
    jpSangiinClass1: 1980,
    jpSangiinClass2: 1983,
    jpShugiin: 1980, // real June 1980 double election
    deBundestag: 1980, // Schmidt re-elected
    deLandtag: 1982, // preset-wide fallback anchor
    // 6th NPC convened June 1983.
    cnNpcDelegate: 1983,
    brChamber: 1982, // 1982 Brazilian legislative election
    brSenate: 1982,
    ieDail: 1981, // June 1981 IE general election
    // Hillery's first term 1976-1983; re-elected (unopposed) 1983.
    ieUachtaran: 1983,
    ieLocalCouncil: 1979, // June 1979 Irish local elections
    // Pre-devolution era: first Scottish Parliament / Welsh Assembly election 1999.
    scoHolyrood: 1999,
    walSenedd: 1999,
    // FR legislative June 1981 (post-Mitterrand dissolution); IT general June
    // 1983 (June 1979 is pre-start-adjacent); ES general October 1982 (PSOE
    // landslide); SE Riksdag September 1982 (Sept 1979 is pre-start-adjacent);
    // TR general November 1983 (first post-coup election).
    frAssembly: 1981,
    itCamera: 1983,
    esCongreso: 1982,
    seRiksdag: 1982,
    trMeclis: 1983,
    // GR Nov 1977 → next real Vouli election Oct 1981. AT Oct 1979 is
    // start-adjacent — next real election 1983. FI Mar 1979 is
    // start-adjacent — next real election 1983.
    grVouli: 1981,
    atNationalrat: 1983,
    fiEduskunta: 1983,
    frSenat: 1980, // real Sept 1980 Sénat renewal (series 1)
    // Cumhuriyet Senatosu abolished by the Sept 1980 coup, right at this
    // era's start — no functioning cycle in this preset either.
    trSenato: null,
    // RU: the real March 1979 Supreme Soviet election is pre-start-adjacent
    // (same skip convention as ukCommons/itCamera/seRiksdag in this preset),
    // so the 11th convocation (1984) anchors; republic soviets Feb 1980 - which
    // is also the next election for UKR/BLR/BAL, who ride this anchor.
    ruSupremeSoviet: 1984,
    ruRepublicSoviet: 1980,
    // DD: the real Mar 1979 Volkskammer election is pre-start-adjacent (same skip
    // as ukCommons/seRiksdag here), so the next (June 1981) anchors.
    ddVolkskammer: 1981,
  },
  // 2023-default = era starting Jan 2023 (118th US Congress just seated). Like
  // the 1953/1979 entries, this closes the silent 2019-fallback gap for the
  // whole preset: without it, getCycleAnchors() fell through to the 2019-default
  // real-election years against a startingYear of 2023, producing turn-0 /
  // negative cycle-1 endTurns (house 2022 → (2022-2023+1)*48 = 0, jpSangiin
  // 2022 → week27 = -21) — i.e. elections firing immediately / already-over on
  // turn 1. Anchored to the first cleanly-reachable real election after Jan 2023;
  // start-adjacent 2023 races (ES/TR general, NG Feb-2023) are skipped to the
  // next cycle to avoid year-1 crowding.
  "2023-default": {
    house: 2024, // Nov 2024 general (118th Congress seated Jan 2023)
    senateClass1: 2024, // Class 1: 2018/2024
    senateClass2: 2026, // Class 2: 2020/2026
    senateClass3: 2028, // Class 3: 2016/2022/2028 (2022 pre-start)
    governorStateSenate: 2026, // next gubernatorial midterm
    president: 2024, // 2024 presidential
    ngGeneral: 2027, // Feb 2023 general is start-adjacent; next 2027
    ukCommons: 2024, // Jul 2024 GE (Starmer)
    jpSangiinClass1: 2025, // half up Jul 2025
    jpSangiinClass2: 2028, // Jul 2022 half → next Jul 2028
    jpShugiin: 2024, // Oct 2024 general (Ishiba dissolution)
    deBundestag: 2025, // Feb 2025 snap (Scholz coalition collapse)
    deLandtag: 2026, // preset-wide fallback anchor
    // 14th NPC convened March 2023; 15th NPC 2028.
    cnNpcDelegate: 2028,
    brChamber: 2026, // Oct 2026 general
    brSenate: 2026,
    ieDail: 2024, // Nov 2024 general
    ieUachtaran: 2025, // Higgins' term ends Nov 2025
    ieLocalCouncil: 2024, // Jun 2024 local elections
    // Next Holyrood / Senedd election May 2026.
    scoHolyrood: 2026,
    walSenedd: 2026,
    frAssembly: 2024, // Jun 2024 snap dissolution
    itCamera: 2027, // Sep 2022 → next 2027
    esCongreso: 2027, // Jul 2023 is start-adjacent; next 2027
    seRiksdag: 2026, // Sep 2026
    trMeclis: 2028, // May 2023 is start-adjacent; next 2028
    grVouli: 2027, // May/Jun 2023 is start-adjacent; next 2027
    atNationalrat: 2024, // Sept 2024 general
    fiEduskunta: 2027, // Apr 2023 is start-adjacent; next 2027
    frSenat: 2026, // Sept 2023 is start-adjacent; next real renewal Sept 2026 (series 1)
    trSenato: null, // abolished 1980 — no Cumhuriyet Senatosu in the modern era
    // USSR dissolved 1991 — RU stays era-gated off in modern presets.
    ruSupremeSoviet: null,
    ruRepublicSoviet: null,
    ddVolkskammer: null, // GDR reunified into DE in 1990 — no elections
  },
};

/**
 * Default ctx used for back-compat in tests and any caller that hasn't
 * been threaded yet. Matches the pre-refactor module-level constants in
 * `canonicalCycle.ts` (2019-default preset, `STARTING_YEAR` = 2019).
 */
export const DEFAULT_CYCLE_ANCHOR_CONTEXT: CycleAnchorContext = {
  startingYear: STARTING_YEAR,
  preset: "2019-default",
};

export interface CycleAnchors {
  house: number;
  senateClass1: number;
  senateClass2: number;
  senateClass3: number;
  governorStateSenate: number;
  president: number;
  ngGeneral: number;
  ukCommons: number;
  jpSangiinClass1: number;
  jpSangiinClass2: number;
  jpShugiin: number;
  deBundestag: number;
  deLandtag: number;
  cnNpcDelegate: number;
  brChamber: number;
  brSenate: number;
  ieDail: number;
  ieUachtaran: number;
  ieLocalCouncil: number;
  scoHolyrood: number;
  walSenedd: number;
  frAssembly: number;
  itCamera: number;
  /** `null` = no election cycle in this era (ES under Franco). */
  esCongreso: number | null;
  seRiksdag: number;
  trMeclis: number;
  grVouli: number;
  atNationalrat: number;
  fiEduskunta: number;
  frSenat: number;
  /** `null` = no TR Senate cycle in this era (abolished 1980; see PresetElectionYears). */
  trSenato: number | null;
  /** `null` = no RU election cycle in this era (2019/1991 — no USSR). */
  ruSupremeSoviet: number | null;
  ruRepublicSoviet: number | null;
  /** `null` = no DD election cycle in this era (2019/1991/2023 — no GDR). */
  ddVolkskammer: number | null;
}

/** End-of-LARP-year-Y anchor: `(Y − startingYear + 1) × TURNS_PER_YEAR (+ offset)`. */
function endOfYear(realYear: number, startingYear: number, offset = 0): number {
  return (realYear - startingYear + 1) * TURNS_PER_YEAR + offset;
}

/** Week-27 anchor: `(Y − startingYear) × TURNS_PER_YEAR + 27 (+ offset)` (UK GE / JP Sangiin). */
function week27(realYear: number, startingYear: number, offset = 0): number {
  return (realYear - startingYear) * TURNS_PER_YEAR + 27 + offset;
}

/**
 * Compute the cycle-1 endTurn for every election family under the given
 * preset + startingYear. Pure — no DB. When `ctx.preIterationTurns` is set (a
 * completed founding phase), every anchor is shifted forward by that raw-turn
 * offset so real-world election years keep mapping to the correct calendar
 * years after the pre-iteration date-pin lifts.
 */
export function getCycleAnchors(ctx: CycleAnchorContext): CycleAnchors {
  const years =
    CANONICAL_REAL_ELECTION_YEARS_BY_PRESET[ctx.preset] ??
    CANONICAL_REAL_ELECTION_YEARS_BY_PRESET["2019-default"];
  const sy = ctx.startingYear;
  const off = ctx.preIterationTurns ?? 0;
  return {
    house: endOfYear(years.house, sy, off),
    senateClass1: endOfYear(years.senateClass1, sy, off),
    senateClass2: endOfYear(years.senateClass2, sy, off),
    senateClass3: endOfYear(years.senateClass3, sy, off),
    governorStateSenate: endOfYear(years.governorStateSenate, sy, off),
    president: endOfYear(years.president, sy, off),
    ngGeneral: endOfYear(years.ngGeneral, sy, off),
    ukCommons: week27(years.ukCommons, sy, off),
    jpSangiinClass1: week27(years.jpSangiinClass1, sy, off),
    jpSangiinClass2: week27(years.jpSangiinClass2, sy, off),
    jpShugiin: endOfYear(years.jpShugiin, sy, off),
    deBundestag: endOfYear(years.deBundestag, sy, off),
    deLandtag: endOfYear(years.deLandtag, sy, off),
    cnNpcDelegate: endOfYear(years.cnNpcDelegate, sy, off),
    brChamber: endOfYear(years.brChamber, sy, off),
    brSenate: endOfYear(years.brSenate, sy, off),
    ieDail: endOfYear(years.ieDail, sy, off),
    ieUachtaran: endOfYear(years.ieUachtaran, sy, off),
    ieLocalCouncil: endOfYear(years.ieLocalCouncil, sy, off),
    scoHolyrood: endOfYear(years.scoHolyrood, sy, off),
    walSenedd: endOfYear(years.walSenedd, sy, off),
    frAssembly: endOfYear(years.frAssembly, sy, off),
    itCamera: endOfYear(years.itCamera, sy, off),
    esCongreso: years.esCongreso == null ? null : endOfYear(years.esCongreso, sy, off),
    seRiksdag: endOfYear(years.seRiksdag, sy, off),
    trMeclis: endOfYear(years.trMeclis, sy, off),
    grVouli: endOfYear(years.grVouli, sy, off),
    atNationalrat: endOfYear(years.atNationalrat, sy, off),
    fiEduskunta: endOfYear(years.fiEduskunta, sy, off),
    frSenat: endOfYear(years.frSenat, sy, off),
    trSenato: years.trSenato == null ? null : endOfYear(years.trSenato, sy, off),
    ruSupremeSoviet:
      years.ruSupremeSoviet == null ? null : endOfYear(years.ruSupremeSoviet, sy, off),
    ruRepublicSoviet:
      years.ruRepublicSoviet == null ? null : endOfYear(years.ruRepublicSoviet, sy, off),
    ddVolkskammer: years.ddVolkskammer == null ? null : endOfYear(years.ddVolkskammer, sy, off),
  };
}

/**
 * Extract the cycle-anchor context from a GameState document. Falls back
 * to the default ctx (2019-default) if either field is missing — covers
 * legacy rows that pre-date the `startingYear` / `preset` fields.
 */
export function cycleAnchorContextFromGameState(
  gameState:
    | Pick<GameState, "startingYear" | "preset" | "preIterationTurns" | "preIteration">
    | null
    | undefined
): CycleAnchorContext {
  if (!gameState) return DEFAULT_CYCLE_ANCHOR_CONTEXT;
  return {
    startingYear: gameState.startingYear ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.startingYear,
    preset: gameState.preset ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.preset,
    preIterationTurns: gameState.preIterationTurns,
    preIterationActive: gameState.preIteration?.active,
  };
}
