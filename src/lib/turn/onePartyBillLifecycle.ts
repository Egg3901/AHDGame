/**
 * One-Party State Bill Lifecycle Processor
 *
 * Called once per turn. Iterates every country with
 * `governmentType: "onePartyState"` and handles expired bill votes.
 * One-party states are unicameral by default (CN) — bills originate and
 * pass in the lower chamber only, with no assent delay. Bicameral one-party
 * configs (RU: `legislature.bicameral` + `upperElectionSystem`) run the JP
 * crossover instead (D8/D9): a bill must clear BOTH chambers, each by the
 * cast-votes majority rule; a second-chamber rejection kills the bill (no
 * override chamber in a one-party state).
 *
 * Also drives the per-turn ruling-party confidence drift: any bills
 * enacted this turn become policy-alignment inputs, and any unprocessed
 * purge events recorded against the country are folded in and marked
 * processed once consumed.
 */

import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  type CountryConfig,
  type CountryId,
} from "@/lib/constants/countries";
import type { PurgeEvent } from "@/lib/turn/rulingPartyPriorities";

import { processRulingPartyConfidenceTurn } from "@/lib/turn/rulingPartyConfidenceTurn";
import { ensureLeaderStateExists } from "@/lib/turn/rulingPartyConfidence";
import { processPopularLegitimacyTurn } from "@/lib/turn/popularLegitimacyTurn";
import { processRegimeEscalationTurn } from "@/lib/turn/regimeEscalationTurn";
// Side-effect import: registers all stage decision-event handlers with
// the central registry. Must run before resolveActiveDecision /
// expireDecisionsForTurn dispatch into the registry.
import "@/lib/onePartyState/decisionEvents";
import {
  collectEconomicSignalsForCountry,
  collectElectionCredibilitySignals,
  collectInternalRepressionSignals,
  mapPurgeEventsToInput,
  mapEnactedBillsToInput,
} from "@/lib/turn/popularLegitimacyDriverCollectors";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import { DEFAULT_POLICY_AXIS_EFFECTS } from "@/lib/turn/rulingPartyPriorities";
import { INITIAL_POPULAR_LEGITIMACY } from "@/lib/turn/popularLegitimacy";
import { getCountryState } from "@/lib/countryState";
import { getCountryStateCollection } from "@/lib/db/collections/countryState";
import { runBillLifecycle } from "@/lib/turn/billLifecycle/engine";
import { buildOnePartyBillConfig } from "@/lib/turn/billLifecycle/configs/oneParty";

/**
 * Process expired lower-chamber bills for a single one-party country.
 * This is the per-country entry point used by the COUNTRY_BILL_PHASES
 * registry — each one-party country (today: CN) registers its own
 * binding to this function.
 *
 * Runtime gating: reads governmentType from the countryState collection,
 * not COUNTRY_CONFIGS, so a country that has been converted out of
 * onePartyState (Stage-4 collapse / convention ratification) stops
 * processing immediately.
 */
export async function processOnePartyBillLifecycleForCountry(
  countryId: CountryId,
  now: Date
): Promise<{ enacted: number; failed: number }> {
  if (!COUNTRY_CONFIGS[countryId]) return { enacted: 0, failed: 0 };
  const db = await getDb();
  const runtime = await getCountryState(db, countryId);
  if (runtime.governmentType !== "onePartyState") {
    return { enacted: 0, failed: 0 };
  }
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;
  // Era-resolved, not the flat table: legislature SHAPE is preset-dependent, and this
  // config decides `upperKey` — and therefore `originChambers`, which every stage's
  // expired-filter scopes on.
  const preset = typeof gameState?.preset === "string" ? gameState.preset : undefined;
  const config = getCountryConfig(countryId, preset);
  return processCountryBills(db, config, now, currentTurn, preset);
}

/**
 * Process expired one-party-state lower-chamber bills across every
 * runtime one-party country in a single call. Useful for one-shot admin
 * tools and tests; production routes through the per-country registry
 * above to stay symmetric with UK/JP/DE.
 *
 * Queries the countryState collection (not COUNTRY_CONFIGS) so a
 * mid-game system conversion immediately removes a country from the
 * iteration set.
 */
export async function processOnePartyBillLifecycle(now: Date): Promise<{
  enacted: number;
  failed: number;
}> {
  const db = await getDb();
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;

  const onePartyStates = await getCountryStateCollection(db)
    .find({ governmentType: "onePartyState" })
    .toArray();
  // Era-resolved per country: legislature shape is preset-dependent, and the config
  // decides `upperKey` and therefore `originChambers`.
  const preset = typeof gameState?.preset === "string" ? gameState.preset : undefined;
  const onePartyCountries = onePartyStates
    .map((s) => (COUNTRY_CONFIGS[s.countryId] ? getCountryConfig(s.countryId, preset) : undefined))
    .filter((c): c is CountryConfig => !!c);

  let totalEnacted = 0;
  let totalFailed = 0;

  for (const config of onePartyCountries) {
    const result = await processCountryBills(db, config, now, currentTurn, preset);
    totalEnacted += result.enacted;
    totalFailed += result.failed;
  }

  return { enacted: totalEnacted, failed: totalFailed };
}

async function processCountryBills(
  db: Db,
  config: CountryConfig,
  now: Date,
  currentTurn: number,
  preset?: string
): Promise<{ enacted: number; failed: number }> {
  const countryId = config.id;

  // Self-heal the ruling-party leader-state row up-front so the three
  // drift / escalation calls below see a row to read. Without this,
  // an admin-formed PM (governmentFormations set but no leader-state
  // ever installed via installNewLeader) bypasses every regime tick
  // silently. ensureLeaderStateExists is a no-op when the row exists.
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (gov?.pmCharacterId) {
    await ensureLeaderStateExists(db, countryId, gov.pmCharacterId, currentTurn).catch((err) =>
      console.error(`${countryId} leader-state self-heal on per-turn tick failed:`, err)
    );
  }

  // Resolve this country's expired lower-chamber bills through the unified engine
  // (single vote → immediate enact; votes scoped + snapshotted, #0836/#0982). The
  // engine returns the enacted categories the regime drifts below consume.
  const engineResult = await runBillLifecycle(
    db,
    buildOnePartyBillConfig(config, preset),
    now,
    currentTurn
  );
  const enacted = engineResult.transitionedTo.signed ?? 0;
  const failed = engineResult.transitionedTo.failed ?? 0;
  const enactedCategories = engineResult.enactedCategories;

  // ── Popular legitimacy drift ────────────────────────────────────────────
  // Ticks BEFORE the ruling-party confidence drift so Phase 3's
  // popular→party coupling reads a fresh popularLegitimacy value. No-op
  // when the country lacks a popularMoodProfile (set on the one-party states
  // — CN, RU and DD — today).
  await processCountryPopularDrift(db, config, currentTurn, enactedCategories).catch((err) =>
    console.error(`${countryId} popular legitimacy drift failed:`, err)
  );

  // ── Ruling-party confidence drift ───────────────────────────────────────
  // Fold this turn's enacted policy categories plus any unprocessed admin
  // purge events into the country's leader confidence state. Mark the
  // purges processed once consumed so drift is not double-counted next turn.
  // The confidence turn reads the freshly-updated popularLegitimacy
  // (from the popular drift above) for its coupling-bleed input.
  await processCountryConfidenceDrift(db, countryId, currentTurn, enactedCategories).catch((err) =>
    console.error(`${countryId} confidence drift failed:`, err)
  );

  // ── Regime escalation tick ──────────────────────────────────────────────
  // Reads the post-drift popularLegitimacy + partyConfidence values to
  // update dwell counters + advance stage transitions + offer decision
  // events. Self-heals a "stable" row on first tick so existing CN games
  // pick up the state machine without an explicit seed.
  await processCountryEscalation(db, countryId, currentTurn).catch((err) =>
    console.error(`${countryId} escalation tick failed:`, err)
  );

  return { enacted, failed };
}

/**
 * Per-turn regime-escalation tick. Reads the leader's post-drift
 * popularLegitimacy + partyConfidence from the leader-state collection
 * and feeds them to the escalation state machine.
 *
 * No-op when no leader is installed yet (escalation starts at stable
 * once the first leader takes office).
 */
async function processCountryEscalation(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<void> {
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov?.pmCharacterId) return;

  const leaderState = await getCountryLeaderStatesCollection(db).findOne({
    countryId,
    leaderCharacterId: gov.pmCharacterId,
  });
  if (!leaderState) return;

  await processRegimeEscalationTurn({
    db,
    countryId,
    popularLegitimacy: leaderState.popularLegitimacy ?? INITIAL_POPULAR_LEGITIMACY,
    partyConfidence: leaderState.partyConfidence,
    rulingLeaderCharacterId: gov.pmCharacterId,
    currentTurn,
  });
}

/**
 * Per-turn popular-legitimacy drift. Gathers economic / repression /
 * policy / election-credibility inputs via the collectors, then delegates
 * to `processPopularLegitimacyTurn` for the math + persistence.
 *
 * Currently no-ops for countries without `popularMoodProfile` on their
 * CountryConfig (which means CN is the only consumer today). The
 * election-credibility hint is "no election this turn" for v1; Phase 6
 * wires the actual election-turn detection.
 */
async function processCountryPopularDrift(
  db: Db,
  config: CountryConfig,
  currentTurn: number,
  enactedCategories: string[]
): Promise<void> {
  const countryId = config.id;

  // Need the current leader to write the per-leader scalar
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov?.pmCharacterId) return;

  const purgeColl = db.collection<PurgeEvent>("rulingPartyPurgeEvents");
  const pendingPurges = await purgeColl.find({ countryId, processed: false }).toArray();

  const [economic, election, internalRepression] = await Promise.all([
    collectEconomicSignalsForCountry(db, countryId),
    collectElectionCredibilitySignals(db, countryId, currentTurn, {
      opsMultiplier: null,
      isElectionTurn: false,
    }),
    collectInternalRepressionSignals(db, countryId),
  ]);

  await processPopularLegitimacyTurn({
    db,
    countryId,
    leaderCharacterId: gov.pmCharacterId,
    currentTurn,
    economic,
    purges: mapPurgeEventsToInput(pendingPurges),
    enactedBills: mapEnactedBillsToInput(
      enactedCategories,
      config.policyAxisEffects ?? DEFAULT_POLICY_AXIS_EFFECTS
    ),
    election,
    internalRepression,
  });
}

async function processCountryConfidenceDrift(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  policyCategories: string[]
): Promise<void> {
  const purgeColl = db.collection<PurgeEvent>("rulingPartyPurgeEvents");
  const pendingPurges = await purgeColl.find({ countryId, processed: false }).toArray();

  const result = await processRulingPartyConfidenceTurn(
    db,
    countryId,
    currentTurn,
    policyCategories,
    pendingPurges
  );

  // Only mark purges processed if the drift actually applied. If no leader
  // is installed yet, leave them queued so the first PM's mandate inherits
  // the backlog.
  if (result && pendingPurges.length > 0) {
    const ids = pendingPurges.map((p) => p._id).filter((id): id is string => !!id);
    if (ids.length > 0) {
      await purgeColl.updateMany({ _id: { $in: ids } }, { $set: { processed: true } });
    }
  }
}

/**
 * Legacy alias for the pre-rename function name. Bound to CN so the
 * per-country registry entry stays single-country.
 *
 * @deprecated Use `processOnePartyBillLifecycleForCountry("CN", now)` instead.
 */
export const processCNBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("CN", now);

/**
 * RU registry binding — the one-party lifecycle with the crossover branch
 * active (RU is bicameral with a contested upper chamber, D8/D9).
 */
export const processRUBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("RU", now);

/**
 * DD registry binding — the GDR Volkskammer one-party lifecycle (unicameral,
 * CN pattern; no upper-chamber crossover). Bound to DD so the per-country
 * registry entry stays single-country.
 */
export const processDDBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("DD", now);

/** Eastern-bloc unicameral one-party lifecycle bindings (DD/CN pattern). */
export const processPLBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("PL", now);
export const processCSBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("CS", now);
export const processHUBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("HU", now);
export const processROBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("RO", now);
export const processBGBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("BG", now);
export const processYUBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("YU", now);

/**
 * Union-republic Supreme Soviet bindings. Unicameral like the satellites: the
 * Presidium is a standing organ of the same chamber, not a second house, so
 * there is no D8/D9 crossover branch the way RU's own bicameral Supreme Soviet
 * has one.
 */
export const processUKRBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("UKR", now);
export const processBLRBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("BLR", now);
export const processBALBillLifecycle = (now: Date) =>
  processOnePartyBillLifecycleForCountry("BAL", now);
