import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CrisisTemplate } from "@/lib/db/types/crisis";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import { getSimulatedCountryIds } from "@/lib/countryAccess";
import { ALL_CRISIS_TEMPLATES, getTemplateDuration } from "./templates";
import {
  GLOBAL_SCOPE_KEY,
  isArmed,
  isOnCooldown,
  loadCooldownMap,
  setArmed,
  stampCooldown,
} from "./autoCrisisCooldown";
import {
  DEFAULT_DISASTER_COOLDOWN_TURNS,
  MAX_AUTO_CRISES_PER_TURN,
  deterministicRoll,
} from "./autoCrisisConstants";
import {
  loadNationalSnapshot,
  evaluateCondition,
  conditionCleared,
  type NationalSnapshot,
} from "./autoCrisisConditions";
import { createCrisisFromTemplate } from "./createCrisisFromTemplate";
import { buildRegionalDisasterEffects } from "./autoDisasterSpawn";
import { regionMatchesTags } from "./regionHazards";
import { isTemplateAllowedInYear } from "./crisisEraWindow";
import { refreshVietnamEscalationLevel } from "./vietnamEscalationInterface";

/** Serializable description of an auto-spawnable template, for the admin tab. */
export interface AutoCrisisCatalogEntry {
  key: string;
  name: string;
  kind: "disaster" | "condition" | "random";
  scope: "region" | "country" | "global";
  cooldownTurns: number;
  countries?: string[];
  excludeCountries?: string[];
  requiresRegionTags?: string[];
  spawnChance?: number;
  conditionSummary?: string;
}

function summarizeCondition(template: CrisisTemplate): string | undefined {
  const trig = template.autoTrigger;
  if (trig?.kind !== "condition") return undefined;
  return trig.condition.all
    .map((c) => {
      const sym = c.op === "lt" ? "<" : ">";
      const window =
        c.metric === "fxDepreciation" && c.windowTurns ? ` over ${c.windowTurns}t` : "";
      const consec =
        c.consecutiveTurns && c.consecutiveTurns > 1 ? ` (${c.consecutiveTurns}t)` : "";
      return `${c.metric} ${sym} ${c.threshold}${window}${consec}`;
    })
    .join(" AND ");
}

/** Every template the automatic systems can spawn (regional disasters +
 *  economic/political triggers), with display metadata. Pure (no DB). */
export function getAutoCrisisCatalog(): AutoCrisisCatalogEntry[] {
  const entries: AutoCrisisCatalogEntry[] = [];
  for (const [key, template] of Object.entries(ALL_CRISIS_TEMPLATES) as [
    string,
    CrisisTemplate,
  ][]) {
    if (template.naturalDisaster) {
      entries.push({
        key,
        name: template.name,
        kind: "disaster",
        scope: "region",
        cooldownTurns: template.disasterCooldownTurns ?? DEFAULT_DISASTER_COOLDOWN_TURNS,
        countries: template.geo?.countries,
        excludeCountries: template.geo?.excludeCountries,
        requiresRegionTags: template.geo?.requiresRegionTags,
      });
    } else if (template.autoTrigger) {
      const trig = template.autoTrigger;
      entries.push({
        key,
        name: template.name,
        kind: trig.kind,
        scope: trig.kind === "random" && trig.scope === "global" ? "global" : "country",
        cooldownTurns: trig.cooldownTurns,
        countries: template.geo?.countries,
        excludeCountries: template.geo?.excludeCountries,
        spawnChance: trig.kind === "random" ? trig.spawnChance : undefined,
        conditionSummary: summarizeCondition(template),
      });
    }
  }
  return entries;
}

/** Country gating from a template's geo (allow-list minus deny-list). */
function countryAllowed(template: CrisisTemplate, countryId: CountryId): boolean {
  const geo = template.geo;
  if (!geo) return true;
  if (geo.countries && !geo.countries.includes(countryId)) return false;
  if (geo.excludeCountries && geo.excludeCountries.includes(countryId)) return false;
  return true;
}

/**
 * Drive the economic/political automatic crises (condition + random tiers).
 * Region-scoped natural/infrastructure disasters are handled separately by
 * `processAutoDisasterSpawn`. Deterministic, cooldown-gated, capped per turn.
 */
export async function processAutoCrisisSpawn(
  db: Db,
  currentTurn: number
): Promise<{ spawned: number }> {
  // Pull the live Vietnam ladder into the synchronous cache the anti-war
  // template's spawn-weight getter reads, so this turn's roll reflects this
  // turn's war rather than whatever the process last saw.
  await refreshVietnamEscalationLevel(db);

  const autoTemplates = (Object.entries(ALL_CRISIS_TEMPLATES) as [string, CrisisTemplate][]).filter(
    ([, t]) => t.autoTrigger
  );
  if (autoTemplates.length === 0) return { spawned: 0 };

  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  // The era gate resolves against the LIVE year, not the seed preset — a
  // preset never changes, so a preset-keyed gate is permanent.
  const currentYear = gs?.currentYear;
  // Sim-only random-tier boost (1 in production). Multiplies the per-template
  // spawnChance so the roll clears more often — condition-tier (metric-driven)
  // crises are unaffected.
  const crisisMult =
    typeof gs?.crisisSpawnChanceMultiplier === "number" && gs.crisisSpawnChanceMultiplier > 0
      ? gs.crisisSpawnChanceMultiplier
      : 1;

  // Status-based, not player-enablement: these fire wherever the engine is
  // simulating, including countries deliberately closed to players.
  const countryIds = await getSimulatedCountryIds(db);
  const cooldowns = await loadCooldownMap(db);
  const snapshotCache = new Map<CountryId, NationalSnapshot>();
  const snap = async (countryId: CountryId): Promise<NationalSnapshot> => {
    let s = snapshotCache.get(countryId);
    if (!s) {
      // Era-gated exactly like the dynamics and energy phases: with the era
      // system off, the metric bands stay modern and the year must not be fed
      // in, or the two halves score the same board differently.
      s = await loadNationalSnapshot(db, countryId, gs?.eraSystemEnabled ? currentYear : null);
      snapshotCache.set(countryId, s);
    }
    return s;
  };

  let spawned = 0;

  // Condition (national) tier first — metric-driven crises take priority over
  // the random tier when the per-turn cap is tight.
  for (const [key, template] of autoTemplates) {
    if (spawned >= MAX_AUTO_CRISES_PER_TURN) break;
    const trig = template.autoTrigger!;
    if (trig.kind !== "condition") continue;
    if (!isTemplateAllowedInYear(template, currentYear)) continue;
    for (const countryId of countryIds) {
      if (spawned >= MAX_AUTO_CRISES_PER_TURN) break;
      if (!countryAllowed(template, countryId)) continue;
      const s = await snap(countryId);
      // Hysteresis latch. A condition crisis disarms itself on spawn and only
      // re-arms once its condition has cleared by `clearMargin`. Several of
      // these crises tick down the very metric their trigger reads (the grid
      // failure is the extreme case), so trigger-only logic made them permanent:
      // the crisis drove the metric past its own threshold, the cooldown
      // expired, and it fired again on damage it had caused itself.
      if (!isArmed(cooldowns, key, countryId)) {
        if (conditionCleared(trig.condition, s)) {
          await setArmed(db, cooldowns, key, countryId, true);
        } else {
          continue;
        }
      }
      if (isOnCooldown(cooldowns, key, countryId, currentTurn, trig.cooldownTurns)) continue;
      if (!evaluateCondition(trig.condition, s)) continue;
      await createCrisisFromTemplate(db, {
        template,
        scope: "country",
        countryIds: [countryId],
        regionIds: [],
        currentTurn,
        autoSource: "condition",
      });
      await stampCooldown(db, cooldowns, key, countryId, currentTurn);
      spawned++;
    }
  }

  // Random tier (national + global).
  for (const [key, template] of autoTemplates) {
    if (spawned >= MAX_AUTO_CRISES_PER_TURN) break;
    const trig = template.autoTrigger!;
    if (trig.kind !== "random") continue;
    if (!isTemplateAllowedInYear(template, currentYear)) continue;

    if (trig.scope === "global") {
      if (isOnCooldown(cooldowns, key, GLOBAL_SCOPE_KEY, currentTurn, trig.cooldownTurns)) continue;
      if (deterministicRoll(currentTurn, key, GLOBAL_SCOPE_KEY) >= trig.spawnChance * crisisMult)
        continue;
      await createCrisisFromTemplate(db, {
        template,
        scope: "global",
        countryIds: [],
        regionIds: [],
        currentTurn,
        autoSource: "random",
      });
      await stampCooldown(db, cooldowns, key, GLOBAL_SCOPE_KEY, currentTurn);
      spawned++;
      continue;
    }

    for (const countryId of countryIds) {
      if (spawned >= MAX_AUTO_CRISES_PER_TURN) break;
      if (!countryAllowed(template, countryId)) continue;
      if (isOnCooldown(cooldowns, key, countryId, currentTurn, trig.cooldownTurns)) continue;
      if (deterministicRoll(currentTurn, key, countryId) >= trig.spawnChance * crisisMult) continue;
      await createCrisisFromTemplate(db, {
        template,
        scope: "country",
        countryIds: [countryId],
        regionIds: [],
        currentTurn,
        autoSource: "random",
      });
      await stampCooldown(db, cooldowns, key, countryId, currentTurn);
      spawned++;
    }
  }

  return { spawned };
}

/**
 * Admin force-trigger: spawn a specific auto-template now, bypassing cooldown
 * and conditions but still stamping the cooldown. Handles all three flavours
 * (regional disaster, condition/random-national, random-global). For regional
 * disasters a geo-valid region in `countryId` is chosen (falls back to any
 * region when none carry the required tags). Returns the new crisis id string.
 */
export async function forceSpawnCrisis(
  db: Db,
  templateKey: string,
  currentTurn: number,
  countryId?: CountryId
): Promise<{ ok: true; crisisId: string } | { ok: false; error: string }> {
  const template = ALL_CRISIS_TEMPLATES[templateKey] as CrisisTemplate | undefined;
  if (!template) return { ok: false, error: "Unknown template" };

  const cooldowns = await loadCooldownMap(db);

  // Regional disaster.
  if (template.naturalDisaster) {
    if (!countryId) return { ok: false, error: "countryId required for a regional disaster" };
    const regions = await db
      .collection<State>("states")
      .find({ countryId, regionType: { $nin: [null, "nation", "constituency"] } } as never)
      .toArray();
    if (regions.length === 0) return { ok: false, error: "No regions for country" };
    const required = template.geo?.requiresRegionTags;
    const valid = regions.filter((r) => regionMatchesTags(countryId, r._id, required));
    const region = (valid.length > 0 ? valid : regions)[0];
    const crisisId = await createCrisisFromTemplate(db, {
      template,
      scope: "region",
      countryIds: [countryId],
      regionIds: [region._id],
      currentTurn,
      autoSource: "disaster",
      effects: buildRegionalDisasterEffects(template),
      durationTurns: getTemplateDuration(template, "region") ?? template.durationTurns ?? null,
    });
    await stampCooldown(db, cooldowns, templateKey, countryId, currentTurn);
    return { ok: true, crisisId: crisisId.toString() };
  }

  const trig = template.autoTrigger;
  const isGlobal = trig?.kind === "random" && trig.scope === "global";

  if (isGlobal) {
    const crisisId = await createCrisisFromTemplate(db, {
      template,
      scope: "global",
      countryIds: [],
      regionIds: [],
      currentTurn,
      autoSource: "random",
    });
    await stampCooldown(db, cooldowns, templateKey, GLOBAL_SCOPE_KEY, currentTurn);
    return { ok: true, crisisId: crisisId.toString() };
  }

  if (!countryId) return { ok: false, error: "countryId required for a national crisis" };
  const crisisId = await createCrisisFromTemplate(db, {
    template,
    scope: "country",
    countryIds: [countryId],
    regionIds: [],
    currentTurn,
    autoSource: trig?.kind === "random" ? "random" : "condition",
  });
  await stampCooldown(db, cooldowns, templateKey, countryId, currentTurn);
  return { ok: true, crisisId: crisisId.toString() };
}
