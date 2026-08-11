import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Crisis, CrisisEffect, CrisisTemplate } from "@/lib/db/types/crisis";
import type { CountryGameState, GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import {
  AUTO_DISASTER_CADENCE_TURNS,
  AUTO_DISASTER_DEFAULT_DURATION_TURNS,
  AUTO_DISASTER_MARGIN_PENALTY,
} from "./autoDisasterConstants";
import { DEFAULT_DISASTER_COOLDOWN_TURNS } from "./autoCrisisConstants";
import { disasterTemplatesForCountry } from "./selectDisasterTemplate";
import { getTemplateDuration } from "./templates";
import { regionMatchesTags } from "./regionHazards";
import { loadCooldownMap, isOnCooldown, stampCooldown } from "./autoCrisisCooldown";
import { floorCrisisDuration } from "./crisisDuration";
import { interpolateLocation } from "./crisisLocation";
import { isTemplateAllowedInYear } from "./crisisEraWindow";

/** Stable hash of countryId → [0, cadence) offset so countries stagger. */
export function staggerHash(countryId: string): number {
  let h = 0;
  for (let i = 0; i < countryId.length; i++) {
    h = (h * 31 + countryId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % AUTO_DISASTER_CADENCE_TURNS;
}

/**
 * True when `countryId` is due for its next automatic disaster.
 *
 * For a country that has already had one, the anchor is `lastDisasterTurn` and
 * it fires every `AUTO_DISASTER_CADENCE_TURNS`. For a fresh country (undefined
 * `lastDisasterTurn`), the anchor is `staggerHash(countryId) - CADENCE`, so the
 * first disaster fires once `currentTurn >= staggerHash(countryId)` — i.e.
 * staggered within the first cadence window rather than all firing in lockstep.
 *
 * NB: this intentionally differs from the original implementation plan, whose
 * `anchor = currentTurn - staggerHash` formula would make a fresh country never
 * become due (diff would always be `staggerHash < CADENCE`). Do not "restore"
 * the plan's version.
 */
export function shouldSpawn(
  lastDisasterTurn: number | undefined,
  currentTurn: number,
  countryId: string
): boolean {
  const anchor = lastDisasterTurn ?? staggerHash(countryId) - AUTO_DISASTER_CADENCE_TURNS;
  return currentTurn - anchor >= AUTO_DISASTER_CADENCE_TURNS;
}

/**
 * Resolve the effects for a region-scoped disaster. Preserves a template's own
 * profit-margin effects (e.g. sector-targeted infrastructure disasters like a
 * bridge collapse) as decay effects so they feed the blended sector margin.
 * Templates without their own margin effects (most natural disasters) get the
 * generic onset margin shock.
 */
export function buildRegionalDisasterEffects(template: CrisisTemplate): CrisisEffect[] {
  const nonMarginEffects = template.effects.filter((e) => e.targetType !== "profitMargin");
  const templateMarginEffects = template.effects.filter((e) => e.targetType === "profitMargin");
  const marginEffects: CrisisEffect[] =
    templateMarginEffects.length > 0
      ? templateMarginEffects.map((e) => ({ ...e, effectType: "decay" as const }))
      : [
          {
            effectType: "decay" as const,
            targetType: "profitMargin" as const,
            metricCategory: null,
            metricField: null,
            sectorType: null,
            strategyId: null,
            value: AUTO_DISASTER_MARGIN_PENALTY,
            label: "Regional disaster margin shock",
          },
        ];
  return [...nonMarginEffects, ...marginEffects];
}

export async function processAutoDisasterSpawn(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  opts?: { enabled?: boolean }
): Promise<void> {
  if (opts?.enabled !== true) return;

  const cgs = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: countryId });

  if (!shouldSpawn(cgs?.lastDisasterTurn as number | undefined, currentTurn, countryId)) {
    return;
  }

  const existing = await db
    .collection<Crisis>("crises")
    .findOne({ autoSource: "disaster", status: "active", countryIds: countryId });
  if (existing) return;

  // Province/state/region-scale areas only. Constituencies are excluded: they
  // are sub-regional (e.g. single UK seats) and too small to host a
  // nation-scale natural disaster; "nation" is the country-level pseudo-region.
  const regions = await db
    .collection<State>("states")
    .find({ countryId, regionType: { $nin: [null, "nation", "constituency"] } } as never)
    .toArray();
  if (regions.length === 0) return;

  // Build the set of geographically-valid (region, template) pairs: the country
  // must be allowed by the template's gating, the region must carry the required
  // hazard tags (no hurricanes inland, no tsunamis off the coast), and the
  // template must be off its per-type cooldown for this country.
  const cooldowns = await loadCooldownMap(db);
  // Disaster templates go through the same era window as the economic/political
  // ones. They carry no window today, so this is a no-op for the current
  // catalogue — but it means a future era-bound disaster (an industrial or
  // nuclear one, say) cannot be added here and silently escape the gate.
  const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentYear = gs?.currentYear;
  const eligibleTemplates = disasterTemplatesForCountry(countryId).filter(({ template }) =>
    isTemplateAllowedInYear(template, currentYear)
  );
  const candidates: Array<{ region: State; key: string; template: CrisisTemplate }> = [];
  for (const region of regions) {
    for (const { key, template } of eligibleTemplates) {
      if (!regionMatchesTags(countryId, region._id, template.geo?.requiresRegionTags)) continue;
      const cd = template.disasterCooldownTurns ?? DEFAULT_DISASTER_COOLDOWN_TURNS;
      if (isOnCooldown(cooldowns, key, countryId, currentTurn, cd)) continue;
      candidates.push({ region, key, template });
    }
  }
  if (candidates.length === 0) return;

  // Deterministic pick from the valid pairs so a re-run of the same turn is
  // idempotent (mirrors the staggerHash approach used for cadence).
  const seed = currentTurn + staggerHash(countryId);
  const { region, key, template } = candidates[Math.abs(seed) % candidates.length];

  const resolvedDuration = getTemplateDuration(template, "region");
  const durationTurns = floorCrisisDuration(
    resolvedDuration != null && resolvedDuration > 0
      ? resolvedDuration
      : template.durationTurns != null && template.durationTurns > 0
        ? template.durationTurns
        : AUTO_DISASTER_DEFAULT_DURATION_TURNS
  );

  // The affected region's real name (e.g. "California") substituted into the
  // template's `{location}` placeholder for flavor/wire text.
  const locationName = region.name ?? "the affected region";

  const crisis: Omit<Crisis, "_id"> = {
    name: template.name,
    description: interpolateLocation(template.description, locationName),
    heroImage: template.heroImage,
    scope: "region",
    countryIds: [countryId],
    regionIds: [region._id],
    status: "active",
    startTurn: currentTurn,
    endTurn: null,
    durationTurns,
    effects: buildRegionalDisasterEffects(template),
    wireMessageOnStart: interpolateLocation(template.wireMessageOnStart, locationName),
    wireMessageOnEnd: template.wireMessageOnEnd
      ? interpolateLocation(template.wireMessageOnEnd, locationName)
      : null,
    createdBy: null,
    createdAt: new Date(),
    resolvedAt: null,
    autoGenerated: true,
    autoSource: "disaster",
  };

  await db.collection<Crisis>("crises").insertOne(crisis as Crisis);
  await db
    .collection<CountryGameState>("countryGameStates")
    .updateOne({ _id: countryId }, { $set: { lastDisasterTurn: currentTurn } }, { upsert: true });
  await stampCooldown(db, cooldowns, key, countryId, currentTurn);
}
