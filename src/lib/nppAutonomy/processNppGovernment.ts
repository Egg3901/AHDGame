/**
 * processNppGovernment — the V1 governing-brain per-country phase.
 *
 * Gated on `nppAutonomyAtLeast(v1)` (which also enforces the player rail: false
 * below v2 in player-enabled countries). Strategic work (policy, appointment,
 * sector-order — and future diplomacy/sphere callers of the same schedule)
 * runs on the Tier-1 six-hour stagger (#3724), not every normal turn. Economic
 * accounting stays on the every-turn path outside this module. Player-enabled
 * countries stay on caretaker technical continuity only (#3725) — no new
 * strategic or sphere choices from the NPP brain.
 *
 * Current V1 surface (built incrementally behind the same v1 gate):
 *   1. executiveFormation — seat the heads of state the v0 phase does not cover.
 *      Presidential executives (BR, NG) are V1-new (appointNppPresident);
 *      parliamentary + one-party executives are already seated at v0+ by
 *      runParliamentaryGovernmentPhases (appointNppPrimeMinister), so this phase
 *      does not re-seat them.
 *   2. computeAgenda — compute + persist the governing party's policy agenda on
 *      governmentFormation.governingAgenda. Everything downstream (agenda-driven
 *      bill sponsorship, ministerial governance, fiscal stance) reads this.
 *   3. cabinetFormation — directly fill vacant cabinet posts from co-partisan
 *      NPPs (formNppCabinet), turning on the dormant ministerial levers. Parl./
 *      one-party direct-fill, not the US-only nomination lifecycle.
 *   4. ministerialGovernance — each NPP minister steers its tier setting and
 *      issues ministerial orders toward the agenda (runMinisterialGovernance).
 *
 * The agenda compute also derives the V1.6 fiscal stance and intakes active
 * crises (V1.8) so emergencies dominate the agenda. Agenda-driven bill
 * sponsorship (V1.5) and opposition bloc voting (V1.7) live in the NPP turn
 * phases (billSponsorship / billVoting), reading the agenda this phase persists.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  isPresidentialGovernmentType,
} from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { isPlannedEconomy, plannedShare } from "@/lib/constants/commandEconomy";
import { loadConditionsSignal } from "@/lib/turn/npp/billSponsorship";
import { nppAutonomyAtLeast } from "./featureFlag";
import { appointNppPresident } from "./appointNppPresident";
import { computeGoverningAgenda } from "./governingAgenda";
import { loadCrisisAgendaSignals } from "./crisisIntake";
import { loadDomainHealth } from "./governingMetrics";
import {
  computeGovernmentPerformance,
  applyGovernmentPerformanceNudge,
} from "./governmentPerformance";
import { computeFiscalStance, computePlanStance, deriveCommandStance } from "./fiscalStance";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { MONETARY_BASELINES } from "@/lib/constants/currencies";
import { formNppCabinet } from "./formNppCabinet";
import { runMinisterialGovernance, runCaretakerMinisters } from "./ministerialGovernance";
import { claimTier1NppDecisionSlot } from "./tier1DecisionClaim";
import type { Tier1DecisionSkipReason } from "./tier1DecisionSchedule";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { caretakerDecisionAllowed } from "@/lib/world/playerHandoff";

/**
 * How many turns an agenda stays valid before recompute. The agenda is
 * multi-turn intent, not a per-turn reflex; ~weekly (turns are hourly) keeps it
 * stable across a governing period while still tracking shifting conditions. A
 * freshly-seated government has no agenda, so it always computes immediately.
 */
export const AGENDA_RECOMPUTE_INTERVAL_TURNS = 168;

export interface NppGovernmentResult {
  /** Whether the v1 gate was met and the strategic batch ran for this country. */
  ran: boolean;
  /** Whether an executive (president) was seated this call. */
  seatedExecutive: boolean;
  /** Whether the governing agenda was (re)computed and persisted this call. */
  agendaUpdated: boolean;
  /** Number of vacant cabinet posts filled this call (V1.3). */
  cabinetPostsFilled: number;
  /** Number of ministerial orders issued this call (V1.4). */
  ministerialOrdersIssued: number;
  /** Why the staggered strategic batch was skipped, when applicable (#3724). */
  skipReason?: Tier1DecisionSkipReason;
}

const INACTIVE: NppGovernmentResult = {
  ran: false,
  seatedExecutive: false,
  agendaUpdated: false,
  cabinetPostsFilled: 0,
  ministerialOrdersIssued: 0,
};

/**
 * Run the V1 governing brain for a single country. Safe to invoke every turn:
 * the Tier-1 stagger claims a six-hour slot before acting, and each sub-step
 * no-ops when its work is already done.
 *
 * `currentYear` + `commandEconomyEnabled` mirror centralBankChairTurn's threading
 * of the command-economy regime into the NPP chair path. Omitted / flag-off →
 * market fiscal stance (byte-identical to pre-command-economy behavior).
 */
export async function processNppGovernment(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date,
  currentYear?: number | null,
  commandEconomyEnabled?: boolean,
  preset?: string
): Promise<NppGovernmentResult> {
  if (!(await nppAutonomyAtLeast(db, countryId, "v1"))) return INACTIVE;

  // Tier-1 strategic stagger (#3724): claim the six-hour bucket before acting so
  // a restarted worker cannot double-fire. Economic accounting is not gated here.
  const slot = await claimTier1NppDecisionSlot(db, countryId, currentTurn, now);
  if (!slot.run) {
    return { ...INACTIVE, skipReason: slot.reason };
  }

  // Player-enabled countries: humans own country-level strategy. Do not also run
  // NPP policy / appointment / sector-order / diplomacy / sphere (#3724+#3725).
  // Country-level caretaker allows technical continuity only. V2.1 player-
  // appointed caretaker ministers may still steer seats the player staffed.
  if (await isCountryEnabledForPlayers(db, countryId)) {
    if (caretakerDecisionAllowed("strategic") || caretakerDecisionAllowed("sphere")) {
      throw new Error("Handoff caretaker must refuse strategic and sphere decisions");
    }
    const caretaker = caretakerDecisionAllowed("technical")
      ? await runCaretakerMinisters(db, countryId, currentTurn, now)
      : { ordersIssued: 0 };
    return {
      ran: true,
      seatedExecutive: false,
      agendaUpdated: false,
      cabinetPostsFilled: 0,
      ministerialOrdersIssued: caretaker.ordersIssued,
      skipReason: "player-controlled",
    };
  }

  const config = getCountryConfig(countryId, preset);
  const planned = isPlannedEconomy(countryId, currentYear, commandEconomyEnabled);

  // 1. Executive formation (presidential is the V1-new path).
  let seatedExecutive = false;
  if (isPresidentialGovernmentType(config.governmentType)) {
    seatedExecutive = await appointNppPresident(db, countryId, currentTurn, now, preset);
  }

  // 2. Governing agenda.
  const agendaUpdated = await computeAndPersistGoverningAgenda(
    db,
    countryId,
    currentTurn,
    now,
    currentYear,
    commandEconomyEnabled,
    planned
  );

  // 3. Cabinet formation — fill vacant posts from co-partisan NPPs (V1.3). Runs
  //    after executive formation so a freshly-seated head can staff immediately.
  const cabinet = await formNppCabinet(db, countryId, now);

  // 4. Ministerial governance — NPP ministers steer tiers + issue orders toward
  //    the agenda (V1.4). Runs after cabinet formation so newly-seated ministers
  //    can act the same turn.
  const ministerial = await runMinisterialGovernance(db, countryId, currentTurn, now);

  // 5. Caretaker ministers (V2.1) — NPPs a *player* head appointed into single
  //    cabinet seats in a player-enabled country. Unreachable here for
  //    player-enabled countries (handled above); kept for non-player edge cases
  //    and as a no-op below the comingle tier.
  const caretaker = await runCaretakerMinisters(db, countryId, currentTurn, now);

  return {
    ran: true,
    seatedExecutive,
    agendaUpdated,
    cabinetPostsFilled: cabinet.filled,
    ministerialOrdersIssued: ministerial.ordersIssued + caretaker.ordersIssued,
  };
}

/**
 * Compute + persist the governing party's agenda when a government is formed and
 * its head is an NPP. Recomputes only when the agenda is absent or stale. Pure
 * decision (`computeGoverningAgenda`) wrapped in DB I/O.
 */
async function computeAndPersistGoverningAgenda(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date,
  currentYear: number | null | undefined,
  commandEconomyEnabled: boolean | undefined,
  planned: boolean
): Promise<boolean> {
  const govCol = getGovernmentFormationsCollection(db);
  const gov = await govCol.findOne({ _id: countryId });
  if (!gov || gov.status !== "formed") return false;

  // Head of government — presidential vs parliamentary. A player-held head
  // (no NPP id) means there is no NPP brain to run here.
  const headNppId = gov.presidentNppId ?? gov.pmNppId ?? null;
  if (!headNppId) return false;

  // Crisis intake (V1.8) — load first so a brand-new crisis can force an
  // immediate recompute even when the standing agenda is otherwise fresh.
  const crisisIntake = await loadCrisisAgendaSignals(db, countryId);
  const crisisActive = Object.keys(crisisIntake.signals).length > 0;

  // Recompute cadence: skip while the current agenda is fresh — unless a crisis
  // that started after the last compute now demands the government's attention.
  const existing = gov.governingAgenda;
  const fresh = existing && currentTurn - existing.computedTurn < AGENDA_RECOMPUTE_INTERVAL_TURNS;
  const crisisDemandsRecompute =
    crisisActive && (!existing || existing.computedTurn < crisisIntake.latestStartTurn);
  if (fresh && !crisisDemandsRecompute) {
    return false;
  }

  // Accountability (improvement): before replacing the outgoing agenda, grade
  // the government against the targets it set and nudge the governing party's
  // favorability — rewarded for meeting goals, punished for missing them. Runs
  // on the (≈weekly) recompute cadence, a periodic report card.
  const governingPartyId = gov.governingPartyId;
  if (existing && existing.items.length > 0 && governingPartyId) {
    const domainHealth = await loadDomainHealth(db, countryId);
    const performance = computeGovernmentPerformance(existing.items, domainHealth);
    if (performance.favorabilityDelta !== 0) {
      const nudged = await applyGovernmentPerformanceNudge(
        db,
        countryId,
        governingPartyId,
        performance.favorabilityDelta,
        now
      );
      console.log(
        `[nppAutonomy] ${countryId}: performance ${performance.score.toFixed(2)} → favorability ${performance.favorabilityDelta >= 0 ? "+" : ""}${performance.favorabilityDelta.toFixed(1)} across ${nudged} NPP(s)`
      );
    }
  }

  const headNpp = await db.collection<NPP>("npps").findOne({ _id: headNppId });
  if (!headNpp) return false;

  const conditions = await loadConditionsSignal(db, countryId);
  // Fetched before the agenda (not just for the V1.6 fiscal posture below) so
  // the agenda's own fiscal-distress driver can read the same debt figure:
  // severe distress recolors the government's weakly-justified "raise" items
  // toward "lower" at the domain level, not just the aggregate fiscal stance.
  // Market countries only - planned economies have no equivalent driver yet
  // (their distress signal is shortage/overhang, read by computePlanStance
  // below, not sovereign debt), so `planned` countries pass no debt figure and
  // this driver simply stays inert for them.
  const budget = await db.collection("federalBudget").findOne(
    { countryId },
    {
      projection: {
        debtToGdpRatio: 1,
        "economicFactors.shortageIndex": 1,
        "economicFactors.monetaryOverhang": 1,
      },
    }
  );
  const agenda = computeGoverningAgenda({
    conditions,
    ideology: {
      economic: headNpp.policies?.economic ?? 0,
      social: headNpp.policies?.social ?? 0,
    },
    personality: headNpp.personality,
    crises: crisisIntake.signals,
    debtToGdpRatio:
      !planned && typeof budget?.debtToGdpRatio === "number" ? budget.debtToGdpRatio : undefined,
    currentTurn,
  });

  // V1.6: fiscal posture. Market countries use inflation/debt; planned countries
  // use shortage/overhang from commandEconomyTurn (same PersistedFiscalStance shape).
  const fiscalStance = planned
    ? computePlanStance({
        agenda: agenda.items,
        shortageIndex:
          typeof budget?.economicFactors?.shortageIndex === "number"
            ? budget.economicFactors.shortageIndex
            : 0,
        monetaryOverhang:
          typeof budget?.economicFactors?.monetaryOverhang === "number"
            ? budget.economicFactors.monetaryOverhang
            : 0,
        plannedShare: plannedShare(countryId, currentYear, commandEconomyEnabled),
        personality: headNpp.personality,
        currentTurn,
      })
    : computeFiscalStance({
        agenda: agenda.items,
        inflationRate: conditions.inflationRate ?? 0,
        // Era-aware first (1953/1979/1991 overrides graduate as the world's
        // clock advances), falling back to the modern global table - the same
        // resolution order the currency/inflation modules already use. This is
        // what lets "hot" mean something country/era-relative instead of a
        // single absolute (a 15%-target regime isn't in crisis at 15%).
        targetInflationRate:
          getEraMonetaryBaseline(countryId, currentYear)?.targetInflation ??
          MONETARY_BASELINES[countryId]?.targetInflation,
        debtToGdpRatio: typeof budget?.debtToGdpRatio === "number" ? budget.debtToGdpRatio : 0,
        personality: headNpp.personality,
        currentTurn,
      });

  // Planned-economy command levers (per-country second-economy tolerance + plan
  // tightness). Only written when planned so market worlds keep the prior $set shape.
  const commandStance = planned
    ? deriveCommandStance({
        personality: headNpp.personality,
        economic: headNpp.policies?.economic ?? 0,
        planStance: fiscalStance,
        currentTurn,
      })
    : undefined;

  await govCol.updateOne(
    { _id: countryId },
    {
      $set: {
        governingAgenda: agenda,
        fiscalStance,
        ...(commandStance ? { commandStance } : {}),
        updatedAt: now,
      },
    }
  );
  return true;
}

/**
 * Turn-phase entry: run the V1 governing brain across every country. Each call
 * self-gates on the per-country v1 level, so this is a cheap no-op everywhere
 * autonomy is off / below v1 / player-enabled-below-v2.
 */
export async function runNppGovernmentPhases(gameNow: Date, currentTurn: number): Promise<void> {
  const db = await getDb();

  // Command-economy regime context — same load pattern as centralBankChairTurn.
  // Flag default OFF: omitted/false → isPlannedEconomy is false everywhere.
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1, preset: 1 } });
  const currentYear = gameState?.currentYear;
  const gameConfig = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;

  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    await processNppGovernment(
      db,
      countryId,
      currentTurn,
      gameNow,
      currentYear,
      commandEconomyEnabled,
      gameState?.preset
    );
  }
}
