/**
 * Canonical LARP-cycle math for perpetual elections, shared between:
 *   • src/lib/turn/perpetualElections.ts     (cron-driven spawn paths)
 *   • src/app/api/admin/elections/recalibrate-timers/route.ts
 *                                            (admin recalibrate flow)
 *   • scripts/migrations/*                   (one-shot heals)
 *
 * Each supported election type has a canonical end-turn schedule anchored to
 * real-world election years (see the bootstrap values in sync-date). Post-
 * admin-acceleration the canonical anchor is preserved — the spawner walks
 * forward to the next LARP cycle whose remaining primary & general windows
 * each still clear a configurable floor (default 24h + 24h).
 *
 * Snap elections shift the LARP clock: commons / regionalCouncil / shugiin
 * accept a `priorEndTurn` override that replaces the bootstrap anchor.
 */

import {
  UK_COMMONS_CYCLE_PERIOD_HOURS,
  JP_SANGIIN_CYCLE_PERIOD_HOURS,
} from "@/lib/constants/turnTime";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import {
  COUNTRIES_WITH_CONCURRENT_GENERAL_ELECTIONS,
  type CountryId,
} from "@/lib/constants/countries";
import {
  DEFAULT_CYCLE_ANCHOR_CONTEXT,
  getCycleAnchors,
  type CycleAnchorContext,
} from "./cycleAnchorContext";

const DE_BUNDESTAG_CYCLE_PERIOD_HOURS = 192; // 4 game-years
const LANDTAG_CYCLE_PERIOD_HOURS = 240; // 5 game-years (48 turns/year × 5)
/** CN NPC Delegate cycle: 5-year terms, matching real-world NPC cadence. */
const CN_NPC_DELEGATE_CYCLE_PERIOD_HOURS = 240; // 5 game-years (48 turns/year × 5)
/** BR Câmara dos Deputados cycle: 4-year terms. */
const BR_CHAMBER_CYCLE_PERIOD_HOURS = 192;
/**
 * BR Federal Senate cycle: elections are held every 4 years (192 turns), same
 * cadence as the Câmara. SIMPLIFICATION: the real Senate is staggered —
 * senators serve 8-year terms and renewal alternates 1/3 then 2/3 of the
 * chamber every 4 years (`upperElectionSystem.staggeredClasses: 2` in
 * countries.ts already declares this). Modeling that accurately needs
 * per-seat class data (which of a state's 3 senators is "up" this cycle),
 * and that data lives at the seed layer (out of scope for this pass — seeds
 * are owned by a different workstream). This models a full-chamber
 * re-election every 4 years instead, riding the `brSenate` anchor — the same
 * simplification already applied to the FR Sénat / TR Senato / IT Senato
 * rows above. Flagged as a residual: a follow-up should backfill a
 * `senateClass` (1 of 2) onto each seat/seed and swap this for a proper
 * staggered model mirroring the US Senate's 3-class mechanism.
 */
const BR_SENATE_CYCLE_PERIOD_HOURS = 192;
/** IE Dáil cycle: 5-year maximum, generally ~4 years. Modeled as 4 (192). */
const IE_DAIL_CYCLE_PERIOD_HOURS = 192;
/** IE Uachtarán cycle: 7-year direct nationwide election (constitutional term). */
const IE_UACHTARAN_CYCLE_PERIOD_HOURS = 336;
/** IE Local Council cycle: 5-year synchronized with EP elections. */
const IE_LOCAL_COUNCIL_CYCLE_PERIOD_HOURS = 240;
/** SCO Holyrood / WAL Senedd cycle: 5-year AMS term (48 turns/year × 5). */
const DEVOLVED_CHAMBER_CYCLE_PERIOD_HOURS = 240;
/**
 * TR Senate of the Republic (Cumhuriyet Senatosu) cycle: 6-year term (288
 * turns), matching `upperElectionSystem.termYears: 6`. SIMPLIFICATION: the
 * real chamber (1961-1980) renewed one-third every 2 years; this models a
 * full-chamber re-election every 6 years instead (#3791).
 */
const TR_SENATE_CYCLE_PERIOD_HOURS = 288;
/** IT Senato della Repubblica cycle: 5-year term, same cadence as itCamera. */
const IT_SENATO_CYCLE_PERIOD_HOURS = 240;

/**
 * Beta-country (NPP-only) parliamentary lower chambers — FR/IT/ES/SE/TR
 * (issue #3239). One table instead of five switch cases: each electionType
 * maps to its preset anchor field + fixed cycle period. A `null` anchor
 * era-gates the cycle OFF for that preset (ES 1953: Franco dictatorship —
 * no elections spawn, the country stays static by design).
 */
const BETA_PARLIAMENT_CYCLES: Record<
  string,
  {
    anchor:
      | "frAssembly"
      | "itCamera"
      | "esCongreso"
      | "seRiksdag"
      | "trMeclis"
      | "grVouli"
      | "atNationalrat"
      | "fiEduskunta"
      | "frSenat"
      | "ruSupremeSoviet"
      | "ruRepublicSoviet"
      | "ddVolkskammer";
    periodHours: number;
  }
> = {
  // FR Assemblée nationale: 5-year cycle (240 turns).
  assembleeNationale: { anchor: "frAssembly", periodHours: 240 },
  // IT Camera dei Deputati: 5-year cycle (240 turns).
  cameraDeputati: { anchor: "itCamera", periodHours: 240 },
  // ES Congreso de los Diputados: 4-year cycle (192 turns); era-gated.
  congresoDiputados: { anchor: "esCongreso", periodHours: 192 },
  // SE Riksdag: 4-year cycle (192 turns; real cadence 3y 1970-1994, modeled as 4).
  riksdag: { anchor: "seRiksdag", periodHours: 192 },
  // TR Grand National Assembly: 4-year cycle (192 turns).
  milletMeclisi: { anchor: "trMeclis", periodHours: 192 },
  // GR Vouli ton Ellinon: 4-year cycle (192 turns) (#3791).
  vouli: { anchor: "grVouli", periodHours: 192 },
  // AT Nationalrat: 4-year cycle (192 turns) (#3791).
  nationalrat: { anchor: "atNationalrat", periodHours: 192 },
  // FI Eduskunta: 4-year cycle (192 turns) (#3791).
  eduskunta: { anchor: "fiEduskunta", periodHours: 192 },
  // FR Sénat: 9-year full-chamber cycle (432 turns) — SIMPLIFICATION: the real
  // Sénat renews by series every 3 years, not the whole chamber every 9; see
  // `frSenat` in cycleAnchorContext.ts for the full explanation (#3791).
  senat: { anchor: "frSenat", periodHours: 432 },
  // ES Senado: rides the SAME anchor as congresoDiputados — Spain's Congress
  // and Senate have always been elected concurrently (one general election
  // day), so this is accurate, not a simplification. Era-gated OFF (null)
  // exactly when congresoDiputados is (1953 Franco) (#3791).
  senado: { anchor: "esCongreso", periodHours: 192 },
  // NOTE: IT "senato" and TR "senato" share this literal electionType string
  // (a pre-existing countries.ts naming collision — TR's upper chamber key
  // really should be distinct, e.g. "cumhuriyetSenatosu") and need DIFFERENT
  // anchors/periods, so "senato" is handled by its own countryId-aware switch
  // case below instead of a single table row (#3791).
  // RU Supreme Soviet — BOTH chambers ride one anchor (elected the same day);
  // 4-year cycle (192 turns; the 1936-constitution cadence — D3: this row,
  // not config termYears, drives the 1954 → 1958 → 1962 schedule). Null
  // anchor era-gates RU OFF outside the Cold-War presets.
  supremeSovietDeputy: { anchor: "ruSupremeSoviet", periodHours: 192 },
  nationalitiesDeputy: { anchor: "ruSupremeSoviet", periodHours: 192 },
  // RU republic Supreme Soviets — 4-year cycle, own anchor (1955 / 1980).
  republicSupremeSoviet: { anchor: "ruRepublicSoviet", periodHours: 192 },
  // DD Volkskammer — single-list National Front. 4-year cycle (192 turns), the
  // GDR's early-era cadence (1950 → 1954 → 1958); matches the RU sibling's period
  // and — per the D3 note above — this row, not config termYears, drives the
  // schedule. Null anchor era-gates DD OFF outside the divided-Germany presets.
  volkskammerDeputy: { anchor: "ddVolkskammer", periodHours: 192 },
  // DD Land assemblies — ride the Volkskammer cycle (Land First Secretaries
  // already do; historically Bezirks-/Landtage tracked the chamber). Key is
  // distinct from DE `landtag` so Sainte-Laguë never claims these races.
  landAssembly: { anchor: "ddVolkskammer", periodHours: 192 },
  // Eastern bloc Tier-1 unicameral assemblies — ride the DD Volkskammer LARP
  // anchor (Cold-War 4/5-year cadence) until dedicated eastern-bloc anchors
  // land. Era-gated OFF outside 1953/1979 via null ddVolkskammer.
  sejm: { anchor: "ddVolkskammer", periodHours: 192 },
  chamberOfThePeople: { anchor: "ddVolkskammer", periodHours: 240 },
  nationalAssembly: { anchor: "ddVolkskammer", periodHours: 240 },
  grandNationalAssembly: { anchor: "ddVolkskammer", periodHours: 240 },
  federalAssembly: { anchor: "ddVolkskammer", periodHours: 192 },
  // Union-republic Supreme Soviets (UKR/BLR/BAL). These ride `ruRepublicSoviet`
  // rather than the satellites' `ddVolkskammer` anchor, and that is a fact about
  // the world, not a shortcut: republic Supreme Soviets were elected on the
  // all-Union republic cycle, one year offset from the USSR Supreme Soviet -
  // 1947, 1951, 1955, 1959 - so the next election after a 1953 start is 1955 and
  // after a 1979 start is 1980, which is exactly what that anchor already
  // encodes for RU's own republics. 4-year cycle (192 turns). Null anchor
  // era-gates all three OFF outside the Cold-War presets.
  supremeSoviet: { anchor: "ruRepublicSoviet", periodHours: 192 },
};

/**
 * Senate class cycle-1 anchors for the default (2019-default) preset.
 * Preserved as an export for back-compat with admin tooling and tests.
 * Runtime code that needs preset-aware anchors should call
 * `getCycleAnchors(ctx)` from `./cycleAnchorContext` directly.
 */
const defaultAnchors = getCycleAnchors(DEFAULT_CYCLE_ANCHOR_CONTEXT);
export const SENATE_CYCLE1_END_TURN: Record<1 | 2 | 3, number> = {
  1: defaultAnchors.senateClass1,
  2: defaultAnchors.senateClass2,
  3: defaultAnchors.senateClass3,
};

/**
 * Founding (cycle-0) campaign window, shared by EVERY race during a
 * pre-iteration reset: a 24-turn primary + 24-turn general (1 turn = 1 hour),
 * so the whole founding phase resolves in ~48 turns regardless of each body's
 * real multi-year term. Kept small on purpose — the founding is a synchronized
 * standing-up of the world, not a full-length campaign.
 */
export const FOUNDING_PRIMARY_HOURS = 24;
export const FOUNDING_GENERAL_HOURS = 24;

export interface CanonicalCycleParams {
  electionType: string;
  /** 1-indexed cycle number. */
  cycle: number;
  /** US Senate class. */
  senateClass?: 1 | 2 | 3 | null;
  /** JP Sangiin class. */
  chamberClass?: 1 | 2 | null;
  /**
   * Turn at which a prior snap or regular election of this race resolved.
   * Used by commons / regionalCouncil / shugiin to shift the LARP anchor
   * forward after a snap election. Ignored by other types.
   */
  priorEndTurn?: number | null;
  /**
   * Override for cycle-1 end turn — used by per-state staggered elections
   * (e.g. DE Landtag, where each Bundesland has its own real-world election
   * year). When set, replaces the default cycle1End anchor for the
   * corresponding electionType case. Ignored by types that don't consume it.
   */
  customCycle1EndTurn?: number;
  /**
   * Per-game cycle-anchor context (preset + starting year). When omitted,
   * defaults to the 2019-default preset for backward compatibility with
   * tests and any caller that hasn't been threaded yet. Runtime callers
   * (cron spawners, recalibrate route) should build this from `GameState`
   * via `cycleAnchorContextFromGameState`.
   */
  ctx?: CycleAnchorContext;
  /**
   * Owning country. Enables the concurrent-general timing branch for countries
   * in `COUNTRIES_WITH_CONCURRENT_GENERAL_ELECTIONS` (NG). Omitted → every other
   * country keeps its existing per-type schedule.
   */
  countryId?: CountryId;
}

export interface CanonicalCycleTurns {
  startTurn: number;
  primaryEndTurn: number;
  endTurn: number;
}

/**
 * Compute canonical LARP turns for a given election type + cycle. Returns
 * null for election types without a canonical schedule (snap_*, unknown).
 */
export function canonicalTurnsForCycle(params: CanonicalCycleParams): CanonicalCycleTurns | null {
  const {
    electionType,
    cycle,
    senateClass,
    chamberClass,
    priorEndTurn,
    customCycle1EndTurn,
    countryId,
    ctx = DEFAULT_CYCLE_ANCHOR_CONTEXT,
  } = params;
  const dur = DEFAULT_DURATIONS[electionType];
  if (!dur) return null;
  const anchors = getCycleAnchors(ctx);

  // Concurrent-general countries (NG): President + NASS + Governors share ONE
  // 4-year (192-turn) cycle anchored to `ngGeneral`, dropping the US senate-class
  // stagger and governor mid-term offset so all four resolve in the same window.
  const CONCURRENT_GENERAL_TYPES = new Set([
    "president",
    "house",
    "senate",
    "governor",
    "stateSenate",
    "regionalCouncil",
  ]);
  if (
    countryId != null &&
    COUNTRIES_WITH_CONCURRENT_GENERAL_ELECTIONS.has(countryId) &&
    CONCURRENT_GENERAL_TYPES.has(electionType)
  ) {
    const CONCURRENT_GENERAL_CYCLE_TURNS = 192;
    const endTurn =
      cycle === 1
        ? anchors.ngGeneral
        : anchors.ngGeneral + (cycle - 1) * CONCURRENT_GENERAL_CYCLE_TURNS;
    return {
      endTurn,
      primaryEndTurn: endTurn - dur.generalDurationHours,
      startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
    };
  }

  // Anchor+period table families (FR/IT/ES/SE/TR beta parliaments + the RU
  // delegate chambers): shared math, snap shift via `priorEndTurn` like
  // commons/shugiin.
  const betaParl = BETA_PARLIAMENT_CYCLES[electionType];
  if (betaParl) {
    const anchor = anchors[betaParl.anchor];
    if (anchor == null) return null; // era-gated OFF (ES 1953; RU outside Cold-War presets)
    const endTurn =
      priorEndTurn != null
        ? priorEndTurn + betaParl.periodHours
        : cycle === 1
          ? anchor
          : anchor + (cycle - 1) * betaParl.periodHours;
    return {
      endTurn,
      primaryEndTurn: endTurn - dur.generalDurationHours,
      startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
    };
  }

  switch (electionType) {
    case "house": {
      const endTurn = cycle === 1 ? anchors.house : anchors.house + (cycle - 1) * dur.durationHours;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "governor":
    case "stateSenate": {
      // D10: RU First Secretaries ride the republic-soviet cycle, and DD Land
      // First Secretaries ride the Volkskammer cycle (Bezirk/Land elections
      // were held with the chamber's) — anchor overrides only (the 192-turn
      // period already comes from dur.durationHours). Null anchors era-gate
      // both OFF outside the Cold-War presets. Every other country keeps the
      // shared governorStateSenate anchor.
      // UKR/BLR/BAL oblast/republic first secretaries ride the republic-soviet
      // cycle for the same reason RU's do: the regional soviets were elected on
      // the republic cycle, not on a separate schedule of their own.
      const govAnchor =
        countryId === "RU" || countryId === "UKR" || countryId === "BLR" || countryId === "BAL"
          ? anchors.ruRepublicSoviet
          : countryId === "DD"
            ? anchors.ddVolkskammer
            : anchors.governorStateSenate;
      if (govAnchor == null) return null;
      const endTurn = cycle === 1 ? govAnchor : govAnchor + (cycle - 1) * dur.durationHours;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "senate": {
      // BR Federal Senate shares the literal "senate" officeType/electionType
      // string with the US Senate (a countries.ts config collision, same
      // class of issue as the IT/TR "senato" one below) but needs a
      // completely different anchor/period, so it gets its own countryId-aware
      // branch instead of the `senateClass`-keyed US math. See
      // BR_SENATE_CYCLE_PERIOD_HOURS for the staggering simplification note.
      if (countryId === "BR") {
        const endTurn =
          cycle === 1
            ? anchors.brSenate
            : anchors.brSenate + (cycle - 1) * BR_SENATE_CYCLE_PERIOD_HOURS;
        return {
          endTurn,
          primaryEndTurn: endTurn - dur.generalDurationHours,
          startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
        };
      }
      const klass = senateClass ?? 2;
      const cycle1End =
        klass === 1
          ? anchors.senateClass1
          : klass === 2
            ? anchors.senateClass2
            : anchors.senateClass3;
      const endTurn = cycle === 1 ? cycle1End : cycle1End + (cycle - 1) * dur.durationHours;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "president": {
      // Presidential cycle = 192 turns (4 game-years), not dur.durationHours
      // (which is also 192 but this keeps the semantic explicit if anyone
      // retunes president durations).
      const PRESIDENT_CYCLE_TURNS = 192;
      const endTurn =
        cycle === 1 ? anchors.president : anchors.president + (cycle - 1) * PRESIDENT_CYCLE_TURNS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "commons":
    case "regionalCouncil": {
      // UK Commons / Regional Council: 5-year cycle (240 turns). Cycle 1
      // anchored to UK GE year (July, week 27). A snap shifts the anchor:
      // `priorEndTurn + 240` replaces the bootstrap formula.
      const endTurn =
        priorEndTurn != null
          ? priorEndTurn + UK_COMMONS_CYCLE_PERIOD_HOURS
          : cycle === 1
            ? anchors.ukCommons
            : anchors.ukCommons + (cycle - 1) * UK_COMMONS_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "holyrood":
    case "senedd": {
      // SCO Holyrood / WAL Senedd: 5-year AMS cycle (240 turns), stood up at
      // secession. Anchored to the nearest canonical devolved-election year; the
      // spawner walks forward to the next cycle after the secession turn. A snap
      // shifts the anchor like commons (`priorEndTurn + 240`).
      const anchor = electionType === "holyrood" ? anchors.scoHolyrood : anchors.walSenedd;
      const endTurn =
        priorEndTurn != null
          ? priorEndTurn + DEVOLVED_CHAMBER_CYCLE_PERIOD_HOURS
          : cycle === 1
            ? anchor
            : anchor + (cycle - 1) * DEVOLVED_CHAMBER_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        // Devolved chambers only exist post-secession (no game-start bootstrap),
        // so cycle 1 uses a normal fixed-length window ending at the anchor — NOT
        // the turn-1 bootstrap, which would make the standup election span the
        // whole game and read as a stale "active" race instead of an upcoming one.
        startTurn: endTurn - dur.durationHours,
      };
    }
    case "shugiin": {
      // JP Shugiin: 4-year cycle (192 turns). Snap shifts: `priorEndTurn + 192`.
      const endTurn =
        priorEndTurn != null
          ? priorEndTurn + dur.durationHours
          : cycle === 1
            ? anchors.jpShugiin
            : anchors.jpShugiin + (cycle - 1) * dur.durationHours;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "sangiin": {
      // JP Sangiin: 6-year term per class (288 turns). Half-elections every
      // 3 years — class stagger of 144 turns is NOT the cycle period.
      const klass = chamberClass ?? 1;
      const cycle1End = klass === 1 ? anchors.jpSangiinClass1 : anchors.jpSangiinClass2;
      const endTurn =
        cycle === 1 ? cycle1End : cycle1End + (cycle - 1) * JP_SANGIIN_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "bundestag": {
      // DE Bundestag: 4-year cycle (192 turns). Snap shifts: `priorEndTurn + 192`.
      const endTurn =
        priorEndTurn != null
          ? priorEndTurn + DE_BUNDESTAG_CYCLE_PERIOD_HOURS
          : cycle === 1
            ? anchors.deBundestag
            : anchors.deBundestag + (cycle - 1) * DE_BUNDESTAG_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "landtag": {
      // DE Landtag: 5-year cycle (240 turns), staggered per Land via customCycle1EndTurn.
      // Caller supplies the per-Land cycle1 anchor from
      // `getLandtagCycle1EndTurn(landId, ctx.preset)`. The fallback is the
      // preset's deLandtag anchor (turn-converted), not a hardcoded 240.
      const cycle1End = customCycle1EndTurn ?? anchors.deLandtag;
      const endTurn =
        priorEndTurn != null
          ? priorEndTurn + LANDTAG_CYCLE_PERIOD_HOURS
          : cycle === 1
            ? cycle1End
            : cycle1End + (cycle - 1) * LANDTAG_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "npcDelegate":
    case "peoplesCongress": {
      // CN NPC Delegate + Provincial People's Congress: shared 5-year
      // cycle (240 turns), anchored to the preset's CN cycle-1 end-turn
      // so national and provincial elections fire on the same turn
      // (matches real-world March quinquennial cadence). 14th NPC →
      // 2023 for 2019-default; 8th NPC → 1993 for 1991-default.
      const endTurn =
        cycle === 1
          ? anchors.cnNpcDelegate
          : anchors.cnNpcDelegate + (cycle - 1) * CN_NPC_DELEGATE_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "chamber": {
      // BR Câmara dos Deputados: 4-year cycle (192 turns).
      const endTurn =
        priorEndTurn != null
          ? priorEndTurn + BR_CHAMBER_CYCLE_PERIOD_HOURS
          : cycle === 1
            ? anchors.brChamber
            : anchors.brChamber + (cycle - 1) * BR_CHAMBER_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "dail": {
      // IE Dáil Éireann: variable 4-5 year cycle. Modeled as 4 (192).
      const endTurn =
        priorEndTurn != null
          ? priorEndTurn + IE_DAIL_CYCLE_PERIOD_HOURS
          : cycle === 1
            ? anchors.ieDail
            : anchors.ieDail + (cycle - 1) * IE_DAIL_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "uachtaran": {
      // IE Uachtarán na hÉireann: 7-year direct nationwide cycle.
      const endTurn =
        cycle === 1
          ? anchors.ieUachtaran
          : anchors.ieUachtaran + (cycle - 1) * IE_UACHTARAN_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "localCouncil": {
      // IE local councils: 5-year synchronized cycle. All 8 regions vote
      // together (real Irish local elections held alongside European
      // Parliament elections every 5 years — 2019, 2024, 2029, …).
      const endTurn =
        cycle === 1
          ? anchors.ieLocalCouncil
          : anchors.ieLocalCouncil + (cycle - 1) * IE_LOCAL_COUNCIL_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "senato": {
      // IT Senato and TR Senato share this literal electionType string (a
      // pre-existing countries.ts config debt — TR's upper chamber `key`
      // really should be a distinct value like "cumhuriyetSenatosu"; not
      // renamed here to stay scoped to the election-vacancy fix, #3791). They
      // need different anchors/periods, so this case branches on `countryId`
      // instead of going through the single-anchor BETA_PARLIAMENT_CYCLES
      // table used by every other type here.
      if (countryId === "TR") {
        // Cumhuriyet Senatosu (1961-1980): see TR_SENATE_CYCLE_PERIOD_HOURS
        // and `trSenato` in cycleAnchorContext.ts for the simplification
        // note (full-chamber renewal, no partial/class renewal modeled).
        // `null` anchor era-gates the cycle OFF (every preset except 1953).
        const anchor = anchors.trSenato;
        if (anchor == null) return null;
        const endTurn = cycle === 1 ? anchor : anchor + (cycle - 1) * TR_SENATE_CYCLE_PERIOD_HOURS;
        return {
          endTurn,
          primaryEndTurn: endTurn - dur.generalDurationHours,
          startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
        };
      }
      // IT: Senato della Repubblica and Camera dei Deputati have been elected
      // on the same day for the entire life of the Republic (both dissolve
      // together) — ride the itCamera anchor. This is historically accurate,
      // not a simplification.
      const endTurn =
        cycle === 1
          ? anchors.itCamera
          : anchors.itCamera + (cycle - 1) * IT_SENATO_CYCLE_PERIOD_HOURS;
      return {
        endTurn,
        primaryEndTurn: endTurn - dur.generalDurationHours,
        startTurn: cycle === 1 ? 1 : endTurn - dur.durationHours,
      };
    }
    case "snap_shugiin":
    case "snap_commons":
    case "snap_bundestag":
    case "snap_lowerChamber":
      // Snap elections have fixed short durations; no canonical LARP anchor.
      return null;
    default:
      return null;
  }
}

export interface PickNextCanonicalCycleParams extends Omit<CanonicalCycleParams, "cycle"> {
  /** Previous cycle for this race (0 if none completed yet). */
  prevCycle: number;
  currentTurn: number;
  /** Floor on remaining primary hours at currentTurn. Default 24. */
  minPrimaryHours?: number;
  /** Floor on remaining general hours at currentTurn. Default 24. */
  minGeneralHours?: number;
  /** Safety bound on forward walk when gate fails. Default 20. */
  maxSkip?: number;
}

export interface PickedCanonicalCycle extends CanonicalCycleTurns {
  cycle: number;
}

/**
 * Walk forward from `prevCycle + 1` on the canonical LARP schedule and return
 * the first cycle whose remaining primary AND general windows at `currentTurn`
 * meet the configured minima. Returns null if no cycle within `maxSkip`
 * iterations satisfies the gate (indicates a misconfiguration; caller should
 * log and skip rather than spawn a stub).
 *
 * Remaining-window math:
 *   effectivePrimaryStart = max(canonicalStartTurn, currentTurn)
 *   primaryHoursLeft      = primaryEndTurn − effectivePrimaryStart
 *   generalHoursLeft      = endTurn        − max(primaryEndTurn, currentTurn)
 *
 * Both values are allowed to be negative (cycle is in the past) or zero — the
 * gate accepts only when both ≥ their respective minima.
 */
export function pickNextCanonicalCycle(
  params: PickNextCanonicalCycleParams
): PickedCanonicalCycle | null {
  const {
    prevCycle,
    currentTurn,
    minPrimaryHours = 24,
    minGeneralHours = 24,
    maxSkip = 20,
  } = params;

  // Pre-iteration "founding" cycle: while the founding phase is active, every
  // in-scope race runs a one-off short campaign (cycle 0) starting NOW,
  // ignoring the historical anchor, so all staggered classes seat together and
  // the whole world enters the real game with a fresh synchronized mandate.
  // A FIXED 24h primary + 24h general is used for EVERY race (not each body's
  // multi-year canonical term) so the whole founding phase resolves in ~48
  // turns instead of dragging on until the US Senate's 288-turn term ends.
  // Respect era-gates: if the type has no canonical schedule this era (probe
  // returns null — e.g. ES 1953 Franco, or snap_* types), don't found it.
  if (params.ctx?.preIterationActive) {
    const probe = canonicalTurnsForCycle({ ...params, cycle: 1 });
    if (!probe) return null;
    const startTurn = currentTurn;
    const primaryEndTurn = currentTurn + FOUNDING_PRIMARY_HOURS;
    const endTurn = primaryEndTurn + FOUNDING_GENERAL_HOURS;
    return { cycle: 0, startTurn, primaryEndTurn, endTurn };
  }

  for (let i = 0; i < maxSkip; i++) {
    const cycle = prevCycle + 1 + i;
    const turns = canonicalTurnsForCycle({ ...params, cycle });
    if (!turns) return null;

    const { startTurn, primaryEndTurn, endTurn } = turns;
    const effectivePrimaryStart = Math.max(startTurn, currentTurn);
    const primaryHoursLeft = primaryEndTurn - effectivePrimaryStart;
    const generalHoursLeft = endTurn - Math.max(primaryEndTurn, currentTurn);

    if (primaryHoursLeft >= minPrimaryHours && generalHoursLeft >= minGeneralHours) {
      return { cycle, startTurn, primaryEndTurn, endTurn };
    }
  }
  return null;
}

/**
 * Convert a LARP turn number into a wall-clock Date, anchored on the
 * `currentTurn`'s reference timestamp (`ref`). 1 turn = 1 real hour.
 */
export function turnToWallClock(turn: number, ref: Date, currentTurn: number): Date {
  const MS_PER_TURN = 3_600_000;
  return new Date(ref.getTime() + (turn - currentTurn) * MS_PER_TURN);
}
