/**
 * World Events v1 Phase 1: the scheduler's turn-phase producer. Registered
 * near `processPlayerRandomEventsTurn` in `turnPhaseRegistry.ts`. Unlike
 * Phase 0 (admin-trigger-only), this offers scheduled country-scope events
 * automatically each turn once `worldEventsEnabled` is on.
 *
 * News-spam cap (plan §7, "≤1 world-event offer per country per turn"): the
 * per-country loop below stops after the first successful offer, and the
 * existing `hasPendingEvent` one-pending-per-scope guard means a country
 * that already has a pending instance (scheduled or admin-triggered) is
 * skipped outright — together these enforce the cap without a separate
 * counter.
 */
import type { Db } from "mongodb";
import "@/lib/events/pree/index";
import type { Character } from "@/lib/db/types/character";
import type { Crisis } from "@/lib/db/types/crisis";
import type { EventDefinition } from "@/lib/db/types/events";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getEventCooldownLedgerCollection } from "@/lib/db/collections/eventCooldownLedger";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { isWorldEventsEnabled } from "@/lib/events/featureFlag";
import {
  ActiveEventConflictError,
  computeExpiresAtRealtimeMs,
  hasPendingEvent,
  offerEvent,
} from "@/lib/events/substrate/offer";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import { getEventHandler } from "@/lib/events/substrate/registry";
import { hashToUint32, seededRoll } from "@/lib/events/substrate/rng";
import { getLastFiredTurn, recordScheduledCountryFire } from "@/lib/events/substrate/cooldown";
import { isWithinYearWindow } from "@/lib/events/substrate/yearWindow";
import { isWithinTensionWindow } from "@/lib/events/substrate/tensionWindow";
import { getColdWarTension } from "@/lib/coldwar/tension";
import { isRecurringDue, isScheduleDue } from "./scheduler";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { notifyCountryExecutiveEventOffered } from "@/lib/events/pree/notifications";
import { loadActiveWarEmergencyMitigationPctMap } from "@/lib/events/substrate/countryModifiers";
import {
  HIGH_TENSION_SHARED_LEDGER_KIND,
  isHighTensionSharedDue,
  isHighTensionSocietyEvent,
} from "./warEmergency";
import { createCrisisFromTemplate } from "@/lib/crises/createCrisisFromTemplate";
import { warEmergencyTemplateForEventKind } from "@/lib/crises/warEmergencyCrises";

export interface WorldEventsTurnResult {
  offered: number;
  skipped: number;
  /**
   * World Events v1 Phase 3 — Olympics/worlds-fair "host country" offers
   * this turn (simple flavor events with a deterministically-picked host,
   * not a bidding cycle — see `offerGlobalHostCountryEvent` below).
   */
  globalHostEventsOffered: number;
}

/**
 * World Events v1 Phase 3: config for the two "global host" flavor events.
 * Unlike every other definition in `definitions.ts`, these have no
 * `schedule` field of their own — the schedule lives here because firing
 * them is a global, turn-keyed decision (pick ONE host country), not a
 * per-country one the generic scheduler loop below can express.
 */
const GLOBAL_HOST_EVENTS: {
  kind: string;
  everyTurns: number;
  offsetTurns: number;
}[] = [
  // ~48-turn cadence, matching the Phase 3 Olympics cadence used previously.
  { kind: "worldEvents.olympics", everyTurns: 48, offsetTurns: 12 },
  // ~36-turn cadence (cheaper/more frequent than Olympics), offset so the
  // two don't collide on the same turn by construction.
  { kind: "worldEvents.worldsFair", everyTurns: 36, offsetTurns: 30 },
];

/**
 * Fires at most one "global host" flavor event (Olympics / World's Fair) per
 * config entry per turn: checks the recurring schedule, and if due, picks a
 * host country deterministically from a hash of the current turn (never
 * Math.random — sim-reproducible) among active countries, then offers the
 * event directly to that host's country scope exactly like any other
 * country-scope event. No escrow, no bidding, no cycle document — if the
 * chosen host already has a pending event this turn, the offer is simply
 * skipped (same one-pending-per-country cap as everything else; it will be
 * eligible again next cadence).
 */
async function offerGlobalHostCountryEvent(
  db: Db,
  currentTurn: number,
  config: { kind: string; everyTurns: number; offsetTurns: number },
  currentYear?: number
): Promise<"offered" | "skipped"> {
  if (!isRecurringDue(currentTurn, config)) {
    return "skipped";
  }

  const definition = await getEventDefinitionsCollection(db).findOne({
    kind: config.kind,
    status: "approved",
  });
  if (!definition || !getEventHandler(config.kind)) {
    return "skipped";
  }
  if (!isWithinYearWindow(definition, currentYear)) {
    return "skipped";
  }

  const activeCountries = COUNTRY_ORDER.filter((id) => COUNTRY_CONFIGS[id].status === "active");
  if (activeCountries.length === 0) {
    return "skipped";
  }
  const hostIndex =
    hashToUint32(`worldEventGlobalHost:${config.kind}:${currentTurn}`) % activeCountries.length;
  const countryId = activeCountries[hostIndex]!;
  const scopeId = countryScopeId(countryId);

  if (await hasPendingEvent(db, "country", scopeId)) {
    return "skipped";
  }

  const roll = seededRoll(countryId, currentTurn, config.kind, "worldEventGlobalHost");
  const payload: Record<string, unknown> = { countryId };

  let instance;
  try {
    instance = await offerEvent(db, {
      kind: config.kind,
      scope: "country",
      scopeId,
      definitionVersion: definition.version,
      roll,
      payload,
      offeredAtTurn: currentTurn,
      expiresAtRealtimeMs: computeExpiresAtRealtimeMs(),
    });
  } catch (error) {
    if (error instanceof ActiveEventConflictError) {
      return "skipped";
    }
    throw error;
  }

  const leaderCharId = await getHeadOfGovernmentCharacterId(db, countryId);
  if (leaderCharId) {
    const leaderChar = await db
      .collection<Character>("characters")
      .findOne({ _id: leaderCharId }, { projection: { userId: 1 } });
    if (leaderChar?.userId) {
      await notifyCountryExecutiveEventOffered(leaderChar.userId, definition, instance);
    }
  }

  return "offered";
}

async function loadScheduledDefinitions(db: Db): Promise<EventDefinition[]> {
  return getEventDefinitionsCollection(db)
    .find({ status: "approved", schedule: { $exists: true } })
    .toArray();
}

/**
 * Attempts to create at most one scheduled incident for a single country this
 * turn. Ordinary world events use the event substrate. High-tension wartime
 * incidents are real crises and use the crisis interaction system.
 */
async function offerScheduledEventForCountry(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  definitions: EventDefinition[],
  currentYear?: number,
  currentTension?: number,
  warEmergencyMitigationPct = 0
): Promise<"offered" | "skipped"> {
  const scopeId = countryScopeId(countryId);

  const ledger = await getEventCooldownLedgerCollection(db).findOne({
    scope: "country",
    scopeId,
  });
  const lastHighTensionEventTurn = getLastFiredTurn(ledger, HIGH_TENSION_SHARED_LEDGER_KIND);

  for (const definition of definitions) {
    if (!definition.schedule) {
      continue;
    }
    if (definition.requiresCountryIds && !definition.requiresCountryIds.includes(countryId)) {
      continue;
    }
    if (!isWithinYearWindow(definition, currentYear)) {
      continue;
    }
    if (!isWithinTensionWindow(definition, currentTension)) {
      continue;
    }
    const highTensionEvent = isHighTensionSocietyEvent(definition.kind);
    if (
      highTensionEvent &&
      !isHighTensionSharedDue(
        currentTurn,
        countryId,
        lastHighTensionEventTurn,
        warEmergencyMitigationPct
      )
    ) {
      continue;
    }
    const handler = getEventHandler(definition.kind);
    if (!handler) {
      continue;
    }

    const lastFiredTurn = getLastFiredTurn(ledger, definition.kind);
    const due = isScheduleDue(
      currentTurn,
      countryId,
      definition.kind,
      lastFiredTurn,
      definition.schedule
    );
    if (!due) {
      continue;
    }

    if (highTensionEvent) {
      const crisisDefinition = warEmergencyTemplateForEventKind(definition.kind);
      if (!crisisDefinition) continue;

      // A country may face different staggered wartime crises at once, but the
      // same crisis must never stack with itself while an earlier copy is live.
      const alreadyActive = await db.collection<Crisis>("crises").findOne(
        {
          templateKey: crisisDefinition.templateKey,
          status: "active",
          countryIds: countryId,
        },
        { projection: { _id: 1 } }
      );
      if (alreadyActive) continue;

      await createCrisisFromTemplate(db, {
        template: crisisDefinition.template,
        templateKey: crisisDefinition.templateKey,
        scope: "country",
        countryIds: [countryId],
        regionIds: [],
        // The crisis turn phase has already run when this scheduler executes.
        // Starting next turn ensures onset effects and wire announcements fire.
        currentTurn: currentTurn + 1,
        autoGenerated: true,
        autoSource: "condition",
      });

      await recordScheduledCountryFire(db, scopeId, definition.kind, currentTurn);
      await recordScheduledCountryFire(db, scopeId, HIGH_TENSION_SHARED_LEDGER_KIND, currentTurn);
      return "offered";
    }

    // Generic world-event cards retain the one-pending-per-country cap. Crisis
    // creation above is deliberately independent from the random-event slot.
    if (await hasPendingEvent(db, "country", scopeId)) {
      return "skipped";
    }

    const roll = seededRoll(countryId, currentTurn, definition.kind, "worldEventScheduler");
    const payload: Record<string, unknown> = { countryId };

    let instance;
    try {
      instance = await offerEvent(db, {
        kind: definition.kind,
        scope: "country",
        scopeId,
        definitionVersion: definition.version,
        roll,
        payload,
        offeredAtTurn: currentTurn,
        expiresAtRealtimeMs: computeExpiresAtRealtimeMs(),
      });
    } catch (error) {
      // Another producer (e.g. an admin trigger) raced us onto this scope
      // between the hasPendingEvent check and the insert — skip, not fatal.
      if (error instanceof ActiveEventConflictError) {
        return "skipped";
      }
      throw error;
    }

    await recordScheduledCountryFire(db, scopeId, definition.kind, currentTurn);

    // Notify the sitting executive; a vacant office is a silent no-op, same
    // as the Phase 0 admin-trigger route — the timeout default (safe/neutral
    // per plan §7) applies via the existing sweep either way.
    const leaderCharId = await getHeadOfGovernmentCharacterId(db, countryId);
    if (leaderCharId) {
      const leaderChar = await db
        .collection<Character>("characters")
        .findOne({ _id: leaderCharId }, { projection: { userId: 1 } });
      if (leaderChar?.userId) {
        await notifyCountryExecutiveEventOffered(leaderChar.userId, definition, instance);
      }
    }

    // At most one offer per country per turn — stop after the first fire
    // even if another scheduled definition is also due this turn.
    return "offered";
  }

  return "skipped";
}

/**
 * Per-turn producer for scheduled World Events (Phase 1). Registered
 * alongside `worldEventsMaintenance` in `turnPhaseRegistry.ts`. No-op when
 * `worldEventsEnabled` is off (default) or no schedule-bearing definitions
 * are approved yet.
 */
export async function processWorldEventsTurn(
  db: Db,
  currentTurn: number,
  preloaded?: {
    worldEventsEnabled?: boolean;
    /** In-game year for era gating (minYear/maxYear on definitions). Omit = no era filtering. */
    currentYear?: number;
  }
): Promise<WorldEventsTurnResult> {
  const enabled = await isWorldEventsEnabled(preloaded);
  if (!enabled) {
    return { offered: 0, skipped: 0, globalHostEventsOffered: 0 };
  }
  const currentYear = preloaded?.currentYear;

  // Phase 3: global-host flavor events (Olympics / World's Fair) run first
  // so a host offer claims that country's one-per-turn pending-event slot
  // ahead of the generic independent flavor/decision events below.
  let globalHostEventsOffered = 0;
  for (const config of GLOBAL_HOST_EVENTS) {
    const result = await offerGlobalHostCountryEvent(db, currentTurn, config, currentYear);
    if (result === "offered") {
      globalHostEventsOffered++;
    }
  }

  const definitions = await loadScheduledDefinitions(db);
  if (definitions.length === 0) {
    return { offered: 0, skipped: 0, globalHostEventsOffered };
  }

  // One shared reading for every country this turn. The tension phase runs
  // earlier in the same turn, so this is the fresh value. A world with the
  // cold-war subsystem off holds the baseline, which keeps tension-gated
  // definitions dormant there, which is intentional.
  const currentTension = definitions.some((d) => d.minTension != null || d.maxTension != null)
    ? (await getColdWarTension(db)).value
    : undefined;
  const mitigationByCountry = definitions.some((definition) =>
    isHighTensionSocietyEvent(definition.kind)
  )
    ? await loadActiveWarEmergencyMitigationPctMap(db, currentTurn)
    : new Map<string, number>();

  const activeCountries = COUNTRY_ORDER.filter((id) => COUNTRY_CONFIGS[id].status === "active");

  let offered = 0;
  let skipped = 0;
  for (const countryId of activeCountries) {
    const result = await offerScheduledEventForCountry(
      db,
      countryId,
      currentTurn,
      definitions,
      currentYear,
      currentTension,
      mitigationByCountry.get(countryId) ?? 0
    );
    if (result === "offered") {
      offered++;
    } else {
      skipped++;
    }
  }

  return { offered, skipped, globalHostEventsOffered };
}
