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
 *   5. foreignPolicy — score and audit one diplomatic intent. The planner
 *      defaults to shadow mode and does not mutate gameplay state yet.
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
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { isPlannedEconomy, plannedShare } from "@/lib/constants/commandEconomy";
import { loadConditionsSignal } from "@/lib/turn/npp/billSponsorship";
import { getNppAutonomyLevel, nppAutonomyAtLeast, nppAutonomyLevelAtLeast } from "./featureFlag";
import { NPP_ENGINE_LEVEL } from "./engineVersion";
import {
  commitGoverningGoals,
  reviewGoverningGoals,
  type GoverningGoalRecord,
} from "./v5/rules/governingGoals";
import { loadNppBehaviorPolicy } from "@/lib/singleplayerDifficulty/loadBehaviorPolicy";
import { appointNppPresident } from "./appointNppPresident";
import { computeGoverningAgenda } from "./governingAgenda";
import { loadElectoralMandate } from "./electoralMandateIntake";
import { loadCrisisAgendaSignals } from "./crisisIntake";
import { loadDomainHealth } from "./governingMetrics";
import {
  computeGovernmentPerformance,
  applyGovernmentPerformanceNudge,
} from "./governmentPerformance";
import { computeFiscalStance, computePlanStance, deriveCommandStance } from "./fiscalStance";
import { fiscalBalanceGdpShare } from "./rules/fiscalDeficitPressure";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { MONETARY_BASELINES } from "@/lib/constants/currencies";
import { formNppCabinet } from "./formNppCabinet";
import { runMinisterialGovernance, runCaretakerMinisters } from "./ministerialGovernance";
import { claimTier1NppDecisionSlot } from "./tier1DecisionClaim";
import type { Tier1DecisionSkipReason } from "./tier1DecisionSchedule";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { caretakerDecisionAllowed } from "@/lib/world/playerHandoff";
import { processAutonomousForeignPolicy } from "./foreignPolicy";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { boundedParallelMap } from "@/lib/indexFunds/boundedParallelMap";
import {
  agendaReviewSnapshot,
  annualPerformanceReviewDue,
  shouldRecomputeGoverningAgenda,
} from "./rules/agendaReview";

/**
 * Routine agenda review interval, measured in game-calendar years (48 turns).
 * Material conditions and crisis changes can prompt an earlier re-plan.
 */
export const AGENDA_RECOMPUTE_INTERVAL_TURNS = TURNS_PER_YEAR;

/** Parallel lanes for the per-country domestic pass of `runNppGovernmentPhases`. */
export const NPP_GOVERNMENT_LANES = 4;

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
  /** Whether this call inserted a foreign-policy decision audit row. */
  foreignPolicyDecisionRecorded: boolean;
  /** Why the staggered strategic batch was skipped, when applicable (#3724). */
  skipReason?: Tier1DecisionSkipReason;
}

const INACTIVE: NppGovernmentResult = {
  ran: false,
  seatedExecutive: false,
  agendaUpdated: false,
  cabinetPostsFilled: 0,
  ministerialOrdersIssued: 0,
  foreignPolicyDecisionRecorded: false,
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
  const domestic = await processNppGovernmentDomestic(
    db,
    countryId,
    currentTurn,
    now,
    currentYear,
    commandEconomyEnabled,
    preset
  );
  if (!domestic.foreignPolicyDue) return domestic.result;
  const foreignPolicy = await processAutonomousForeignPolicy(db, countryId, currentTurn, now);
  return { ...domestic.result, foreignPolicyDecisionRecorded: foreignPolicy.decisionRecorded };
}

interface DomesticGovernmentOutcome {
  result: NppGovernmentResult;
  /** True when the strategic batch ran and step 6 (foreign policy) is owed. */
  foreignPolicyDue: boolean;
}

/**
 * Steps 1-5 of the governing brain: everything except foreign policy. Split
 * out so `runNppGovernmentPhases` can run the domestic work of every country in
 * parallel lanes and then take the foreign-policy step serially in country
 * order (see the independence note there).
 */
async function processNppGovernmentDomestic(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date,
  currentYear?: number | null,
  commandEconomyEnabled?: boolean,
  preset?: string
): Promise<DomesticGovernmentOutcome> {
  if (!(await nppAutonomyAtLeast(db, countryId, "v1"))) {
    return { result: INACTIVE, foreignPolicyDue: false };
  }

  // Tier-1 strategic stagger (#3724): claim the six-hour bucket before acting so
  // a restarted worker cannot double-fire. Economic accounting is not gated here.
  const slot = await claimTier1NppDecisionSlot(db, countryId, currentTurn, now);
  if (!slot.run) {
    return { result: { ...INACTIVE, skipReason: slot.reason }, foreignPolicyDue: false };
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
      result: {
        ran: true,
        seatedExecutive: false,
        agendaUpdated: false,
        cabinetPostsFilled: 0,
        ministerialOrdersIssued: caretaker.ordersIssued,
        foreignPolicyDecisionRecorded: false,
        skipReason: "player-controlled",
      },
      foreignPolicyDue: false,
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
  const cabinet = await formNppCabinet(db, countryId, now, currentTurn);

  // 4. Ministerial governance — NPP ministers steer tiers + issue orders toward
  //    the agenda (V1.4). Runs after cabinet formation so newly-seated ministers
  //    can act the same turn.
  const ministerial = await runMinisterialGovernance(db, countryId, currentTurn, now);

  // 5. Caretaker ministers (V2.1) — NPPs a *player* head appointed into single
  //    cabinet seats in a player-enabled country. Unreachable here for
  //    player-enabled countries (handled above); kept for non-player edge cases
  //    and as a no-op below the comingle tier.
  const caretaker = await runCaretakerMinisters(db, countryId, currentTurn, now);

  // 6. Foreign policy is owed by the caller. It stays inside the claimed Tier-1
  //    slot so each autonomous government takes at most one diplomatic ACTION
  //    per six-hour cycle. Ballots are not rationed by that slot — a bloc vote
  //    has a deadline and a tariff does not, and making them compete let a
  //    member sit out every ballot it was eligible for (#1257). Shadow mode only
  //    writes its audit decision.
  return {
    result: {
      ran: true,
      seatedExecutive,
      agendaUpdated,
      cabinetPostsFilled: cabinet.filled,
      ministerialOrdersIssued: ministerial.ordersIssued + caretaker.ordersIssued,
      foreignPolicyDecisionRecorded: false,
    },
    foreignPolicyDue: true,
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

  // These bounded, existing input readers run once per strategic slot. Their
  // compact snapshots allow material changes to re-plan before the annual review.
  const crisisIntake = await loadCrisisAgendaSignals(db, countryId);
  const conditions = await loadConditionsSignal(db, countryId);
  const existing = gov.governingAgenda;
  // A change of governing party brings a new electoral mandate (#2321); the
  // incoming government should not run its predecessor's agenda until the
  // next scheduled recompute. Only a persisted mandate is compared, so a record
  // without one waits for the ordinary cadence instead of recomputing every turn.
  const priorMandate = gov.electoralMandate;
  const governmentChanged =
    !!existing && !!priorMandate && priorMandate.partyId !== (gov.governingPartyId ?? null);
  if (
    !shouldRecomputeGoverningAgenda({
      agenda: existing,
      currentTurn,
      intervalTurns: AGENDA_RECOMPUTE_INTERVAL_TURNS,
      conditions,
      crisis: crisisIntake,
      governmentChanged,
    })
  ) {
    return false;
  }

  // V5: persistent governing goals. The whole increment is gated here — below
  // v5 nothing below reads or writes `governingGoals`, so a v4 world takes the
  // identical path it always did.
  const v5Active = await nppAutonomyAtLeast(db, countryId, "v5");

  // Domain health is read once and shared by the accountability nudge, the V5
  // goal review, and the V5 commitment step. All three grade the government
  // against the same numbers on purpose; a second read could disagree with the
  // first inside one cycle.
  // Accountability remains an annual report card even when conditions or a
  // crisis trigger an earlier strategic re-plan. A separate persisted turn keeps
  // event-driven recomputes from farming repeated favorability nudges.
  const governingPartyId = gov.governingPartyId;
  const performanceReviewDue = annualPerformanceReviewDue(existing, currentTurn, TURNS_PER_YEAR);
  const domainHealth =
    v5Active || (performanceReviewDue && existing && existing.items.length > 0 && governingPartyId)
      ? await loadDomainHealth(db, countryId)
      : {};
  if (performanceReviewDue && existing && existing.items.length > 0 && governingPartyId) {
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

  // V5 goal review — grade every standing goal BEFORE the next agenda is
  // computed, so the verdicts can re-weight it. Difficulty enters here and
  // nowhere else in this function: it sets how long a commitment is held and how
  // many are tracked, never what the government is allowed to do.
  const behaviorPolicy = v5Active ? await loadNppBehaviorPolicy(db) : null;
  const priorGoals: GoverningGoalRecord[] = v5Active ? (gov.governingGoals?.goals ?? []) : [];
  const review =
    v5Active && behaviorPolicy
      ? reviewGoverningGoals({
          goals: priorGoals,
          domainHealth,
          policy: behaviorPolicy,
          currentTurn,
        })
      : null;

  const headNpp = await db
    .collection<NPP>("npps")
    .findOne(
      { _id: headNppId },
      { projection: { personality: 1, "policies.economic": 1, "policies.social": 1 } }
    );
  if (!headNpp) return false;

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
        gdp: 1,
        "revenue.total": 1,
        "spending.total": 1,
        "economicFactors.shortageIndex": 1,
        "economicFactors.monetaryOverhang": 1,
      },
    }
  );
  // Electoral mandate (#2321): what the governing party ran and won on. The
  // head's own ideology above is a separate input, so two governments led by
  // identical heads still diverge when their parties won on opposing platforms.
  const electoralMandate = await loadElectoralMandate(db, countryId, gov, currentTurn);
  const agenda = computeGoverningAgenda({
    conditions,
    ...(electoralMandate ? { mandate: electoralMandate.domains } : {}),
    ideology: {
      economic: headNpp.policies?.economic ?? 0,
      social: headNpp.policies?.social ?? 0,
    },
    personality: headNpp.personality,
    crises: crisisIntake.signals,
    debtToGdpRatio:
      !planned && typeof budget?.debtToGdpRatio === "number" ? budget.debtToGdpRatio : undefined,
    ...(review ? { goalFeedback: review.feedback } : {}),
    currentTurn,
  });
  agenda.reviewSnapshot = agendaReviewSnapshot(conditions, crisisIntake);
  agenda.performanceReviewedTurn = performanceReviewDue
    ? currentTurn
    : (existing?.performanceReviewedTurn ?? existing?.computedTurn ?? currentTurn);

  // V5 commitment — reconcile the reviewed records against the fresh scan and
  // lead the agenda with what the government is actually committed to. From
  // here down nothing knows goals exist: ministerial governance, sponsorship and
  // the fiscal stance all read `agenda.items` exactly as they did at v4.
  const commitment =
    review && behaviorPolicy
      ? commitGoverningGoals({
          reviewed: review.goals,
          agenda: agenda.items,
          domainHealth,
          policy: behaviorPolicy,
          currentTurn,
        })
      : null;
  if (commitment && review) {
    agenda.items = commitment.agenda;
    const { achieved, revised, failed, active } = review.verdicts;
    console.log(
      `[nppAutonomy] ${countryId}: V5 goals — ${commitment.goals.length} committed ` +
        `(achieved ${achieved}, revised ${revised}, failed ${failed}, held ${active})`
    );
  }

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
        fiscalBalanceGdpShare: fiscalBalanceGdpShare({
          gdp: budget?.gdp,
          revenueTotal: budget?.revenue?.total,
          spendingTotal: budget?.spending?.total,
        }),
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
        electoralMandate,
        fiscalStance,
        ...(commandStance ? { commandStance } : {}),
        ...(commitment
          ? { governingGoals: { goals: commitment.goals, updatedTurn: currentTurn } }
          : {}),
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

  // REGISTERED countries only — and this loop is the one where the gate is not
  // merely hygiene. A country dissolved by a merge reads `enabledForPlayers:
  // false`, which to the per-country autonomy gate looks like a NON-PLAYER
  // country and would hand the dissolved state to the FULL governing brain:
  // agenda, cabinet formation, ministerial orders, autonomous foreign policy —
  // a ghost government legislating and declaring for a country that no longer
  // exists.
  const registered = new Set(await getRegisteredCountryIds(db));
  const countries = (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter((countryId) =>
    registered.has(countryId)
  );

  // Two passes, chosen so the outcome matches the old serial loop exactly.
  //
  // Pass 1 runs steps 1-5 (executive, agenda, cabinet, ministers, caretakers)
  // in bounded parallel lanes. That work is independent per country: every
  // read and write is keyed to the country's own documents (its
  // governmentFormation, countryGameStates slot claim, electedOfficials,
  // cabinetMembers, cabinetSettings, ministerialOrders, crises, budget and
  // metrics rows, and NPPs filtered by countryId). The one cross-country write,
  // expireMinisterialOrders, is an idempotent sweep keyed on the shared turn, and
  // every order issued this turn expires at least 24 turns out, so no
  // interleaving changes what it deactivates. Autonomy level and country access
  // snapshots are AsyncLocalStorage scopes, which every lane inherits; there is
  // no module-level cache on this path.
  //
  // Pass 2 runs step 6 (foreign policy) serially in country order. It is NOT
  // independent: one government's tariff bill, embargo, organization vote or
  // war order is read by the next government's opinion scoring, so its order
  // is kept. Its reads of other countries go only through those diplomatic
  // collections, which pass 1 never writes, and pass 1 never reads what
  // foreign policy writes, so moving every country's step 6 after every
  // country's steps 1-5 changes nothing.
  //
  // Failure: once a country throws, no new country starts (lanes already in
  // flight finish their domestic step); foreign policy runs
  // for the countries ordered before the failure (what the serial loop would
  // have finished), then the earliest-ordered error is rethrown.
  //
  // Lanes run only at v6 (NPP engine 6). Below it a single lane reproduces the
  // old serial loop exactly, including the order of the caretaker-resignation
  // draws and which countries a failure stops.
  const lanes = nppAutonomyLevelAtLeast(await getNppAutonomyLevel(db), NPP_ENGINE_LEVEL)
    ? NPP_GOVERNMENT_LANES
    : 1;
  let failed = false;
  const domestic = await boundedParallelMap(
    countries,
    lanes,
    async (countryId): Promise<{ outcome?: DomesticGovernmentOutcome; error?: unknown }> => {
      if (failed) return {};
      try {
        return {
          outcome: await processNppGovernmentDomestic(
            db,
            countryId,
            currentTurn,
            gameNow,
            currentYear,
            commandEconomyEnabled,
            gameState?.preset
          ),
        };
      } catch (error) {
        failed = true;
        return { error };
      }
    }
  );

  for (let i = 0; i < countries.length; i++) {
    const entry = domestic[i]!;
    // Lanes claim countries in order, so a country skipped after a failure
    // always sits after the failing one and this throws before reaching it.
    if (!entry.outcome) throw entry.error;
    if (entry.outcome.foreignPolicyDue) {
      await processAutonomousForeignPolicy(db, countries[i]!, currentTurn, gameNow);
    }
  }
}
