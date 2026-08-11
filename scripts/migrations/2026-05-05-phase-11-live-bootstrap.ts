/**
 * Pointed live-server bootstrap for the sovereign-default subsystem
 * (Phases 1, 5, 9, 10, 11a, 11b).
 *
 * Connects via MONGODB_URI_LIVE (explicit, not MONGODB_URI) so it cannot be
 * accidentally pointed at dev/staging.
 *
 * Sections (all idempotent; each writes a `migrationsRun` marker on first run
 * and is safe to re-run):
 *
 *   1. IMF Corp placeholder ........... ensureImfInstitutionPlaceholder
 *      Creates a stub `corporations` doc with `imfInstitution: true` if
 *      missing. Admin assigns Board members later via /admin/setup.
 *
 *   2. federalBudget Phase 1 backfill ... sovereign-default-phase1-federalBudget
 *      Zero-fills sovereignCrisisState + 24 sibling fields on rows that lack
 *      them. Mirrors scripts/migrations/deprecated/sovereignDefaultPhase1FederalBudget.ts
 *      so live can be brought up to date even if that script never ran.
 *
 *   3. bonds Phase 1 backfill .......... sovereign-default-phase1-bonds
 *      Adds restructure/maturity audit fields. Mirrors
 *      scripts/migrations/sovereignDefaultPhase1Bonds.ts.
 *
 *   4. federalBudget Phase 11a fields .. sovereign-default-phase11a-federalBudget
 *      Adds recoveryCredibilityBonusUntilTurn = null and
 *      imfSovereignFacilityCumulativePaidAnchor = 0 on rows missing them.
 *      Code paths handle missing values via `?? null` / `?? 0`, so this is a
 *      cleanliness pass — but it makes the IMF overview's lifetime tally
 *      query usable on day 1.
 *
 *   5. Indexes ......................... sovereign-default-phase11-indexes
 *      Phase 1 + Phase 11a indexes ensured. createIndex is idempotent in
 *      Mongo; re-runs are no-ops (existing indexes report "= already exists").
 *
 * Usage:
 *   MONGODB_URI_LIVE=... npx tsx scripts/migrations/2026-05-05-phase-11-live-bootstrap.ts [--dry-run]
 *
 * Pre-flight: warns (5s grace) if gameState.isActive or isProcessing is
 * true. Abort with Ctrl-C if the live world is mid-turn.
 */

import { MongoClient, type Db, type Document } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const URI = process.env.MONGODB_URI_LIVE;
if (!URI) {
  console.error("ERROR: MONGODB_URI_LIVE is not set. Refusing to run.");
  console.error("       Add it to .env.local or pass it inline:");
  console.error(
    "       MONGODB_URI_LIVE=... npx tsx scripts/migrations/2026-05-05-phase-11-live-bootstrap.ts"
  );
  process.exit(1);
}
const DB_NAME = "a-house-divided";

const dryRun = process.argv.includes("--dry-run");

interface MigrationMarker {
  _id: string;
  completedAt: Date;
  documentsUpdated?: number;
}

interface SectionReport {
  section: string;
  marker?: string;
  status: "ran" | "skipped-marker" | "skipped-noop" | "dry-run";
  notes: string[];
}

const reports: SectionReport[] = [];

function log(msg: string) {
  console.log(msg);
}

function note(report: SectionReport, msg: string) {
  report.notes.push(msg);
  log(`  ${msg}`);
}

async function preflight(db: Db) {
  const gameState = await db
    .collection<{ _id: string; isActive?: boolean; isProcessing?: boolean }>("gameState")
    .findOne({ _id: "current" });
  if (gameState?.isActive || gameState?.isProcessing) {
    console.warn(
      `[preflight] WARNING: gameState.isActive=${gameState.isActive ?? false}, ` +
        `isProcessing=${gameState.isProcessing ?? false}. Continuing in 5 seconds — ` +
        `Ctrl-C now if turn-processing is mid-flight.`
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } else {
    log("[preflight] gameState quiet — proceeding.");
  }
}

async function markerThenSkip(db: Db, markerId: string): Promise<MigrationMarker | null> {
  return db.collection<MigrationMarker>("migrationsRun").findOne({ _id: markerId });
}

async function writeMarker(db: Db, markerId: string, documentsUpdated: number) {
  if (dryRun) return;
  await db
    .collection<MigrationMarker>("migrationsRun")
    .insertOne({ _id: markerId, completedAt: new Date(), documentsUpdated });
}

// ============================================================================
// Section 1 — IMF Corp placeholder
// ============================================================================

async function ensureImfPlaceholder(db: Db) {
  const report: SectionReport = {
    section: "1. IMF Corp placeholder",
    status: "ran",
    notes: [],
  };
  reports.push(report);
  log("\n[1] IMF Corp placeholder");

  const existing = await db.collection("corporations").findOne({ imfInstitution: true });
  if (existing) {
    note(
      report,
      `IMF Corp already present (id=${existing._id.toString()}, sequentialId=${existing.sequentialId ?? "—"}). No action.`
    );
    report.status = "skipped-noop";
    return;
  }

  if (dryRun) {
    note(report, "DRY RUN — would create placeholder IMF Corp.");
    report.status = "dry-run";
    return;
  }

  // Inline the `getNextSequentialId` logic so we don't import app code.
  const counter = await db
    .collection<{ _id: string; seq?: number }>("counters")
    .findOneAndUpdate(
      { _id: "corporation" },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
  const sequentialId = counter?.seq;
  if (typeof sequentialId !== "number") {
    throw new Error("Failed to allocate corporation sequentialId");
  }

  const now = new Date();
  // Match `ensureImfInstitutionPlaceholder` shape exactly. Constants pulled from
  // src/lib/constants/corporations.ts: DEFAULT_SHARE_PRICE = 0.1, CEO_INITIAL_SHARES = 10_000_000.
  const doc = {
    name: "International Monetary Fund",
    description: "IMF institution. Admin must assign Board members via /admin/setup.",
    type: "financial",
    countryId: "US",
    headquartersState: "DC",
    ceoVacant: true,
    totalShares: 10_000_000,
    shareholders: [],
    updatedAt: now,
    liquidCapital: 0,
    liquidCurrencyCode: "USD",
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    ceoSalary: 0,
    sharePrice: 0.1,
    publicFloat: 0,
    sequentialId,
    hiddenFromExchange: true,
    imfInstitution: true,
    createdAt: now,
  };
  const { insertedId } = await db.collection("corporations").insertOne(doc);
  note(report, `Created IMF Corp placeholder (id=${insertedId.toString()}, seq=${sequentialId}).`);
  note(report, "Next step: admin → /admin/setup → IMF seed form to assign Board members.");
}

// ============================================================================
// Section 2 — federalBudget Phase 1 backfill
// ============================================================================

const PHASE1_FEDERAL_BUDGET_MARKER = "sovereign-default-phase1-federalBudget";

async function phase1FederalBudgetBackfill(db: Db) {
  const report: SectionReport = {
    section: "2. federalBudget Phase 1 backfill",
    marker: PHASE1_FEDERAL_BUDGET_MARKER,
    status: "ran",
    notes: [],
  };
  reports.push(report);
  log(`\n[2] federalBudget Phase 1 backfill (marker: ${PHASE1_FEDERAL_BUDGET_MARKER})`);

  const marker = await markerThenSkip(db, PHASE1_FEDERAL_BUDGET_MARKER);
  if (marker) {
    note(report, `Marker exists (ran ${marker.completedAt.toISOString()}). Skipping.`);
    report.status = "skipped-marker";
    return;
  }

  const collection = db.collection("federalBudget");
  const candidates = await collection
    .find({ sovereignCrisisState: { $exists: false } })
    .project({ _id: 1, countryId: 1 })
    .toArray();
  note(report, `${candidates.length} federalBudget rows missing sovereignCrisisState.`);

  if (candidates.length === 0) {
    if (!dryRun) {
      await writeMarker(db, PHASE1_FEDERAL_BUDGET_MARKER, 0);
      note(report, "No-op marker written.");
    }
    report.status = "skipped-noop";
    return;
  }

  if (dryRun) {
    note(
      report,
      `DRY RUN — would update countryIds: ${candidates
        .slice(0, 8)
        .map((d) => d.countryId)
        .join(", ")}${candidates.length > 8 ? "…" : ""}`
    );
    report.status = "dry-run";
    return;
  }

  let updated = 0;
  for (const c of candidates) {
    const r = await collection.updateOne(
      { _id: c._id, sovereignCrisisState: { $exists: false } },
      {
        $set: {
          sovereignCrisisState: "normal",
          failedAuctionConsecutiveCount: 0,
          lastAuctionDemandRatio: 1.0,
          crisisFiredAt: null,
          crisisChoice: null,
          crisisChoiceAt: null,
          crisisLegislativeProposalId: null,
          crisisAutoActionAt: null,
          crisisLegislativeDeadlineAt: null,
          recoveryStartedAt: null,
          recoveryFiscalDisciplineStreak: 0,
          marketAccessLockedUntilTurn: null,
          lastDefaultTurn: null,
          imfSovereignBailoutActive: false,
          imfSovereignFacilityPrincipalOutstanding: 0,
          imfSovereignFacilityAnnualRate: 0,
          imfSovereignFacilityAmortizationTurnsRemaining: 0,
          imfSovereignFacilityIncomeCaptureFraction: 0,
          imfSovereignFacilityImfCorporationId: null,
          imfBoardOverrideWindowEndAt: null,
          imfBoardOverrideAt: null,
          imfBoardOverrideBy: null,
          imfBoardOverrideKind: null,
          imfBoardOverrideRateDelta: null,
          imfBoardOverrideCaptureDelta: null,
          imfBoardPublicStatement: null,
        },
      }
    );
    if (r.modifiedCount > 0) updated++;
  }
  await writeMarker(db, PHASE1_FEDERAL_BUDGET_MARKER, updated);
  note(report, `Updated ${updated}/${candidates.length} rows. Marker written.`);
}

// ============================================================================
// Section 3 — bonds Phase 1 backfill
// ============================================================================

const PHASE1_BONDS_MARKER = "sovereign-default-phase1-bonds";

async function phase1BondsBackfill(db: Db) {
  const report: SectionReport = {
    section: "3. bonds Phase 1 backfill",
    marker: PHASE1_BONDS_MARKER,
    status: "ran",
    notes: [],
  };
  reports.push(report);
  log(`\n[3] bonds Phase 1 backfill (marker: ${PHASE1_BONDS_MARKER})`);

  const marker = await markerThenSkip(db, PHASE1_BONDS_MARKER);
  if (marker) {
    note(report, `Marker exists (ran ${marker.completedAt.toISOString()}). Skipping.`);
    report.status = "skipped-marker";
    return;
  }

  const collection = db.collection("bonds");
  const candidateCount = await collection.countDocuments({
    restructureHaircutPercent: { $exists: false },
  });
  note(report, `${candidateCount} bonds missing restructureHaircutPercent.`);

  if (candidateCount === 0) {
    if (!dryRun) {
      await writeMarker(db, PHASE1_BONDS_MARKER, 0);
      note(report, "No-op marker written.");
    }
    report.status = "skipped-noop";
    return;
  }

  if (dryRun) {
    note(report, `DRY RUN — would update ${candidateCount} bonds.`);
    report.status = "dry-run";
    return;
  }

  const result = await collection.updateMany(
    { restructureHaircutPercent: { $exists: false } },
    {
      $set: {
        restructureHaircutPercent: null,
        restructureExtendedMaturityTurn: null,
        originalMaturityTurn: null,
        originalTotalIssued: null,
      },
    }
  );
  await writeMarker(db, PHASE1_BONDS_MARKER, result.modifiedCount);
  note(report, `Updated ${result.modifiedCount} bonds. Marker written.`);
}

// ============================================================================
// Section 4 — federalBudget Phase 11a additive fields
// ============================================================================

const PHASE11A_FEDERAL_BUDGET_MARKER = "sovereign-default-phase11a-federalBudget";

async function phase11aFederalBudgetBackfill(db: Db) {
  const report: SectionReport = {
    section: "4. federalBudget Phase 11a fields",
    marker: PHASE11A_FEDERAL_BUDGET_MARKER,
    status: "ran",
    notes: [],
  };
  reports.push(report);
  log(`\n[4] federalBudget Phase 11a fields (marker: ${PHASE11A_FEDERAL_BUDGET_MARKER})`);

  const marker = await markerThenSkip(db, PHASE11A_FEDERAL_BUDGET_MARKER);
  if (marker) {
    note(report, `Marker exists (ran ${marker.completedAt.toISOString()}). Skipping.`);
    report.status = "skipped-marker";
    return;
  }

  const collection = db.collection("federalBudget");
  // Two distinct "missing" predicates — a row could be missing one but not
  // the other. Match either via $or so we hit both populations in one sweep.
  const candidateCount = await collection.countDocuments({
    $or: [
      { recoveryCredibilityBonusUntilTurn: { $exists: false } },
      { imfSovereignFacilityCumulativePaidAnchor: { $exists: false } },
    ],
  });
  note(report, `${candidateCount} federalBudget rows missing one or both Phase 11a fields.`);

  if (candidateCount === 0) {
    if (!dryRun) {
      await writeMarker(db, PHASE11A_FEDERAL_BUDGET_MARKER, 0);
      note(report, "No-op marker written.");
    }
    report.status = "skipped-noop";
    return;
  }

  if (dryRun) {
    note(report, `DRY RUN — would update ${candidateCount} rows.`);
    report.status = "dry-run";
    return;
  }

  // Use $setOnInsert-like semantics via two updateMany calls so we never
  // overwrite a populated value with the default.
  const r1 = await collection.updateMany(
    { recoveryCredibilityBonusUntilTurn: { $exists: false } },
    { $set: { recoveryCredibilityBonusUntilTurn: null } }
  );
  const r2 = await collection.updateMany(
    { imfSovereignFacilityCumulativePaidAnchor: { $exists: false } },
    { $set: { imfSovereignFacilityCumulativePaidAnchor: 0 } }
  );
  await writeMarker(db, PHASE11A_FEDERAL_BUDGET_MARKER, r1.modifiedCount + r2.modifiedCount);
  note(
    report,
    `recoveryCredibilityBonusUntilTurn: +${r1.modifiedCount}, ` +
      `imfSovereignFacilityCumulativePaidAnchor: +${r2.modifiedCount}. Marker written.`
  );
}

// ============================================================================
// Section 5 — Indexes (Phase 1 + Phase 11a)
// ============================================================================

async function ensureIndexes(db: Db) {
  const report: SectionReport = {
    section: "5. Indexes",
    status: "ran",
    notes: [],
  };
  reports.push(report);
  log("\n[5] Indexes (idempotent — createIndex is a no-op when present)");

  const indexes: Array<{
    collection: string;
    key: Record<string, 1 | -1>;
    name: string;
    sparse?: boolean;
  }> = [
    // Phase 1 — federalBudget state-machine sweeps
    {
      collection: "federalBudget",
      key: { sovereignCrisisState: 1 },
      name: "sovereignCrisisState_1",
    },
    {
      collection: "federalBudget",
      key: { "crisisAutoActionAt.realtimeMs": 1 },
      name: "crisisAutoActionAt_realtimeMs_1",
      sparse: true,
    },
    {
      collection: "federalBudget",
      key: { "crisisLegislativeDeadlineAt.realtimeMs": 1 },
      name: "crisisLegislativeDeadlineAt_realtimeMs_1",
      sparse: true,
    },
    {
      collection: "federalBudget",
      key: { "imfBoardOverrideWindowEndAt.realtimeMs": 1 },
      name: "imfBoardOverrideWindowEndAt_realtimeMs_1",
      sparse: true,
    },
    // IMF overview lifetime-tally query: find({ imfSovereignBailoutActive: true })
    // and find({ imfSovereignFacilityCumulativePaidAnchor: { $gt: 0 } }).
    {
      collection: "federalBudget",
      key: { imfSovereignBailoutActive: 1 },
      name: "imfSovereignBailoutActive_1",
      sparse: true,
    },
    {
      collection: "federalBudget",
      key: { imfSovereignFacilityCumulativePaidAnchor: 1 },
      name: "imfSovereignFacilityCumulativePaidAnchor_1",
      sparse: true,
    },

    // Phase 1 — sovereignCrisisDecisions
    {
      collection: "sovereignCrisisDecisions",
      key: { countryCode: 1, state: 1 },
      name: "countryCode_state_1",
    },
    {
      collection: "sovereignCrisisDecisions",
      key: { firedAtRealtimeMs: 1 },
      name: "firedAtRealtimeMs_1",
    },
    // Legislative-turn sweep: find({ state: "executiveProposed" }) — the
    // compound (countryCode, state) index above can't serve this prefix-less
    // query. A state-only index is small (low cardinality) but cheap.
    {
      collection: "sovereignCrisisDecisions",
      key: { state: 1 },
      name: "state_1",
    },

    // Phase 11a — globalAlerts: GET /api/global-alerts/active filters by
    // `expiresAtRealtimeMs > now AND user not in dismissedByUserIds` then
    // sorts by `emittedAtRealtimeMs: -1`.
    {
      collection: "globalAlerts",
      key: { expiresAtRealtimeMs: 1 },
      name: "expiresAtRealtimeMs_1",
    },
    {
      collection: "globalAlerts",
      key: { emittedAtRealtimeMs: -1 },
      name: "emittedAtRealtimeMs_neg1",
    },
  ];

  for (const idx of indexes) {
    if (dryRun) {
      note(report, `DRY RUN — would ensure ${idx.collection}.${idx.name}`);
      continue;
    }
    try {
      await db
        .collection(idx.collection)
        .createIndex(idx.key as Document, { name: idx.name, sparse: idx.sparse ?? false });
      note(report, `✓ ${idx.collection}.${idx.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        note(report, `= ${idx.collection}.${idx.name} (already exists)`);
      } else {
        note(report, `✗ ${idx.collection}.${idx.name}: ${msg}`);
      }
    }
  }
  if (dryRun) report.status = "dry-run";
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  log(
    `=== Phase 11 live bootstrap ===\n` +
      `Target: MONGODB_URI_LIVE → db "${DB_NAME}"\n` +
      `Mode:   ${dryRun ? "DRY RUN (no writes)" : "LIVE WRITES"}\n`
  );

  const client = new MongoClient(URI!, {
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 30_000,
  });
  await client.connect();
  const db = client.db(DB_NAME);
  log("Connected.\n");

  try {
    await preflight(db);
    await ensureImfPlaceholder(db);
    await phase1FederalBudgetBackfill(db);
    await phase1BondsBackfill(db);
    await phase11aFederalBudgetBackfill(db);
    await ensureIndexes(db);

    log("\n=== Summary ===");
    for (const r of reports) {
      const tag =
        r.status === "ran"
          ? "RAN"
          : r.status === "skipped-marker"
            ? "SKIP (marker)"
            : r.status === "skipped-noop"
              ? "SKIP (no-op)"
              : "DRY RUN";
      log(`  [${tag}] ${r.section}${r.marker ? ` (marker: ${r.marker})` : ""}`);
    }
    log(`\nDone. ${dryRun ? "No writes were performed (dry run)." : "All sections completed."}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("\n[phase-11-live-bootstrap] FAILED:", err);
  process.exit(1);
});
