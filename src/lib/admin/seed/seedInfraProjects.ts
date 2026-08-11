import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  INFRA_POSITION_BY_COUNTRY,
  INFRA_ARCHETYPES,
  availableInfraArchetypes,
} from "@/lib/constants/cabinetInfra";
import { getInfraProjectsCollection } from "@/lib/db/collections/infraProjects";
import type { InfraProject } from "@/lib/db/types/infraProject";
import { eraForPreset } from "@/lib/seeds/presetSelector";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic starter pipeline: a few operational assets + 1-2 in-progress
 * builds. `era` (a calendar-year string, e.g. "1953") gates anachronistic
 * archetypes out of historical worlds; omit/undefined = era-agnostic (every
 * archetype available).
 */
export function buildCountryPipeline(
  countryId: string,
  positionId: string,
  regionIds: string[],
  currentTurn: number,
  era?: string
): Omit<InfraProject, "_id">[] {
  if (regionIds.length === 0) return [];
  const eraYear = era ? parseInt(era, 10) : null;
  const pool = availableInfraArchetypes(eraYear);
  const archetypes = pool.length > 0 ? pool : INFRA_ARCHETYPES;
  const r = rng(hash(`${countryId}:infra`));
  const out: Omit<InfraProject, "_id">[] = [];
  const operationalCount = 3 + Math.floor(r() * 3); // 3-5 operational
  const constructionCount = 1 + Math.floor(r() * 2); // 1-2 building
  const mk = (status: "construction" | "operational"): Omit<InfraProject, "_id"> => {
    const a = archetypes[Math.floor(r() * archetypes.length)];
    const progress = status === "operational" ? a.buildDuration : Math.floor(r() * a.buildDuration);
    return {
      countryId: countryId as CountryId,
      positionId,
      archetypeId: a.id,
      name: a.label,
      icon: a.icon,
      regionId: regionIds[Math.floor(r() * regionIds.length)],
      status,
      progress,
      buildDuration: a.buildDuration,
      fundingLevel: "standard",
      outputBase: a.outputBase,
      upkeepBase: a.upkeepBase,
      constructionCostBase: a.constructionCostBase,
      createdTurn: currentTurn,
      ...(status === "operational" ? { completedTurn: currentTurn } : {}),
    };
  };
  for (let i = 0; i < operationalCount; i++) out.push(mk("operational"));
  for (let i = 0; i < constructionCount; i++) out.push(mk("construction"));
  return out;
}

/** Idempotent: seeds only (country, transportation seat) pairs with zero projects. */
export async function seedInfraProjects(db: Db, preset: string): Promise<void> {
  const era = eraForPreset(preset);
  const col = getInfraProjectsCollection(db);
  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    const positionId = INFRA_POSITION_BY_COUNTRY[countryId];
    if (!positionId) continue;
    const existing = await col.countDocuments({ countryId, positionId });
    if (existing > 0) continue;
    const regions = await db.collection("states").find({ countryId }).project({ _id: 1 }).toArray();
    const regionIds = regions.map((s) => String(s._id));
    const pipeline = buildCountryPipeline(countryId, positionId, regionIds, 1, era);
    if (pipeline.length === 0) continue;
    await col.insertMany(pipeline.map((p) => ({ _id: new ObjectId(), ...p })));
  }
}
