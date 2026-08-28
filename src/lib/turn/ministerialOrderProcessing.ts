// src/lib/turn/ministerialOrderProcessing.ts
import { getDb } from "@/lib/mongodb";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type { Character, StateMetrics, UnifiedCabinetMember, CabinetSetting } from "@/lib/db/types";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import {
  mapCabinetDeltasToPolitical,
  mapRegionalCabinetDeltasToPolitical,
  addContributions,
  type CabinetSourceId,
} from "@/lib/politicalMetrics/cabinetResidual";
import {
  setPoliticalCabinetContribution,
  type CabinetSourceContribution,
} from "@/lib/db/collections/politicalCabinetContribution";
import {
  getCabinetSettingsCollection,
  getMinisterialOrdersCollection,
} from "@/lib/db/collections/cabinetSettings";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { getCalendarDayInTimezone, shouldApplyDailyReset } from "@/lib/time/dailyReset";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { applyMilitaryForceEffects } from "./militaryForceEffects";
import { resolveBattleDeclarations } from "./battleResolution";
import { resolveColdWarHolds } from "./coldWarHolds";
import { resolvePeaceWindows } from "./peaceWindows";
import { emitWarWire } from "@/lib/military/emitWarWire";
import { processGeneralTenure } from "./generalTenure";
import { applyReinforcement } from "./reinforcement";
import { applyDefenseAppropriation } from "./defenseAppropriationTurn";
import { settleDoctrineIncome } from "@/lib/db/collections/nationalDoctrine";
import { applyDefenceDeliveries } from "./defenceDeliveryTurn";
import { applyDefenceRefit } from "./defenceRefitTurn";
import { applyStateArmsProduction } from "./stateArmsTurn";
import { applyNuclearProduction } from "./nuclearProductionTurn";
import { applyCovertNuclearTurn } from "./covertNuclearTurn";
import { COVERT_CAPABLE } from "@/lib/military/covertNuclear";
import { maxTechTierForPreset } from "@/lib/admin/seed/seedMilitaryUnits";
import { resolveGameYear } from "@/lib/era/era";
import { getGameState } from "@/lib/gameState";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { applyEstateEffects } from "./estateEffects";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "@/lib/constants/cabinetEstates";
import { applyEnergyEffects } from "./energyEffects";
import { ENERGY_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetEnergy";
import { applyInfraEffects } from "./infraEffects";
import { INFRA_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetInfra";
import { applyTreasuryEffects } from "./treasuryEffects";
import { THRESHOLDS } from "@/lib/utils/metricScoring";
import { getBankId } from "@/lib/centralBank/helpers";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CountryId } from "@/lib/constants/countries";
import { expireMinisterialOrders } from "@/lib/cabinet/ministerialOrderLifecycle";

/**
 * Maximum |modifier| any single metric can receive per turn from the
 * combined effect of all active cabinet orders + tier settings + regional
 * targets + advocacy. Without this cap a fully-staffed cabinet stacks
 * 10+ active orders that each $inc the same metric every turn, producing
 * 26%+ runaway gdpGrowth (bug #0571) before the slow policyEffects decay
 * can pull the metric back. The cap stays a HARD per-turn ceiling on combined
 * cabinet pressure (the #0571 guarantee); it was raised 0.05 → 0.08 in #0800 to
 * let the now-non-reabsorbed effects register a little more strongly, while still
 * bounding any single metric well below the uncapped runaway.
 *
 * Exported so the rounding-plateau regression test
 * (cabinetEffectPlateau.test.ts) measures the SAME applied per-turn step the
 * turn phase uses, rather than a drifting copy.
 */
export const MAX_PER_METRIC_MODIFIER_PER_TURN = 0.08;

/**
 * Uniform strength multiplier applied to every cabinet metric effect (orders,
 * tier settings, regional targets, advocacy, emergencies) before the per-metric
 * cap. A single tuning knob (vs editing ~200 authored magnitudes into non-round
 * values) so the whole cabinet system can be balanced in one place. #0800 set it
 * to 1.25 (+25%) once the rounding-plateau fix made effects actually register.
 * Does NOT touch inflation-pressure effects (routed to the central bank before
 * this point) or non-metric values (cost/duration/thresholds).
 */
export const CABINET_EFFECT_STRENGTH = 1.25;

/**
 * Cabinet modifiers (orders, tier settings, regional targets, advocacy) are
 * authored in 0-100-convention points. Metrics on larger real-unit scales
 * (per-100k crimeRate, per-pupil educationSpending) would be inert under the
 * 0.05/turn cap — scale BOTH the applied modifier and the cap by the metric's
 * realistic span (THRESHOLDS, the post-S1 normalization SSOT). Metrics without
 * a THRESHOLDS entry keep scale 1 — bounds spans are clamp guards, not realistic
 * ranges (medianIncome's bounds span ~10M would scale a tick 100,000×; its
 * THRESHOLDS span scales it 750×). Currency-scale metrics like medianIncome
 * get a currency-ABSOLUTE tick out of this — named for the balance pass.
 */
export function modifierSpanScale(metricPath: string): number {
  const leaf = metricPath.includes(".")
    ? metricPath.slice(metricPath.lastIndexOf(".") + 1)
    : metricPath;
  const t = THRESHOLDS[leaf];
  if (!t) return 1;
  return Math.max(1, Math.abs(t.worst - t.best) / 100);
}

/**
 * Effect keys that represent discretionary monetary-policy inflation pressure
 * (pp). These are routed to centralBanks.policyInflationPressure for the
 * inflation model, NOT into stateMetrics. Matched by leaf so all stored forms
 * are caught: bare `inflationPressure`, legacy `inflationRate`, and the resolved
 * `economic.inflationRate` form persisted on in-flight order docs.
 */
const INFLATION_PRESSURE_LEAVES = new Set(["inflationPressure", "inflationRate"]);

function isInflationPressureKey(metric: string): boolean {
  const leaf = metric.includes(".") ? metric.slice(metric.lastIndexOf(".") + 1) : metric;
  return INFLATION_PRESSURE_LEAVES.has(leaf);
}

/**
 * Process ministerial orders and cabinet settings each turn (all countries).
 * - Expire completed orders
 * - Apply active order metric modifiers
 * - Apply tier setting effects
 * - Apply regional target effects
 * - Apply advocacy bonuses
 * - Refill ministerial actions at midnight Eastern Time
 */
export async function processMinisterialOrders(currentTurn: number): Promise<{
  ordersExpired: number;
  ordersActive: number;
  settingsApplied: number;
  actionsRegenerated: number;
}> {
  const db = await getDb();
  const ordersCol = getMinisterialOrdersCollection(db);
  const membersCol = getCabinetMembersCollection(db);
  const settingsCol = getCabinetSettingsCollection(db);

  // 1. Expire completed orders (all countries)
  const { expired: ordersExpired } = await expireMinisterialOrders(db, currentTurn);

  // 2. Fetch active orders for metric application (all countries)
  const activeOrders = await ordersCol.find({ active: true }).toArray();

  // Statecraft: scale each order's effect magnitude by the issuing minister's
  // stat (gentle ±20%). Batch-load the issuers' stats once. Unmigrated ministers
  // (no stat block) and missing characters default to 1.0×. The per-metric cap
  // below still applies after summation, so this only shifts sub-cap outcomes.
  const orderCharIds = [
    ...new Set(activeOrders.map((o) => o.characterId?.toString()).filter((s): s is string => !!s)),
  ].map((s) => new ObjectId(s));
  const statecraftMultByChar = new Map<string, number>();
  if (orderCharIds.length > 0) {
    const issuers = await db
      .collection<Character>("characters")
      .find({ _id: { $in: orderCharIds } }, { projection: { _id: 1, stats: 1 } })
      .toArray();
    for (const c of issuers) {
      statecraftMultByChar.set(
        c._id.toString(),
        statMultiplier(c.stats?.statecraft ?? NEUTRAL_STAT)
      );
    }
  }

  // 3. Accumulate order effects per country
  // Structure: { countryId: { national: {...}, regional: { regionId: {...} } } }
  interface CabinetEffectBucket {
    national: Record<string, number>;
    regional: Record<string, Record<string, number>>;
    // Direct political-family contributions (already in political-point space),
    // e.g. the military force effect's defense-family drive. Merged into the
    // political contribution snapshot for pipeline countries.
    politicalDirect?: Record<string, number>;
  }

  // Ticket #1129: effects are kept SPLIT BY CHANNEL rather than summed into one
  // bucket per country. The macro half re-merges them immediately below (its
  // behaviour is unchanged), but the political half is capped per channel, so a
  // saturated order book no longer makes a newly built estate worth zero.
  const effectsByCountry: Record<
    string,
    Partial<Record<CabinetSourceId, CabinetEffectBucket>>
  > = {};

  function ensureCountry(cid: string) {
    if (!effectsByCountry[cid]) effectsByCountry[cid] = {};
  }

  function sourceBucket(cid: string, source: CabinetSourceId): CabinetEffectBucket {
    ensureCountry(cid);
    const forCountry = effectsByCountry[cid];
    return (forCountry[source] ??= { national: {}, regional: {} });
  }

  /** All channels summed: the shape the macro $inc path has always consumed. */
  function mergedBucket(
    forCountry: Partial<Record<CabinetSourceId, CabinetEffectBucket>>
  ): CabinetEffectBucket {
    const merged: CabinetEffectBucket = { national: {}, regional: {} };
    for (const bucket of Object.values(forCountry)) {
      if (!bucket) continue;
      for (const [metric, v] of Object.entries(bucket.national)) {
        merged.national[metric] = (merged.national[metric] ?? 0) + v;
      }
      for (const [regionId, deltas] of Object.entries(bucket.regional)) {
        const into = (merged.regional[regionId] ??= {});
        for (const [metric, v] of Object.entries(deltas)) into[metric] = (into[metric] ?? 0) + v;
      }
    }
    return merged;
  }

  /** Per-country discretionary inflation pressure (pp), summed from stance + orders + emergency. */
  const policyInflationByCountry: Record<string, number> = {};

  for (const order of activeOrders) {
    const bucket = sourceBucket(order.countryId, "orders");
    const orderMult = statecraftMultByChar.get(order.characterId?.toString() ?? "") ?? 1;
    for (const effect of order.effects) {
      const scaledModifier = effect.modifier * orderMult;
      if (isInflationPressureKey(effect.metric)) {
        // Inflation is a national monetary concept — route to the central bank
        // regardless of the effect's declared scope (emergency effects are
        // stored as regional but inflation has no per-region meaning).
        policyInflationByCountry[order.countryId] =
          (policyInflationByCountry[order.countryId] ?? 0) + scaledModifier;
        continue;
      }
      if (effect.scope === "national") {
        bucket.national[effect.metric] = (bucket.national[effect.metric] ?? 0) + scaledModifier;
      } else if (effect.scope === "regional" && effect.regionId) {
        if (!bucket.regional[effect.regionId]) bucket.regional[effect.regionId] = {};
        bucket.regional[effect.regionId][effect.metric] =
          (bucket.regional[effect.regionId][effect.metric] ?? 0) + scaledModifier;
      }
    }
  }

  // 4. Fetch and apply cabinet settings effects (all countries)
  const allSettings = await settingsCol
    .find({})
    .project<
      Pick<
        CabinetSetting,
        | "_id"
        | "countryId"
        | "positionId"
        | "tierSetting"
        | "tierSettings"
        | "targetRegionId"
        | "advocacyActive"
      >
    >({
      _id: 1,
      countryId: 1,
      positionId: 1,
      tierSetting: 1,
      tierSettings: 1,
      targetRegionId: 1,
      advocacyActive: 1,
    })
    .toArray();
  let settingsApplied = 0;

  for (const setting of allSettings) {
    const mechanics = getCabinetMechanics(setting.countryId, setting.positionId);
    if (!mechanics) continue;

    const bucket = sourceBucket(setting.countryId, "settings");

    const positionMetrics = [...mechanics.nationalMetrics, ...mechanics.regionalMetrics];

    // Apply a resolved tier option's effects to national metrics / inflation.
    const applyTierEffects = (effects: Record<string, number>) => {
      for (const [metric, modifier] of Object.entries(effects)) {
        if (isInflationPressureKey(metric)) {
          policyInflationByCountry[setting.countryId] =
            (policyInflationByCountry[setting.countryId] ?? 0) + modifier;
          continue;
        }
        const path = resolveMetricPath(metric, positionMetrics);
        bucket.national[path] = (bucket.national[path] ?? 0) + modifier;
      }
    };

    // Tier setting effects (national) — primary lever
    if (setting.tierSetting && mechanics.tierSetting) {
      const tier = mechanics.tierSetting.options.find((o) => o.id === setting.tierSetting);
      if (tier) {
        applyTierEffects(tier.effects);
        settingsApplied++;
      }
    }

    // Extra portfolio levers (e.g. HEW education + welfare). Each selection is
    // keyed by its tier's `key`; unset keys fall through to no effect (default).
    if (setting.tierSettings && mechanics.tierSettings) {
      for (const cfg of mechanics.tierSettings) {
        if (!cfg.key) continue;
        const selectedId = setting.tierSettings[cfg.key];
        if (!selectedId) continue;
        const option = cfg.options.find((o) => o.id === selectedId);
        if (option) {
          applyTierEffects(option.effects);
          settingsApplied++;
        }
      }
    }

    // Regional target effects
    if (setting.targetRegionId && mechanics.regionalTarget) {
      const rid = setting.targetRegionId;
      if (!bucket.regional[rid]) bucket.regional[rid] = {};
      for (const [metric, modifier] of Object.entries(mechanics.regionalTarget.effects)) {
        const path = resolveMetricPath(metric, positionMetrics);
        bucket.regional[rid][path] = (bucket.regional[rid][path] ?? 0) + modifier;
      }
      // Non-target effects (e.g., policing zero-sum)
      if (mechanics.regionalTarget.nonTargetEffects) {
        const countryStates = await db
          .collection("states")
          .find({ countryId: setting.countryId })
          .project({ _id: 1 })
          .toArray();
        for (const state of countryStates) {
          if (state._id === rid) continue;
          if (!bucket.regional[state._id]) bucket.regional[state._id] = {};
          for (const [metric, modifier] of Object.entries(
            mechanics.regionalTarget.nonTargetEffects
          )) {
            const path = resolveMetricPath(metric, positionMetrics);
            bucket.regional[state._id][path] = (bucket.regional[state._id][path] ?? 0) + modifier;
          }
        }
      }
      settingsApplied++;
    }

    // Advocacy toggle (territorial secretaries)
    if (setting.advocacyActive && mechanics.advocacy) {
      const rid = mechanics.advocacy.regionId;
      if (!bucket.regional[rid]) bucket.regional[rid] = {};
      for (const [metric, modifier] of Object.entries(mechanics.advocacy.effects)) {
        const path = resolveMetricPath(metric, positionMetrics);
        bucket.regional[rid][path] = (bucket.regional[rid][path] ?? 0) + modifier;
      }
      settingsApplied++;
    }
  }

  // 4a-iii. Defence appropriation — accrue each country's slice of its enacted defence
  // line and fund the standing force's upkeep from it, drawing the overdraft as national
  // debt when it will not stretch.
  //
  // Placed immediately BEFORE 4b, which is the one real ordering constraint: that loop
  // drifts readiness toward a baseline this step suppresses, so it must see THIS turn's
  // arrears ratio rather than last turn's. It deliberately does NOT need to follow
  // reinforcement below — `computeEffectiveUpkeep` reads only upkeepBase/posture/techTier,
  // so a change in manning does not change what a force costs.
  //
  // Covers EVERY country with units, the same reach as reinforcement at 4b-iii and
  // deliberately not 4b's seat-only reach: a nation whose army is fed manpower but never
  // charged for it would be a standing asymmetry between the two sweeps.
  const appropriationPreset = await getGameStatePresetOrDefault(db);
  for (const cid of Object.keys(DEFENSE_POSITION_BY_COUNTRY)) {
    await applyDefenseAppropriation(db, cid, currentTurn, appropriationPreset);
  }

  // 4a-iv. Defence industry — active contracts deliver what their plants produced into the
  // national arsenal, paid for out of the appropriation accrued immediately above; then the
  // arsenal refits whatever is under-equipped.
  //
  // Delivery MUST follow the accrual: it spends the balance that step just credited, and
  // procurement has no overdraft, so running it first would stall every contract on turn one
  // of a fresh world. Refit follows delivery for the same reason — materiel has to arrive
  // before it can be issued.
  //
  // Same reach as the sweep above and as reinforcement: every country with units.
  const defenceGameState = await getGameState(db);
  const defenceYear = defenceGameState
    ? (resolveGameYear(defenceGameState) ?? undefined)
    : undefined;
  const defenceEraMaxGrade = maxTechTierForPreset(appropriationPreset);
  for (const cid of Object.keys(DEFENSE_POSITION_BY_COUNTRY)) {
    if (defenceYear != null) {
      await applyDefenceDeliveries(db, cid, defenceYear, defenceEraMaxGrade, currentTurn);
    }
    // Planned-defence economies have no contract pipeline for `applyDefenceDeliveries` to
    // run, so their store is fed here instead. Before the refit for the same reason
    // delivery is: materiel has to arrive before it can be issued. A no-op for every
    // country not on the state-arms roster.
    await applyStateArmsProduction(db, cid);
    await applyDefenceRefit(db, cid);
    // Nuclear stockpile accrual, right after refit so it competes for the same
    // appropriation AFTER conventional deliveries have settled: a nation short
    // of rifles equips the army before it grows the arsenal of last resort.
    // Gates itself on coldWarEnabled and the procurement kill switch via the
    // preloaded flags; countries with no programme return without a write.
    if (defenceYear != null) {
      await applyNuclearProduction(db, cid as CountryId, defenceYear, currentTurn, {
        coldWarEnabled: defenceGameState?.coldWarEnabled,
        defenceProcurementPaused: defenceGameState?.defenceProcurementPaused,
      });
    }
    // The covert grind, for the few countries that can run one. Skips without
    // a write when the programme was never opened. Deliberately not behind the
    // procurement pause: covert funding is off the books by design.
    if (COVERT_CAPABLE.includes(cid as CountryId)) {
      await applyCovertNuclearTurn(db, cid as CountryId, currentTurn, {
        coldWarEnabled: defenceGameState?.coldWarEnabled,
      });
    }
  }

  // Yearly doctrine-point income. Same reach as the appropriation sweep: every
  // country in the defense map, seat or not — points sit unused until a seat
  // exists, and a later-enabled seat must not start from a frozen 12.
  const doctrineStartYear = defenceGameState?.startingYear;
  if (defenceYear != null && doctrineStartYear != null) {
    for (const cid of Object.keys(DEFENSE_POSITION_BY_COUNTRY)) {
      await settleDoctrineIncome(db, cid, doctrineStartYear, defenceYear);
    }
  }

  // 4b. Defense military force effects — aggregate each country's force into the
  // same per-country bucket (upkeep burden → budget balance; power/readiness
  // → public-safety confidence; posture tilt → trust/cohesion) and drift readiness.
  for (const cid of Object.keys(DEFENSE_POSITION_BY_COUNTRY)) {
    if (!DEFENSE_POSITION_BY_COUNTRY[cid as keyof typeof DEFENSE_POSITION_BY_COUNTRY]) continue;
    ensureCountry(cid);
    await applyMilitaryForceEffects(db, cid, sourceBucket(cid, "military"), appropriationPreset);
  }

  // 4b-ii. Resolve declared theater offensives (Conflicts). Declarations made on an
  // earlier turn resolve now against the target's real units, persisting outcomes to
  // both nations' live units + reports. Gated upstream by conflictsEnabled at declare time.
  await resolveBattleDeclarations(db, currentTurn);

  // 4b-ii-a. Resolve proxy wars pinned at a pole for three turns. AFTER the battles,
  // so a front pushed off the pole this turn has already cleared its stamp and does
  // not resolve for a side that no longer holds it.
  //
  // A turn step and not a check inside `applyOccupation`, because that only runs when
  // a battle MOVES the front: once a side is pinned at 100 the front cannot move
  // further, nothing would re-enter it, and the timer would never fire. The hold has
  // to be measured on turns where nobody fought at all. It reads `conflictsEnabled`
  // itself — it is the only conflict step with no declaration upstream to gate it.
  await resolveColdWarHolds(db, currentTurn);

  // 4b-ii-a-ii. White-peace any won war whose dictate window has lapsed. A real
  // sweep rather than lazy expiry: nothing forces a victor to open the conflict
  // document, so a window nobody answered would leave the war frozen for ever with
  // both rosters already stood down.
  await resolvePeaceWindows(db, currentTurn);

  // 4b-ii-a-iii. Report every war that has settled since the last tick. Reached from
  // a STAMP rather than from the command that settled the war: both roads to a
  // settlement are request paths, and a news post made from a request would put a
  // network call on a player's request and fire again on a retry.
  await emitWarWire(db, currentTurn);

  // 4b-ii-b. Tenure skill points for commissioned generals. Placed AFTER battle
  // resolution so a general promoted by this turn's fighting is already at their new
  // level when tenure pays out, and the two grants never race for the same profile
  // write. Country-agnostic — every corps accrues, whether or not it fought.
  await processGeneralTenure(db, currentTurn);

  // 4b-iii. Replacement flow: regenerate each nation's manpower pool and top up
  // under-strength units. Runs AFTER battle resolution so the turn reads fight →
  // losses → rebuild — a formation mauled above starts rebuilding here, in place,
  // still under its own general. Deliberately covers EVERY country, not just those
  // with a defense seat — simulated nations must sustain their forces too.
  for (const cid of Object.keys(DEFENSE_POSITION_BY_COUNTRY)) {
    await applyReinforcement(db, cid);
  }

  // 4c. Cabinet estates — per in-scope (country, seat): domestic estates tilt their
  // sited region's metrics, foreign estates tilt national soft-power, upkeep-vs-envelope
  // tilts national budget balance, and condition drifts toward the funding baseline.
  for (const [cid, seats] of Object.entries(ESTATE_PORTFOLIO_BY_COUNTRY)) {
    if (!seats) continue;
    ensureCountry(cid);
    for (const positionId of Object.keys(seats)) {
      await applyEstateEffects(db, cid, positionId, sourceBucket(cid, "estates"));
    }
  }

  // 4d. Cabinet energy — per energy seat, regional plant mixes nudge that region's
  // renewable/carbon/reliability metrics toward mix targets; fleet upkeep vs the
  // energy envelope tilts national budget balance.
  for (const [cid, positionId] of Object.entries(ENERGY_POSITION_BY_COUNTRY)) {
    if (!positionId) continue;
    ensureCountry(cid);
    await applyEnergyEffects(db, cid, positionId, sourceBucket(cid, "energy"));
  }

  // 4e. Cabinet infrastructure — advance each transportation seat's project pipeline
  // (construction → operational), operational projects tilt their region's infra
  // metrics, and committed spend vs the transportation envelope tilts budget balance.
  for (const [cid, positionId] of Object.entries(INFRA_POSITION_BY_COUNTRY)) {
    if (!positionId) continue;
    ensureCountry(cid);
    await applyInfraEffects(db, cid, positionId, sourceBucket(cid, "infrastructure"), currentTurn);
  }

  // 4f. Cabinet monetary — accelerate investor-confidence recovery for any country
  // with an active Debt Management Operation (writes federalBudget.investorConfidence
  // directly, clamped at baseline; closes expired ops). No active ops ⇒ no-op.
  await applyTreasuryEffects(db, currentTurn);

  // 5. Apply all accumulated effects to region metrics, per country
  const macroMetricsBulkOps: AnyBulkWriteOperation<StateMetrics>[] = [];

  for (const [countryId, sourceBuckets] of Object.entries(effectsByCountry)) {
    const bucket = mergedBucket(sourceBuckets);
    const stateIds = (
      await db.collection("states").find({ countryId }).project({ _id: 1 }).toArray()
    ).map((s) => s._id);

    for (const stateId of stateIds) {
      const combinedEffects: Record<string, number> = { ...bucket.national };
      if (bucket.regional[stateId]) {
        for (const [metric, modifier] of Object.entries(bucket.regional[stateId])) {
          combinedEffects[metric] = (combinedEffects[metric] ?? 0) + modifier;
        }
      }

      if (Object.keys(combinedEffects).length === 0) continue;

      // Build $inc update: metricPath "economic.gdpGrowth" → "economic.gdpGrowth.value"
      // Apply the uniform strength multiplier, THEN cap the per-turn modifier per
      // metric so cabinet stacking can't produce runaway compounding against the
      // slow policyEffects decay loop.
      // Macro paths only. The political half of a cabinet order used to $inc a
      // legacy doc; no country has one, so it wrote nowhere.
      //
      // National political deltas are snapshotted ONCE below
      // (`mapCabinetDeltasToPolitical(bucket.national)`). Folding them here
      // would double-drive the same effect and multiply it by the region count.
      // Regional political deltas (estates, regional orders/targets) are
      // snapshotted separately as `regional[stateId]` so a Field Office in CA
      // tilts only CA.
      const macroInc: Record<string, number> = {};
      for (const [metricPath, modifier] of Object.entries(combinedEffects)) {
        if (!isMacroMetricPath(metricPath)) continue;
        const boosted = modifier * CABINET_EFFECT_STRENGTH;
        const capped = Math.max(
          -MAX_PER_METRIC_MODIFIER_PER_TURN,
          Math.min(MAX_PER_METRIC_MODIFIER_PER_TURN, boosted)
        );
        macroInc[`${metricPath}.value`] = capped * modifierSpanScale(metricPath);
      }

      if (Object.keys(macroInc).length > 0) {
        macroMetricsBulkOps.push({
          updateOne: {
            filter: { _id: stateId },
            update: { $inc: macroInc },
          },
        });
      }
    }

    // Political-pipeline countries: the loop above only $incs macro paths, so the
    // political half of cabinet deltas goes nowhere there. Snapshot national
    // standing effects plus per-region extras; the dynamics step folds
    // national+regional[id] into that region's cabinetResiduals. Persist even
    // when empty so a cleared cabinet (or a demolished estate) lets the residual
    // decay away.
    if (isPoliticalApprovalCountry(countryId)) {
      // Cabinet StateMetrics deltas (mapped via the key→family table) + direct
      // political contributions (the military force effect's defense-family drive).
      //
      // Split by channel (ticket #1129) so the dynamics step can cap each one
      // on its own. The flat `contribution`/`regional` fields stay the SUM of
      // the channels, so every other reader sees exactly what it always did.
      const sources: Record<string, CabinetSourceContribution> = {};
      let politicalContribution: Record<string, number> = {};
      const regionalPolitical: Record<string, Record<string, number>> = {};
      for (const [source, sourceEffects] of Object.entries(sourceBuckets)) {
        if (!sourceEffects) continue;
        const contribution = addContributions(
          mapCabinetDeltasToPolitical(sourceEffects.national),
          sourceEffects.politicalDirect ?? {}
        );
        const regional = mapRegionalCabinetDeltasToPolitical(sourceEffects.regional);
        if (Object.keys(contribution).length === 0 && Object.keys(regional).length === 0) continue;
        sources[source] = { contribution, regional };
        politicalContribution = addContributions(politicalContribution, contribution);
        for (const [regionId, deltas] of Object.entries(regional)) {
          regionalPolitical[regionId] = addContributions(regionalPolitical[regionId] ?? {}, deltas);
        }
      }
      await setPoliticalCabinetContribution(
        db,
        countryId,
        politicalContribution,
        currentTurn,
        regionalPolitical,
        sources
      );
    }
  }

  if (macroMetricsBulkOps.length > 0) {
    await db.collection<StateMetrics>("macroMetrics").bulkWrite(macroMetricsBulkOps);
  }

  // Persist discretionary monetary-policy inflation pressure per bank (steady-state pp).
  // Aggregated by bankId so intorg-shared banks sum member-country stances. Written for
  // EVERY bank (0 default) so a reverted stance or expired order clears the pressure.
  const pressureByBank: Record<string, number> = {};
  for (const [cid, pressure] of Object.entries(policyInflationByCountry)) {
    const bankId = getBankId(cid as CountryId);
    pressureByBank[bankId] = (pressureByBank[bankId] ?? 0) + pressure;
  }
  const allBanks = await db
    .collection<CentralBank>("centralBanks")
    .find({}, { projection: { _id: 1 } })
    .toArray();
  if (allBanks.length > 0) {
    await db.collection<CentralBank>("centralBanks").bulkWrite(
      allBanks.map((b) => ({
        updateOne: {
          filter: { _id: b._id },
          update: { $set: { policyInflationPressure: pressureByBank[b._id] ?? 0 } },
        },
      }))
    );
  }

  // 6. Refill ministerial actions to cap at midnight Eastern Time — all countries
  let actionsRegenerated = 0;
  const todayEastern = getCalendarDayInTimezone(new Date());
  const allMembers = await membersCol
    .find({})
    .project<
      Pick<UnifiedCabinetMember, "_id" | "ministerialActions" | "lastMinisterialActionResetDay">
    >({
      _id: 1,
      ministerialActions: 1,
      lastMinisterialActionResetDay: 1,
    })
    .toArray();
  const membersBulkOps: AnyBulkWriteOperation<UnifiedCabinetMember>[] = [];

  for (const member of allMembers) {
    if (!shouldApplyDailyReset(member.lastMinisterialActionResetDay)) continue;
    membersBulkOps.push({
      updateOne: {
        filter: { _id: member._id },
        update: {
          $set: {
            ministerialActions: MINISTERIAL_ACTION_CAP,
            lastMinisterialActionResetDay: todayEastern,
          },
        },
      },
    });
    actionsRegenerated++;
  }

  if (membersBulkOps.length > 0) {
    await membersCol.bulkWrite(membersBulkOps);
  }

  return {
    ordersExpired,
    ordersActive: activeOrders.length,
    settingsApplied,
    actionsRegenerated,
  };
}
