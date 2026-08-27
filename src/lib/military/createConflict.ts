import type { Db } from "mongodb";
import type { RegionCode } from "@/lib/military/types";
import type {
  ConflictDoc,
  ConflictSide,
  ConflictType,
  ConflictBloc,
  TreatyEntry,
} from "@/lib/db/types/conflict";
import type { Front } from "@/lib/military/combat";
import { capacityOfTerrain } from "@/lib/military/combat";
import { homeRegionOf } from "@/lib/military/regionTopology";
import { getRegion } from "@/lib/military/regions";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import type { WarGoal } from "@/lib/military/warGoals";
import { initialControl } from "./occupation";
import { OCCUPATION } from "./config";
import { deriveSeaAccess } from "./seaAccess";
import { hostEntitiesOf } from "./hostEntities";
import { planOpeningForceDeployment } from "./openingForces";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { listNuclearPrograms } from "@/lib/db/collections/nuclearPrograms";
import {
  applyTensionEvent,
  nuclearArmedCountryIds,
  warDeclarationTensionDelta,
} from "@/lib/coldwar/tension";

/**
 * Birth-data generation for a conflict: the flavor the 4 static theaters hardcoded
 * (across both the old Theater and combat.ts Front datasets), now derived from the
 * host and the two sides. First-pass heuristics; all tunable in playtest.
 * Spec: docs/superpowers/specs/2026-07-23-conflict-model-sub-a-design.md
 */

/** Terrain keyword to (combat factor, plausible enemy composition). */
function terrainProfile(terrain: string): { terr: number; enemyMix: string[] } {
  const t = terrain.toLowerCase();
  if (/mountain|arid|ice|tundra/.test(t))
    return { terr: 1.25, enemyMix: ["infantry", "arty", "airdef"] };
  if (/jungle|rainforest|littoral/.test(t))
    return { terr: 1.18, enemyMix: ["infantry", "mech", "airdef"] };
  if (/savanna|desert/.test(t))
    return { terr: 1.05, enemyMix: ["mech", "infantry", "air", "arty"] };
  if (/plain|continental|developed|forest/.test(t))
    return { terr: 0.95, enemyMix: ["armor", "mech", "arty", "air"] };
  if (/sea|ocean|naval/.test(t)) return { terr: 1.1, enemyMix: ["naval", "air", "airdef"] };
  return { terr: 1.0, enemyMix: ["mech", "infantry", "arty"] };
}

function blocOfSides(a: ConflictSide, b: ConflictSide): ConflictBloc {
  const wa = a.backer,
    wb = b.backer;
  if (wa && wb && wa !== wb) return "contested";
  if (wa === "west" || wb === "west") return "west";
  if (wa === "east" || wb === "east") return "east";
  return "internal";
}

export interface BuildConflictInput {
  id: string;
  /** Public number, allocated by createConflict from the shared counter. */
  conflictId: number;
  /** The map anchor. A proxy war's host is a world entity, not a playable country. */
  hostCountry: WorldEntityId;
  type: ConflictType;
  sideA: ConflictSide;
  sideB: ConflictSide;
  startTurn: number;
  createdBy: "player" | "event" | "seed";
  /** `cold_war`: every third-party country in the theatre. Defaults to the anchor. */
  hostEntities?: WorldEntityId[];
  name?: string;
  /** What the war was declared for. Absent for event- and seed-created conflicts. */
  warGoal?: WarGoal;
  /** The bill that declared it, when a declaration created this war. */
  declaredByBillId?: string;
  /** Countries pulled in by a mutual-defence treaty at declaration time. */
  treatyEntries?: TreatyEntry[];
  /**
   * Override whether the front reaches the sea. Omit it and `conflictToFront` derives
   * the answer from the host's naval branches, which is right for almost every war.
   * Set it for the case the derivation cannot see: fighting inland of a coastal nation,
   * or a landlocked theatre inside a country that does have a coast.
   */
  seaAccess?: boolean;
}

/**
 * Seeded per-side supply, preserved as the baseline live supply is derived from.
 *
 * Both sides start at the neutral value deliberately. The retired static Theater
 * dataset carried an asymmetric 65/55 (west/east supply) which was harmless while
 * nothing read these fields, but sideA/sideB are list order under the dynamic model,
 * not blocs, so once supply reached the battle math that asymmetry became a permanent
 * combat advantage handed to whichever side happened to be listed first. Every supply
 * difference must come from the front's displacement instead.
 */
const SEED_SUPPLY = OCCUPATION.supplyNeutral;

export function buildConflict(input: BuildConflictInput): ConflictDoc {
  const home = homeRegionOf(input.hostCountry);
  // A proxy war's host is a world entity supplied by an admin, not a validated CountryId
  // arriving from a declaration, so the `?? "noa"` fallback below is a silent mis-file
  // (a Vietnam war pinned in North America) rather than a safe default. Fail loudly; the
  // admin route surfaces it as a validation message.
  if (!home && input.type === "cold_war") {
    throw new Error(
      `No home region for proxy-war host ${input.hostCountry}. ` +
        `Add a COUNTRY_HOME_REGION row before creating this conflict.`
    );
  }
  const region = (home ?? "noa") as RegionCode;
  const reg = getRegion(region);
  const terrain = reg?.terrain ?? "Mixed";
  const infra = reg?.infra ?? 60;
  const { terr, enemyMix } = terrainProfile(terrain);

  // The generated/enemy side's weight scales with a real coalition's size.
  const enemyCoalition = input.sideB.kind === "generated" ? 0 : input.sideB.countries.length;
  const baseStrength = 320 + enemyCoalition * 60;
  const severity: ConflictDoc["severity"] =
    baseStrength >= 420 ? "HIGH" : baseStrength >= 320 ? "MEDIUM" : "LOW";
  const intensity = severity === "HIGH" ? 70 : severity === "MEDIUM" ? 50 : 30;
  // The front opens at the host's own pole. A nation begins a war holding all of
  // its own soil. Only ground neither side owns starts genuinely split.
  const control = initialControl(input.hostCountry, input.sideA, input.sideB);

  return {
    _id: input.id,
    conflictId: input.conflictId,
    name: input.name ?? `${input.sideA.label} vs ${input.sideB.label}`,
    hostCountry: input.hostCountry,
    region,
    type: input.type,
    sideA: input.sideA,
    sideB: input.sideB,
    bloc: blocOfSides(input.sideA, input.sideB),
    terrain,
    // Written only when the caller overrides. Storing the derived value instead would
    // freeze today's answer into the document and stop it tracking the branch table.
    ...(input.seaAccess === undefined ? {} : { seaAccess: input.seaAccess }),
    severity,
    baseStrength,
    supplyA: SEED_SUPPLY,
    supplyB: SEED_SUPPLY,
    supplyBaseA: SEED_SUPPLY,
    supplyBaseB: SEED_SUPPLY,
    terr,
    infra,
    enemyMix,
    intensity,
    control,
    controlStart: control,
    status: "active",
    createdBy: input.createdBy,
    startTurn: input.startTurn,
    ...(input.hostEntities ? { hostEntities: input.hostEntities } : {}),
    ...(input.warGoal ? { warGoal: input.warGoal } : {}),
    ...(input.declaredByBillId ? { declaredByBillId: input.declaredByBillId } : {}),
    ...(input.treatyEntries?.length ? { treatyEntries: input.treatyEntries } : {}),
  };
}

/**
 * Put a small reserve force on both sides when a new war opens. Units remain
 * individually player-manageable; this only removes the empty-front opening
 * where the first battle is decided by whichever side manually deployed first.
 */
export async function deployOpeningForces(db: Db, conflict: ConflictDoc): Promise<void> {
  const countries = [...conflict.sideA.countries, ...conflict.sideB.countries];
  if (countries.length === 0) return;

  const reserveUnits = await getMilitaryUnitsCollection(db)
    .find({
      countryId: { $in: countries },
      theaterId: "reserve",
      assignedGeneralId: null,
    })
    .project({ _id: 1, countryId: 1, basePower: 1 })
    .toArray();
  const plan = planOpeningForceDeployment(
    reserveUnits.map((unit) => ({
      id: unit._id.toString(),
      countryId: unit.countryId,
      basePower: unit.basePower,
    })),
    conflict.sideA.countries,
    conflict.sideB.countries
  );
  const selectedIds = [...plan.sideAIds, ...plan.sideBIds]
    .map((id) => reserveUnits.find((unit) => unit._id.toString() === id)?._id)
    .filter((id): id is NonNullable<typeof id> => id != null);
  if (selectedIds.length === 0) return;

  await getMilitaryUnitsCollection(db).updateMany(
    { _id: { $in: selectedIds }, theaterId: "reserve", assignedGeneralId: null },
    { $set: { theaterId: conflict._id, posture: "standard" } }
  );
}

export async function createConflict(
  db: Db,
  input: Omit<BuildConflictInput, "conflictId">
): Promise<ConflictDoc> {
  // Allocated here, not in buildConflict: the number comes from the shared counter
  // collection, and buildConflict is pure so its tests need no database.
  const conflictId = await getNextSequentialId(db, "conflict");
  const doc = buildConflict({ ...input, conflictId });
  await getConflictsCollection(db).insertOne(doc);
  await deployOpeningForces(db, doc);
  // The outbreak spike. The standing-pressure floor picks the war up from the
  // next tension turn. Seed-created conflicts skip it: a world seeded mid-war
  // starts at the standing floor computed by the seed pass.
  if (input.createdBy !== "seed") {
    const programs = await listNuclearPrograms(db);
    const delta = warDeclarationTensionDelta(
      {
        type: doc.type,
        sideACountries: doc.sideA.countries,
        sideBCountries: doc.sideB.countries,
      },
      nuclearArmedCountryIds(programs)
    );
    await applyTensionEvent(db, doc.startTurn, "escalation", `War declared: ${doc.name}`, delta);
  }
  return doc;
}

/** A conflict as the battle sim's `Front` (fed into the battle context, not looked up). */
export function conflictToFront(c: ConflictDoc): Front {
  return {
    id: c._id,
    name: c.name,
    region: c.region,
    terrain: c.terrain,
    contested: c.bloc === "contested",
    terr: c.terr,
    infra: c.infra,
    // Absent on every conflict written before sea access existed, so derive rather than
    // default: a stored `false` would quietly beach every navy in the game.
    seaAccess: c.seaAccess ?? deriveSeaAccess(hostEntitiesOf(c), c.terrain),
    // How much can stand in the line here. Derived from the ground, like `terr`.
    capacity: capacityOfTerrain(c.terrain),
    sev: c.severity,
    west: c.sideA.label,
    east: c.sideB.label,
    enemyBase: c.baseStrength,
    enemyMix: c.enemyMix,
  };
}
