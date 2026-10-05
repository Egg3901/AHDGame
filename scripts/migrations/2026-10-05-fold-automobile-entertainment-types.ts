/**
 * One-off fold of the retired `automobiles` and `entertainment` corporation
 * types into their canonical identities:
 *
 *   automobiles   -> manufacturing + industryModel "vehicles"
 *   entertainment -> media + mediaDiscriminator "entertainment"
 *
 * Rows that carry a corporation or sector identity (corporations, owned
 * sectors, unowned markets, unions) are re-keyed in place. Ids, balances,
 * capacity, workers and holdings are never touched, so money and stock are
 * conserved by construction. Fields that reference an operating lane (state
 * specializations, sector funds, policy targets, crisis and event effects,
 * tech node ids) move to the lane keys `manufacturing_vehicles` and
 * `media_entertainment`. Historical records that only ever name a type move to
 * the containing type.
 *
 * Collisions:
 *   - an unowned market whose canonical twin already exists is merged into it
 *     (revenue and headroom summed) and the legacy row is removed;
 *   - a vacant, unreferenced world union whose canonical twin exists is
 *     removed after its represented sectors are repointed;
 *   - any other collision (an owned sector, a led or funded union) blocks the
 *     apply and is reported, so nothing is half-converted.
 *
 * Dry-run is the default. Re-running after an apply is a no-op.
 *
 *   npx tsx scripts/migrations/2026-10-05-fold-automobile-entertainment-types.ts          # dry run
 *   npx tsx scripts/migrations/2026-10-05-fold-automobile-entertainment-types.ts --apply  # write
 */
import type { AnyBulkWriteOperation, Db, Document, ObjectId } from "mongodb";
import type { MigrationContext, MigrationResult } from "../../src/lib/migrations/types";

type LegacyType = "automobiles" | "entertainment";

const LEGACY_TYPES: readonly LegacyType[] = ["automobiles", "entertainment"];

const IDENTITY: Record<
  LegacyType,
  { sectorType: string; industryModel: string | null; mediaDiscriminator: string | null }
> = {
  automobiles: { sectorType: "manufacturing", industryModel: "vehicles", mediaDiscriminator: null },
  entertainment: { sectorType: "media", industryModel: null, mediaDiscriminator: "entertainment" },
};

/** Operating-lane keys for fields that name a lane. */
const LANE: Record<LegacyType, string> = {
  automobiles: "manufacturing_vehicles",
  entertainment: "media_entertainment",
};

/** Containing corporation type for historical records that only name a type. */
const TYPE: Record<LegacyType, string> = {
  automobiles: "manufacturing",
  entertainment: "media",
};

const TECH_NODE_PREFIX = /^(automobiles|entertainment)-/;

interface FoldOptions {
  dryRun?: boolean;
}

interface Tally {
  scanned: number;
  updated: number;
  deleted: number;
  notes: string[];
  blockers: string[];
}

function identityFilter(identity: (typeof IDENTITY)[LegacyType]): Document {
  return {
    sectorType: identity.sectorType,
    industryModel: identity.industryModel,
    mediaDiscriminator: identity.mediaDiscriminator,
  };
}

function identitySet(identity: (typeof IDENTITY)[LegacyType], field = "sectorType"): Document {
  return {
    [field]: identity.sectorType,
    industryModel: identity.industryModel,
    mediaDiscriminator: identity.mediaDiscriminator,
  };
}

async function count(db: Db, collection: string, filter: Document): Promise<number> {
  return db.collection(collection).countDocuments(filter);
}

/** Owned sectors: unique per (corporation, state, identity). Collisions block. */
async function planCorporateSectors(db: Db, tally: Tally): Promise<void> {
  for (const legacy of LEGACY_TYPES) {
    const rows = await db
      .collection("corporateSectors")
      .find({ sectorType: legacy }, { projection: { _id: 1, corporationId: 1, stateId: 1 } })
      .toArray();
    tally.scanned += rows.length;
    for (const row of rows) {
      const twin = await db.collection("corporateSectors").findOne(
        {
          corporationId: row.corporationId,
          stateId: row.stateId,
          ...identityFilter(IDENTITY[legacy]),
        },
        { projection: { _id: 1 } }
      );
      if (twin) {
        tally.blockers.push(
          `corporateSectors ${String(row._id)} (${legacy}) collides with ${String(twin._id)}`
        );
      }
    }
  }
}

async function foldCorporateSectors(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  for (const legacy of LEGACY_TYPES) {
    const filter = { sectorType: legacy };
    const n = await count(db, "corporateSectors", filter);
    tally.notes.push(`corporateSectors ${legacy}: ${n}`);
    if (!dryRun && n > 0) {
      const result = await db
        .collection("corporateSectors")
        .updateMany(filter, { $set: identitySet(IDENTITY[legacy]) });
      tally.updated += result.modifiedCount;
    }
  }
}

/** Unowned markets: merge into an existing canonical twin, else re-key. */
async function foldUnownedSectors(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  for (const legacy of LEGACY_TYPES) {
    const rows = await db
      .collection("unownedSectors")
      .find(
        { sectorType: legacy },
        { projection: { _id: 1, stateId: 1, revenue: 1, headroomUnits: 1 } }
      )
      .toArray();
    tally.scanned += rows.length;
    let merged = 0;
    let rekeyed = 0;
    for (const row of rows) {
      const twin = await db
        .collection("unownedSectors")
        .findOne(
          { stateId: row.stateId, ...identityFilter(IDENTITY[legacy]) },
          { projection: { _id: 1 } }
        );
      if (twin) {
        merged++;
        if (dryRun) continue;
        const revenue =
          typeof row.revenue === "number" && Number.isFinite(row.revenue) ? row.revenue : 0;
        const headroom =
          typeof row.headroomUnits === "number" && Number.isFinite(row.headroomUnits)
            ? row.headroomUnits
            : 0;
        await db
          .collection("unownedSectors")
          .updateOne(
            { _id: twin._id },
            { $inc: { revenue, headroomUnits: headroom }, $set: { updatedAt: new Date() } }
          );
        await db.collection("unownedSectors").deleteOne({ _id: row._id });
        tally.updated++;
        tally.deleted++;
      } else {
        rekeyed++;
        if (dryRun) continue;
        const result = await db
          .collection("unownedSectors")
          .updateOne({ _id: row._id }, { $set: identitySet(IDENTITY[legacy]) });
        tally.updated += result.modifiedCount;
      }
    }
    tally.notes.push(`unownedSectors ${legacy}: ${rekeyed} re-keyed, ${merged} merged into twins`);
  }
}

const UNION_REFERENCE_COLLECTIONS = [
  "unionEndorsements",
  "unionOrganizers",
  "unionLeaderVotes",
  "bargainingCampaigns",
  "collectiveAgreements",
] as const;

interface UnionPlan {
  legacyId: ObjectId;
  twinId: ObjectId;
}

/**
 * World unions are unique per (country, identity). A vacant, unfunded,
 * unreferenced legacy union that already has a canonical twin is folded into
 * it; any other collision blocks the apply.
 */
async function planUnions(db: Db, tally: Tally): Promise<UnionPlan[]> {
  const plans: UnionPlan[] = [];
  for (const legacy of LEGACY_TYPES) {
    const rows = await db
      .collection("unions")
      .find(
        { sectorType: legacy, foundedByCharacterId: null },
        {
          projection: {
            _id: 1,
            countryId: 1,
            ownerId: 1,
            treasury: 1,
            pendingLeaderCharacterId: 1,
          },
        }
      )
      .toArray();
    tally.scanned += rows.length;
    for (const row of rows) {
      const twin = await db.collection("unions").findOne(
        {
          countryId: row.countryId,
          foundedByCharacterId: null,
          ...identityFilter(IDENTITY[legacy]),
        },
        { projection: { _id: 1 } }
      );
      if (!twin) continue;
      const vacant =
        row.ownerId == null &&
        row.pendingLeaderCharacterId == null &&
        (typeof row.treasury !== "number" || row.treasury === 0);
      let referenced = false;
      for (const collection of UNION_REFERENCE_COLLECTIONS) {
        if ((await count(db, collection, { unionId: row._id })) > 0) referenced = true;
      }
      if (vacant && !referenced) {
        plans.push({ legacyId: row._id as ObjectId, twinId: twin._id as ObjectId });
      } else {
        tally.blockers.push(
          `unions ${String(row._id)} (${legacy}, ${String(row.countryId)}) collides with ${String(twin._id)} and is led, funded or referenced`
        );
      }
    }
  }
  return plans;
}

async function foldUnions(
  db: Db,
  tally: Tally,
  dryRun: boolean,
  plans: UnionPlan[]
): Promise<void> {
  tally.notes.push(`unions: ${plans.length} vacant duplicates folded into canonical twins`);
  if (!dryRun) {
    for (const plan of plans) {
      await db
        .collection("corporateSectors")
        .updateMany(
          { representingUnionId: plan.legacyId },
          { $set: { representingUnionId: plan.twinId } }
        );
      await db.collection("unions").deleteOne({ _id: plan.legacyId });
      tally.deleted++;
    }
  }
  for (const legacy of LEGACY_TYPES) {
    const filter = { sectorType: legacy };
    const n = await count(db, "unions", filter);
    tally.notes.push(`unions ${legacy}: ${n}`);
    if (!dryRun && n > 0) {
      const result = await db
        .collection("unions")
        .updateMany(filter, { $set: identitySet(IDENTITY[legacy]) });
      tally.updated += result.modifiedCount;
    }
  }
}

async function foldCorporations(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  const corporations = db.collection("corporations");
  for (const legacy of LEGACY_TYPES) {
    const identity = IDENTITY[legacy];
    const n = await count(db, "corporations", { type: legacy });
    tally.notes.push(`corporations type ${legacy}: ${n}`);
    if (!dryRun && n > 0) {
      const result = await corporations.updateMany(
        { type: legacy },
        { $set: identitySet(identity, "type") }
      );
      tally.updated += result.modifiedCount;
    }
    // The secondary specialization names an operating lane.
    const secondary = await count(db, "corporations", { secondaryType: legacy });
    tally.notes.push(`corporations secondaryType ${legacy}: ${secondary}`);
    if (!dryRun && secondary > 0) {
      const result = await corporations.updateMany(
        { secondaryType: legacy },
        { $set: { secondaryType: LANE[legacy] } }
      );
      tally.updated += result.modifiedCount;
    }
    // National corporations list the lanes they hold.
    const assigned = await count(db, "corporations", { assignedSectorTypes: legacy });
    tally.notes.push(`corporations assignedSectorTypes ${legacy}: ${assigned}`);
    if (!dryRun && assigned > 0) {
      const result = await corporations.updateMany(
        { assignedSectorTypes: legacy },
        { $set: { "assignedSectorTypes.$[lane]": LANE[legacy] } },
        { arrayFilters: [{ lane: legacy }] }
      );
      tally.updated += result.modifiedCount;
    }
  }

  // Tech node ids embed the lane key: `automobiles-1950-3` -> `manufacturing_vehicles-1950-3`.
  const withLegacyNodes = await corporations
    .find(
      { unlockedTechNodeIds: { $regex: TECH_NODE_PREFIX } },
      { projection: { _id: 1, unlockedTechNodeIds: 1 } }
    )
    .toArray();
  tally.scanned += withLegacyNodes.length;
  tally.notes.push(`corporations with legacy tech node ids: ${withLegacyNodes.length}`);
  if (!dryRun && withLegacyNodes.length > 0) {
    const ops: AnyBulkWriteOperation<Document>[] = withLegacyNodes.map((corp) => ({
      updateOne: {
        filter: { _id: corp._id },
        update: {
          $set: {
            unlockedTechNodeIds: [
              ...new Set(
                (corp.unlockedTechNodeIds as string[]).map((id) =>
                  id.replace(TECH_NODE_PREFIX, (_match, legacy: LegacyType) => `${LANE[legacy]}-`)
                )
              ),
            ],
          },
        },
      },
    }));
    const result = await corporations.bulkWrite(ops, { ordered: false });
    tally.updated += result.modifiedCount;
  }
}

/** A scalar field that names a lane or a type. */
async function renameScalar(
  db: Db,
  tally: Tally,
  dryRun: boolean,
  collection: string,
  field: string,
  target: Record<LegacyType, string>
): Promise<void> {
  for (const legacy of LEGACY_TYPES) {
    const filter = { [field]: legacy };
    const n = await count(db, collection, filter);
    if (n === 0) continue;
    tally.notes.push(`${collection}.${field} ${legacy}: ${n}`);
    if (!dryRun) {
      const result = await db
        .collection(collection)
        .updateMany(filter, { $set: { [field]: target[legacy] } });
      tally.updated += result.modifiedCount;
    }
  }
}

/** A field inside an array of subdocuments (bill provisions, crisis effects). */
async function renameInArray(
  db: Db,
  tally: Tally,
  dryRun: boolean,
  collection: string,
  arrayField: string,
  field: string,
  target: Record<LegacyType, string>
): Promise<void> {
  for (const legacy of LEGACY_TYPES) {
    const filter = { [`${arrayField}.${field}`]: legacy };
    const n = await count(db, collection, filter);
    if (n === 0) continue;
    tally.notes.push(`${collection}.${arrayField}[].${field} ${legacy}: ${n}`);
    if (!dryRun) {
      const result = await db
        .collection(collection)
        .updateMany(
          filter,
          { $set: { [`${arrayField}.$[item].${field}`]: target[legacy] } },
          { arrayFilters: [{ [`item.${field}`]: legacy }] }
        );
      tally.updated += result.modifiedCount;
    }
  }
}

/** An array of plain strings. */
async function renameInStringArray(
  db: Db,
  tally: Tally,
  dryRun: boolean,
  collection: string,
  arrayField: string,
  target: Record<LegacyType, string>
): Promise<void> {
  for (const legacy of LEGACY_TYPES) {
    const filter = { [arrayField]: legacy };
    const n = await count(db, collection, filter);
    if (n === 0) continue;
    tally.notes.push(`${collection}.${arrayField}[] ${legacy}: ${n}`);
    if (!dryRun) {
      const result = await db
        .collection(collection)
        .updateMany(
          filter,
          { $set: { [`${arrayField}.$[item]`]: target[legacy] } },
          { arrayFilters: [{ item: legacy }] }
        );
      tally.updated += result.modifiedCount;
    }
  }
}

/** A map keyed by sector (macro country sectors, market-cap history). */
async function renameMapKey(
  db: Db,
  tally: Tally,
  dryRun: boolean,
  collection: string,
  mapField: string,
  target: Record<LegacyType, string>,
  mode: "rename" | "sum"
): Promise<void> {
  for (const legacy of LEGACY_TYPES) {
    const from = `${mapField}.${legacy}`;
    const to = `${mapField}.${target[legacy]}`;
    const rows = await db
      .collection(collection)
      .find({ [from]: { $exists: true } }, { projection: { _id: 1, [mapField]: 1 } })
      .toArray();
    if (rows.length === 0) continue;
    tally.scanned += rows.length;
    tally.notes.push(`${collection}.${from}: ${rows.length}`);
    if (dryRun) continue;
    const ops: AnyBulkWriteOperation<Document>[] = rows.map((row) => {
      const map = (mapField
        .split(".")
        .reduce<unknown>((node, key) => (node as Document | undefined)?.[key], row) ??
        {}) as Record<string, unknown>;
      const legacyValue = map[legacy];
      const existing = map[target[legacy]];
      if (existing === undefined || mode === "rename") {
        // A canonical key that already exists wins on rename; the legacy key is dropped.
        return existing === undefined
          ? { updateOne: { filter: { _id: row._id }, update: { $rename: { [from]: to } } } }
          : { updateOne: { filter: { _id: row._id }, update: { $unset: { [from]: "" } } } };
      }
      const sum =
        (typeof existing === "number" ? existing : 0) +
        (typeof legacyValue === "number" ? legacyValue : 0);
      return {
        updateOne: {
          filter: { _id: row._id },
          update: { $set: { [to]: sum }, $unset: { [from]: "" } },
        },
      };
    });
    const result = await db.collection(collection).bulkWrite(ops, { ordered: false });
    tally.updated += result.modifiedCount;
  }
}

async function foldStates(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  await renameScalar(db, tally, dryRun, "states", "sectorSpecializations.primary", LANE);
  await renameScalar(db, tally, dryRun, "states", "sectorSpecializations.secondary", LANE);
  // The top-sectors card is recomputed every turn; drop stale legacy rows.
  const stale = {
    "topSectorsCache.sectors.sectorType": { $in: [...LEGACY_TYPES] as string[] },
  };
  const n = await count(db, "states", stale);
  if (n > 0) {
    tally.notes.push(`states topSectorsCache cleared: ${n}`);
    if (!dryRun) {
      const result = await db.collection("states").updateMany(stale, {
        $unset: { topSectorsCache: "" },
      });
      tally.updated += result.modifiedCount;
    }
  }
}

async function foldStrategicSectors(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  // A country can hold one designation per lane: drop a legacy duplicate.
  for (const legacy of LEGACY_TYPES) {
    const rows = await db
      .collection("strategicSectorDesignations")
      .find({ sectorType: legacy }, { projection: { _id: 1, countryId: 1 } })
      .toArray();
    for (const row of rows) {
      const twin = await db
        .collection("strategicSectorDesignations")
        .findOne(
          { countryId: row.countryId, sectorType: LANE[legacy] },
          { projection: { _id: 1 } }
        );
      if (!twin) continue;
      tally.notes.push(`strategicSectors ${String(row._id)} duplicate of ${String(twin._id)}`);
      if (!dryRun) {
        await db.collection("strategicSectorDesignations").deleteOne({ _id: row._id });
        tally.deleted++;
      }
    }
  }
  await renameScalar(db, tally, dryRun, "strategicSectorDesignations", "sectorType", LANE);
}

const BILL_COLLECTIONS = ["bills", "legislation", "stateBills", "governorLegislationQueue"];

async function foldPolicyReferences(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  // Tariffs, subsidies and sector nationalization target an operating lane.
  await renameScalar(db, tally, dryRun, "tariffs", "targetSectorType", LANE);
  await renameScalar(db, tally, dryRun, "subsidies", "targetSectorType", LANE);
  for (const collection of BILL_COLLECTIONS) {
    await renameInArray(db, tally, dryRun, collection, "provisions", "targetSectorType", LANE);
    // Strategic-sector designation provisions carry `sectorType`.
    await renameInArray(db, tally, dryRun, collection, "provisions", "sectorType", LANE);
  }
  await foldStrategicSectors(db, tally, dryRun);
  await renameScalar(db, tally, dryRun, "indexFunds", "sectorType", LANE);
  await renameScalar(db, tally, dryRun, "sentimentPulses", "sectorType", LANE);
  await renameScalar(db, tally, dryRun, "countryModifiers", "sectorType", LANE);
  await renameInArray(db, tally, dryRun, "crises", "effects", "sectorType", LANE);
  await renameScalar(db, tally, dryRun, "mediaProductProjectsV1", "operatingSectorType", LANE);
  // State enterprises record the lane they run; the Gosbank weights key by lane.
  await renameScalar(db, tally, dryRun, "corporations", "soe.sector", LANE);
  await renameMapKey(
    db,
    tally,
    dryRun,
    "federalBudget",
    "gosbankDirective.sectorCredit",
    LANE,
    "sum"
  );
  await renameMapKey(db, tally, dryRun, "macroCountries", "sectors", LANE, "rename");
  await renameMapKey(db, tally, dryRun, "macroCountries", "sectorContributions", LANE, "rename");
}

async function foldHistoricalRecords(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  // Records that name only a corporation type move to the containing type.
  await renameScalar(db, tally, dryRun, "bargainingCampaigns", "sectorType", TYPE);
  await renameScalar(db, tally, dryRun, "collectiveAgreements", "sectorType", TYPE);
  await renameScalar(db, tally, dryRun, "mergerReviews", "leadSectorType", TYPE);
  await renameScalar(db, tally, dryRun, "mergerReviews", "remedySectorType", TYPE);
  await renameInArray(db, tally, dryRun, "mergerReviews", "overlaps", "sectorType", TYPE);
  await renameInStringArray(db, tally, dryRun, "nationalizationLedger", "sectorTypes", TYPE);
  // Market-cap history is charted per operating lane, like the live snapshot.
  await renameMapKey(db, tally, dryRun, "marketCapHistory", "bySector", LANE, "sum");
}

async function clearRetiredSeedMarkers(db: Db, tally: Tally, dryRun: boolean): Promise<void> {
  const filter = {
    _id: "default",
    $or: [
      { fresh1991VehicleModelSeed: { $exists: true } },
      { fresh1991MediaTaxonomySeed: { $exists: true } },
    ],
  } as Document;
  const n = await count(db, "gameConfig", filter);
  if (n === 0) return;
  tally.notes.push("gameConfig retired fresh-1991 taxonomy markers cleared");
  if (!dryRun) {
    const result = await db.collection("gameConfig").updateOne(filter, {
      $unset: { fresh1991VehicleModelSeed: "", fresh1991MediaTaxonomySeed: "" },
    });
    tally.updated += result.modifiedCount;
  }
}

export async function foldAutomobileEntertainmentTypes(
  db: Db,
  options: FoldOptions = {}
): Promise<MigrationResult & { blockers: string[] }> {
  const dryRun = options.dryRun !== false;
  const tally: Tally = { scanned: 0, updated: 0, deleted: 0, notes: [], blockers: [] };

  // Plan every collision before any write so an apply is all-or-nothing.
  await planCorporateSectors(db, tally);
  const unionPlans = await planUnions(db, tally);
  if (tally.blockers.length > 0) {
    if (!dryRun) {
      throw new Error(
        `Taxonomy fold blocked by ${tally.blockers.length} collision(s): ${tally.blockers.join("; ")}`
      );
    }
    tally.notes.push(`BLOCKED: ${tally.blockers.length} collision(s) need a manual decision`);
  }

  await foldCorporations(db, tally, dryRun);
  await foldCorporateSectors(db, tally, dryRun);
  await foldUnownedSectors(db, tally, dryRun);
  await foldUnions(db, tally, dryRun, unionPlans);
  await foldStates(db, tally, dryRun);
  await foldPolicyReferences(db, tally, dryRun);
  await foldHistoricalRecords(db, tally, dryRun);
  await clearRetiredSeedMarkers(db, tally, dryRun);

  return {
    documentsScanned: tally.scanned,
    documentsUpdated: tally.updated,
    documentsDeleted: tally.deleted,
    notes: [dryRun ? "dry run: no writes" : "applied", ...tally.notes],
    blockers: tally.blockers,
  };
}

export async function runFoldAutomobileEntertainmentTypes(
  db: Db,
  opts: Pick<MigrationContext, "dryRun"> = { dryRun: true }
): Promise<MigrationResult> {
  const { blockers: _blockers, ...result } = await foldAutomobileEntertainmentTypes(db, {
    dryRun: opts.dryRun,
  });
  return result;
}

async function main() {
  const { connectDb, closeDb } = await import("../utils/db");
  const db = await connectDb();
  try {
    const apply = process.argv.includes("--apply");
    const result = await foldAutomobileEntertainmentTypes(db, { dryRun: !apply });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
