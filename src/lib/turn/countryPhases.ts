/**
 * src/lib/turn/countryPhases.ts
 *
 * Country-specific turn phase registry.
 *
 * Isolates per-country phase hooks from the main turn orchestrator so that
 * adding a new country means adding an entry here — not editing turnSystem.ts.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  getCountryConfig,
  hasConfidenceVoteMechanism,
  COUNTRY_CONFIGS,
  COUNTRY_ORDER,
} from "@/lib/constants/countries";
import type { Election } from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import {
  runBillLifecycleForCountry,
  runBillLifecycleForConfiguredCountry,
  runBillLifecycleForJP,
} from "@/lib/turn/billLifecycle/dispatch";
import { UK_NATIONAL_CONFIG } from "@/lib/turn/billLifecycle/configs/uk";
import { IE_NATIONAL_CONFIG } from "@/lib/turn/billLifecycle/configs/ie";
import { DE_NATIONAL_CONFIG } from "@/lib/turn/billLifecycle/configs/de";
import {
  processCNBillLifecycle,
  processRUBillLifecycle,
  processDDBillLifecycle,
  processPLBillLifecycle,
  processCSBillLifecycle,
  processHUBillLifecycle,
  processROBillLifecycle,
  processBGBillLifecycle,
  processYUBillLifecycle,
  processUKRBillLifecycle,
  processBLRBillLifecycle,
  processBALBillLifecycle,
} from "@/lib/turn/onePartyBillLifecycle";
import {
  ensureUKElections,
  ensureUKRegionalCouncilElections,
  ensureUKGovernorElections,
  ensureJPElections,
  ensureJPRegionalCouncilElections,
  ensureJPCouncillorElections,
  ensureJPGovernorElections,
  ensureIEElections,
  ensureIEUachtaranElections,
  ensureIELocalCouncilElections,
  ensureIECathaoirleachElections,
  ensureDEElections,
  ensureDELandtagElections,
  ensureDEMinisterPresidentElections,
  ensureCNElections,
  ensureCNPeoplesCongressElections,
  ensureCNGovernorElections,
  ensureBRElections,
  ensureBRSenateElections,
  ensureRUSupremeSovietElections,
  ensureRUNationalitiesElections,
  ensureRURepublicSovietElections,
  ensureRUGovernorElections,
  ensureDDVolkskammerElections,
  ensureDDLandAssemblyElections,
  ensureDDGovernorElections,
  ensureNGElections,
  ensureNGSenateElections,
  ensureNGGovernorElections,
  ensureNGRegionalCouncilElections,
  ensureNGPresidentialElection,
  ensureSCOElections,
  ensureWALElections,
  ensureFRElections,
  ensureFRSenateElections,
  ensureITElections,
  ensureITSenateElections,
  ensureESElections,
  ensureESSenateElections,
  ensureSEElections,
  ensureTRElections,
  ensureGRElections,
  ensureATElections,
  ensureFIElections,
  ensureTRSenateElections,
  ensurePLElections,
  ensureCSElections,
  ensureHUElections,
  ensureROElections,
  ensureBGElections,
  ensureYUElections,
  ensureUKRElections,
  ensureBLRElections,
  ensureBALElections,
  ensureSCOGovernorElections,
  ensureWALGovernorElections,
  ensureSCORegionalCouncilElections,
  ensureWALRegionalCouncilElections,
} from "@/lib/turn/perpetualElections";
import {
  getParliamentaryCountryIds,
  updateParliamentaryGovernmentSeats,
  processParliamentaryGovernmentVotes,
  processParliamentaryNPPAutoAye,
  failInProgressBills,
  cancelActiveNoConfidenceVotes,
  openConfidenceMotionForIncumbent,
  updateSeatCountsOnly,
  syncRulingPartyIdFromFormedGovernment,
} from "@/lib/turn/parliamentaryGovernment";
import { processPMVacancyDeadlines } from "@/lib/turn/pmVacancyDeadline";
import { appointNppPrimeMinister } from "@/lib/nppAutonomy/appointNppPrimeMinister";

// Per-country seat update overrides (UK has a legacy seed fallback on first run)
import { updateGovernmentSeats as updateUKGovernmentSeats } from "@/lib/turn/ukGovernmentFormation";
import { getDb } from "@/lib/mongodb";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

/** Countries that need a custom updateGovernmentSeats wrapper (e.g. for legacy seed). */
const SEAT_UPDATE_OVERRIDES: Partial<Record<CountryId, () => Promise<void>>> = {
  UK: updateUKGovernmentSeats,
};

// ─── Bill lifecycle registry ──────────────────────────────────────────────────

export interface CountryBillPhaseEntry {
  phaseName:
    | "ukBillLifecycle"
    | "jpBillLifecycle"
    | "ieBillLifecycle"
    | "deBillLifecycle"
    | "cnBillLifecycle"
    | "ruBillLifecycle"
    | "ddBillLifecycle"
    | "plBillLifecycle"
    | "csBillLifecycle"
    | "huBillLifecycle"
    | "roBillLifecycle"
    | "bgBillLifecycle"
    | "yuBillLifecycle"
    | "ukrBillLifecycle"
    | "blrBillLifecycle"
    | "balBillLifecycle"
    | "frBillLifecycle"
    | "itBillLifecycle"
    | "esBillLifecycle"
    | "seBillLifecycle"
    | "trBillLifecycle"
    | "atBillLifecycle"
    | "fiBillLifecycle"
    | "grBillLifecycle"
    | "brBillLifecycle"
    | "ngBillLifecycle";
  fn: (deadlineNow: Date) => Promise<unknown>;
  emptyResult: Record<string, number | boolean>;
}

export const COUNTRY_BILL_PHASES: Partial<Record<CountryId, CountryBillPhaseEntry>> = {
  UK: {
    phaseName: "ukBillLifecycle",
    fn: (now) => runBillLifecycleForCountry(UK_NATIONAL_CONFIG, now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  DE: {
    phaseName: "deBillLifecycle",
    fn: (now) => runBillLifecycleForCountry(DE_NATIONAL_CONFIG, now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  JP: {
    phaseName: "jpBillLifecycle",
    fn: runBillLifecycleForJP,
    emptyResult: { enacted: 0, failed: 0, overrides: 0, cabinetPassed: 0 },
  },
  IE: {
    phaseName: "ieBillLifecycle",
    fn: (now) => runBillLifecycleForCountry(IE_NATIONAL_CONFIG, now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  CN: {
    phaseName: "cnBillLifecycle",
    fn: processCNBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  // RU: the one-party lifecycle with the D8/D9 crossover branch (bicameral,
  // contested upper chamber — a bill must clear both Supreme Soviet chambers).
  RU: {
    phaseName: "ruBillLifecycle",
    fn: processRUBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  // DD: the GDR Volkskammer — unicameral one-party lifecycle (CN pattern, no
  // upper-chamber crossover). Without this entry DD-proposed bills never
  // enact/fail and the one-party legitimacy/confidence/escalation drift never
  // ticks for DD (mirrors CN/RU, which each have their own entry).
  DD: {
    phaseName: "ddBillLifecycle",
    fn: processDDBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  // Eastern bloc Tier-1 — unicameral one-party lifecycle (DD/CN pattern).
  PL: {
    phaseName: "plBillLifecycle",
    fn: processPLBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  CS: {
    phaseName: "csBillLifecycle",
    fn: processCSBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  HU: {
    phaseName: "huBillLifecycle",
    fn: processHUBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  RO: {
    phaseName: "roBillLifecycle",
    fn: processROBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  BG: {
    phaseName: "bgBillLifecycle",
    fn: processBGBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  YU: {
    phaseName: "yuBillLifecycle",
    fn: processYUBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  // Union republics — same unicameral one-party lifecycle as the satellites.
  UKR: {
    phaseName: "ukrBillLifecycle",
    fn: processUKRBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  BLR: {
    phaseName: "blrBillLifecycle",
    fn: processBLRBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  BAL: {
    phaseName: "balBillLifecycle",
    fn: processBALBillLifecycle,
    emptyResult: { enacted: 0, failed: 0 },
  },
  FR: {
    phaseName: "frBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("FR", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  IT: {
    phaseName: "itBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("IT", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  ES: {
    phaseName: "esBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("ES", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  SE: {
    phaseName: "seBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("SE", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  TR: {
    phaseName: "trBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("TR", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  AT: {
    phaseName: "atBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("AT", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  FI: {
    phaseName: "fiBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("FI", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  GR: {
    phaseName: "grBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("GR", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  BR: {
    phaseName: "brBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("BR", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
  NG: {
    phaseName: "ngBillLifecycle",
    fn: (now) => runBillLifecycleForConfiguredCountry("NG", now),
    emptyResult: { enacted: 0, failed: 0 },
  },
};

// ─── Election coverage registry ───────────────────────────────────────────────

export interface CountryElectionPhaseEntry {
  name: string;
  fn: (gameNow: Date) => Promise<unknown>;
}

export const COUNTRY_ELECTION_PHASES: Partial<Record<CountryId, CountryElectionPhaseEntry[]>> = {
  UK: [
    { name: "ukElections", fn: ensureUKElections },
    { name: "ukRegionalCouncilElections", fn: ensureUKRegionalCouncilElections },
    { name: "ukGovernorElections", fn: ensureUKGovernorElections },
  ],
  JP: [
    { name: "jpElections", fn: ensureJPElections },
    // Regional Council mirrors live Shugiin timing. Listed after jpElections by
    // convention (UK/DE pairs do the same), but these phases run concurrently
    // via Promise.all, so the order is best-effort, not a guarantee: when a
    // concurrently-created Shugiin race isn't yet visible (clean roll-over /
    // bootstrap), the spawner's fallback recomputes the identical Shugiin
    // canonical cycle, so the council still aligns with the Shugiin.
    { name: "jpRegionalCouncilElections", fn: ensureJPRegionalCouncilElections },
    { name: "jpCouncillorElections", fn: ensureJPCouncillorElections },
    { name: "jpGovernorElections", fn: ensureJPGovernorElections },
  ],
  IE: [
    { name: "ieElections", fn: ensureIEElections },
    { name: "ieUachtaranElections", fn: ensureIEUachtaranElections },
    { name: "ieLocalCouncilElections", fn: ensureIELocalCouncilElections },
    { name: "ieCathaoirleachElections", fn: ensureIECathaoirleachElections },
  ],
  DE: [
    { name: "deElections", fn: ensureDEElections },
    { name: "deLandtagElections", fn: ensureDELandtagElections },
    // MP spawner mirrors live Landtag timing — must run after deLandtagElections
    // so the Landtag election is in the DB to sync against on the same turn.
    { name: "deMinisterPresidentElections", fn: ensureDEMinisterPresidentElections },
  ],
  CN: [
    { name: "cnElections", fn: ensureCNElections },
    { name: "cnPeoplesCongressElections", fn: ensureCNPeoplesCongressElections },
    { name: "cnGovernorElections", fn: ensureCNGovernorElections },
  ],
  // BR was seeded at bootstrap but never registered for per-turn respawn, so
  // Câmara races died permanently once resolved. One family, always-live.
  // The Senate had no spawner at all (not even a dead one) — 81 seats never
  // held a single election and only ever vacated.
  BR: [
    { name: "brElections", fn: ensureBRElections },
    { name: "brSenateElections", fn: ensureBRSenateElections },
  ],
  // RU phases are status-gated no-ops while RU is `coming-soon` (gated in each
  // ensure fn) and era-gated by null anchors outside the Cold-War presets;
  // per-game countryGameStates enablement (1953/1979) activates the full cycle.
  RU: [
    { name: "ruSupremeSovietElections", fn: ensureRUSupremeSovietElections },
    { name: "ruNationalitiesElections", fn: ensureRUNationalitiesElections },
    { name: "ruRepublicSovietElections", fn: ensureRURepublicSovietElections },
    { name: "ruGovernorElections", fn: ensureRUGovernorElections },
  ],
  // DD Volkskammer + Land assemblies + Land First Secretaries — status-gated
  // + era-gated (null anchor outside 1953/1979) like RU; per-game
  // countryGameStates enablement (1953/1979 PLAYER) activates them. Land
  // assemblies must spawn before governors so the First Secretary queue has
  // legislature NPPs to sponsor through (ticket #1044).
  DD: [
    { name: "ddVolkskammerElections", fn: ensureDDVolkskammerElections },
    { name: "ddLandAssemblyElections", fn: ensureDDLandAssemblyElections },
    { name: "ddGovernorElections", fn: ensureDDGovernorElections },
  ],
  // Eastern bloc Tier-1 — unicameral assembly cycles (DD regional-delegate
  // pattern; NPP-governed / beta-active gate). Ride the DD Volkskammer LARP
  // anchor until dedicated eastern-bloc anchors are authored.
  PL: [{ name: "plSejmElections", fn: ensurePLElections }],
  CS: [{ name: "csChamberOfThePeopleElections", fn: ensureCSElections }],
  HU: [{ name: "huNationalAssemblyElections", fn: ensureHUElections }],
  RO: [{ name: "roGrandNationalAssemblyElections", fn: ensureROElections }],
  BG: [{ name: "bgNationalAssemblyElections", fn: ensureBGElections }],
  YU: [{ name: "yuFederalAssemblyElections", fn: ensureYUElections }],
  // Union republics — republican Supreme Soviets. Same registry shape as the
  // satellites, different canonical anchor (see ensureUKRElections).
  UKR: [{ name: "ukrSupremeSovietElections", fn: ensureUKRElections }],
  BLR: [{ name: "blrSupremeSovietElections", fn: ensureBLRElections }],
  BAL: [{ name: "balSupremeSovietElections", fn: ensureBALElections }],
  // NG phases are no-ops while NG is `coming-soon` (gated in each ensure fn);
  // flipping NG's status activates the full cycle.
  NG: [
    { name: "ngElections", fn: ensureNGElections },
    { name: "ngSenateElections", fn: ensureNGSenateElections },
    { name: "ngGovernorElections", fn: ensureNGGovernorElections },
    { name: "ngRegionalCouncilElections", fn: ensureNGRegionalCouncilElections },
    { name: "ngPresidentialElection", fn: ensureNGPresidentialElection },
  ],
  // Seceded devolved chambers — no-op until the country is stood up (SP2b/c).
  SCO: [
    { name: "scoElections", fn: ensureSCOElections },
    { name: "scoGovernorElections", fn: ensureSCOGovernorElections },
    { name: "scoRegionalCouncilElections", fn: ensureSCORegionalCouncilElections },
  ],
  WAL: [
    { name: "walElections", fn: ensureWALElections },
    { name: "walGovernorElections", fn: ensureWALGovernorElections },
    { name: "walRegionalCouncilElections", fn: ensureWALRegionalCouncilElections },
  ],
  // Beta parliamentary countries (#3239) — no-ops while `coming-soon` (gated
  // on runtime country status inside each ensure fn, like NG); flipping the
  // status to beta/active activates the lower-chamber cycle. ES additionally
  // era-gates: 1953-default spawns nothing (Franco dictatorship).
  // Upper chambers (Senates, #3791): sibling phases to the lower-chamber
  // spawner above, sourced from `state.stateSenateSeats` instead of
  // `houseDistricts`. See `ensureBetaSenateElections` in perpetualElections.ts
  // for the per-country simplification notes (FR full-chamber 9y renewal, IT
  // concurrent-with-Camera, ES concurrent-with-Congreso + era-gated, TR
  // 1953-default-only 6y full-chamber renewal). SE has no elected upper
  // chamber (unicameral since 1970) — no senate phase.
  FR: [
    { name: "frElections", fn: ensureFRElections },
    { name: "frSenateElections", fn: ensureFRSenateElections },
  ],
  IT: [
    { name: "itElections", fn: ensureITElections },
    { name: "itSenateElections", fn: ensureITSenateElections },
  ],
  ES: [
    { name: "esElections", fn: ensureESElections },
    { name: "esSenateElections", fn: ensureESSenateElections },
  ],
  SE: [{ name: "seElections", fn: ensureSEElections }],
  TR: [
    { name: "trElections", fn: ensureTRElections },
    { name: "trSenateElections", fn: ensureTRSenateElections },
  ],
  // Split out of TR's phase, where they had been piggybacking: unrelated
  // countries whose elections only ran while Turkey's phase ran.
  GR: [{ name: "grElections", fn: ensureGRElections }],
  AT: [{ name: "atElections", fn: ensureATElections }],
  FI: [{ name: "fiElections", fn: ensureFIElections }],
};

// ─── Parliamentary government helpers ─────────────────────────────────────────

/**
 * Runs post-election government-formation phases for ALL parliamentary countries.
 *
 * For each parliamentary country, checks if a lower chamber election resolved
 * this turn. If so, resets the government to "pending" for new PM appointment.
 *
 * Short-circuits when generalResolved is 0 to avoid unnecessary DB reads.
 */
export async function runPostElectionGovernmentPhases(
  db: Db,
  gameNow: Date,
  generalResolved: number
): Promise<{ governmentFormed: Partial<Record<CountryId, boolean>> }> {
  const governmentFormed: Partial<Record<CountryId, boolean>> = {};
  const preset = await getGameStatePreset(db);

  if (generalResolved > 0) {
    // Iterate every country with a configured lower chamber (US included),
    // not just parliamentary countries. New countries become dissolution-aware
    // via config alone.
    const countryIds = COUNTRY_ORDER.filter(
      (id) => COUNTRY_CONFIGS[id].legislature.lowerChamber.key
    );
    const parliamentary = new Set(getParliamentaryCountryIds(preset));

    for (const countryId of countryIds) {
      const config = getCountryConfig(countryId, preset);
      const lowerChamberKey = config.legislature.lowerChamber.key;
      const snapKey = `snap_${lowerChamberKey}`;

      const recentElection = await db.collection<Election>("elections").findOne({
        countryId,
        electionType: { $in: [lowerChamberKey, snapKey] },
        status: { $in: ["completed", "resolved"] },
        updatedAt: { $gte: new Date(gameNow.getTime() - MS_PER_TURN) },
      });

      if (!recentElection) continue;

      // Lower-chamber generals are per-region (UK Commons, JP Shūgiin, …). A
      // single region resolving must not dissolve legislation or open a
      // confidence motion while other regions of the same cycle are still
      // voting. Next-cycle races already staged as upcoming have a different
      // `cycle` and do not block.
      if (typeof recentElection.cycle === "number") {
        const slateStillLive = await db.collection<Election>("elections").findOne({
          countryId,
          electionType: recentElection.electionType,
          cycle: recentElection.cycle,
          status: { $in: ["active", "upcoming"] },
        });
        if (slateStillLive) continue;
      }

      // Dissolution slate-clearing (Goal 4): runs for every country with a
      // lower chamber. VONC cancel is idempotent / safe no-op for countries
      // without VONC (e.g., US).
      await failInProgressBills(db, countryId, gameNow);
      await cancelActiveNoConfidenceVotes(db, countryId, gameNow);

      // S#17: instead of vacating the PM outright on regular election
      // resolution, try to open a confidence motion and refresh seat
      // counts. The motion's resolution triggers vacate on failure with
      // no alternative seated (resolveParliamentaryAppointmentVote).
      if (parliamentary.has(countryId) && hasConfidenceVoteMechanism(config)) {
        await openConfidenceMotionForIncumbent(db, countryId, gameNow);
        await updateSeatCountsOnly(db, countryId, gameNow);
        governmentFormed[countryId] = true;
      }
    }
  }

  return { governmentFormed };
}

/**
 * Runs government vote phases for ALL parliamentary countries.
 *
 * For each country: seat updates → vote resolution → NPP auto-aye.
 * Sequential within each country (seat data must be current before vote resolution).
 */
export async function runParliamentaryGovernmentPhases(
  gameNow: Date,
  currentTurn: number
): Promise<void> {
  const db = await getDb();
  const preset = await getGameStatePreset(db);
  const parliamentaryCountries = getParliamentaryCountryIds(preset);

  for (const countryId of parliamentaryCountries) {
    // Per-country isolation. 27 countries run in this one loop under a single
    // runPhase, and COUNTRY_ORDER puts RU and DD — both player countries this
    // iteration — at the very end. Without this guard a throw in any earlier
    // country (JP/DE/IE sit at positions 3-5) permanently starves every country
    // after it of PM appointment, confidence resolution, NPP auto-aye and
    // rulingPartyId sync, on every single turn, while the phase still reports
    // completed. Isolating each country turns a world-ending failure into one
    // country having a bad turn.
    try {
      await runParliamentaryCountry(db, countryId, gameNow, currentTurn, preset);
    } catch (error) {
      console.error(
        `[countryPhases] parliamentary phases failed for ${countryId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

async function runParliamentaryCountry(
  db: Awaited<ReturnType<typeof getDb>>,
  countryId: CountryId,
  gameNow: Date,
  currentTurn: number,
  preset?: string
): Promise<void> {
  {
    // Some countries have custom seat update wrappers (e.g. UK legacy seed fallback)
    const seatUpdateOverride = SEAT_UPDATE_OVERRIDES[countryId];
    if (seatUpdateOverride) {
      await seatUpdateOverride();
    } else {
      await updateParliamentaryGovernmentSeats(db, countryId, preset);
    }

    await processParliamentaryGovernmentVotes(db, countryId, gameNow, currentTurn);
    await processParliamentaryNPPAutoAye(db, countryId, gameNow, currentTurn);

    // SP3: in disabled/econ-only countries no player can be nominated PM, so
    // formation stalls "pending" forever. Autoseat the largest party's NPP
    // leader. No-op unless isNppAutonomyActive (never fires where players are
    // enabled) and a player vote hasn't already formed a government this turn.
    await appointNppPrimeMinister(db, countryId, currentTurn, gameNow, preset);

    // Reflect the formed government's party onto countryState.rulingPartyId
    // (informational for non-OPS; was never wired, leaving it null for ~21/23
    // countries). Idempotent + skips one-party states.
    await syncRulingPartyIdFromFormedGovernment(db, countryId);
  }
}

/**
 * Runs the PM vacancy deadline watcher.
 *
 * Must run AFTER runParliamentaryGovernmentPhases so any PM seated this
 * turn has their deadline cleared before the watcher fires.
 */
export async function runParliamentaryVacancyWatcher(
  gameNow: Date,
  currentTurn: number
): Promise<void> {
  await processPMVacancyDeadlines(gameNow, currentTurn);
}
