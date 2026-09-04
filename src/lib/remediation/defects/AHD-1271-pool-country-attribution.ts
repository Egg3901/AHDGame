// AHD-1271 (b): `unownedSectors` rows filed under the wrong country.
//
// The unowned pool row is keyed by (stateId, sectorType) but CARRIES a
// countryId, and every reader filters on it: the sector browser's country
// filter, the command-economy drain in `reconcileCommandEconomyUnowned`, and
// the commodity supply math. `buildCapacity` resolved that countryId as
// `sector.countryId ?? corporation.countryId` and then fell through to a
// literal "US" when neither was set, so a sector with no stored country minted
// a pool row under the corporation's domicile, or under the United States
// outright.
//
// On live this left two rows sitting on Ukrainian states under `countryId: "US"`
// (UKR_WES agriculture, UKR_KYI media): invisible to Ukraine, counted as
// American headroom, and — because Ukraine is a command economy whose pool is
// drained by countryId — permanently exempt from the drain that should have
// removed them.
//
// Half A (code): `buildCapacity` now resolves the country from the STATE, which
// is the only thing that can be authoritative for where capacity physically is,
// and never substitutes a hardcoded country.
// Half B (this heal): re-key the existing rows onto their state's country.
//
// Scoped to `unownedSectors` deliberately. The same corruption in
// `corporateSectors` is AHD-duplicate-sectors, which additionally has to merge
// the parallel rows a later takeover created; live currently shows none.

import type { Db } from "mongodb";
import type {
  Defect,
  DetectResult,
  HealContext,
  HealPlan,
  HealResult,
  VerifyResult,
} from "../types";

export const DEFECT_ID = "AHD-1271-pool-country-attribution";

interface PoolRow {
  _id: unknown;
  stateId: string;
  countryId: string;
  sectorType: string;
}

interface Misfiled extends PoolRow {
  correctCountryId: string;
}

/**
 * Every pool row whose country disagrees with its state's.
 *
 * A row on a state that no longer exists is NOT swept up: that is an orphan of
 * a different kind (a dissolved region), it needs a decision about whether the
 * capacity should survive at all, and guessing a country for it here would bury
 * the question. Those are counted into `notes` instead.
 */
async function findMisfiled(db: Db): Promise<{ rows: Misfiled[]; statelessCount: number }> {
  const states = await db
    .collection<{ _id: string; countryId: string }>("states")
    .find({}, { projection: { countryId: 1 } })
    .toArray();
  const countryOfState = new Map(states.map((s) => [s._id, s.countryId]));

  const pool = await db
    .collection<PoolRow>("unownedSectors")
    .find({}, { projection: { stateId: 1, countryId: 1, sectorType: 1 } })
    .toArray();

  const rows: Misfiled[] = [];
  let statelessCount = 0;
  for (const row of pool) {
    const correctCountryId = countryOfState.get(row.stateId);
    if (!correctCountryId) {
      statelessCount++;
      continue;
    }
    if (correctCountryId !== row.countryId) rows.push({ ...row, correctCountryId });
  }
  return { rows, statelessCount };
}

function describe(row: Misfiled): string {
  return `${row.stateId}/${row.sectorType}: ${row.countryId} -> ${row.correctCountryId}`;
}

async function detect(db: Db): Promise<DetectResult> {
  const { rows, statelessCount } = await findMisfiled(db);
  const notes = [`${rows.length} pool row(s) filed under a country their state is not in`];
  if (statelessCount > 0) {
    notes.push(
      `${statelessCount} pool row(s) sit on a state that no longer exists and are NOT touched: a dissolved region needs its own decision, not a guessed country`
    );
  }
  return {
    affected: rows.length,
    sample: rows.slice(0, 10).map((row) => ({
      id: String(row._id),
      stateId: row.stateId,
      sectorType: row.sectorType,
      filedUnder: row.countryId,
      belongsTo: row.correctCountryId,
    })),
    notes,
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const { rows } = await findMisfiled(db);
  return {
    affected: rows.length,
    touched: [{ collection: "unownedSectors", ids: rows.map((row) => String(row._id)) }],
    // Pool rows carry capacity headroom, not currency. Nothing is minted.
    moneyDelta: 0,
    summary: `re-key ${rows.length} unowned pool row(s) onto the country their state is in`,
    notes: [
      ...rows.slice(0, 20).map(describe),
      "Rollback restores each pool row's whole document as it was at apply time, " +
        "its headroom included, so roll this back promptly or not at all.",
    ],
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const approved = new Set(
    healPlan.touched.find((t) => t.collection === "unownedSectors")?.ids ?? []
  );
  // Re-derived, then intersected with what was approved: a row that stopped
  // being misfiled between plan and apply is left alone rather than rewritten
  // from a stale plan.
  const { rows } = await findMisfiled(db);
  const now = ctx.now;

  let updated = 0;
  for (const row of rows) {
    if (!approved.has(String(row._id))) continue;
    const res = await db.collection("unownedSectors").updateOne(
      // The old country is part of the filter, so a concurrent correction wins
      // and this becomes a no-op rather than clobbering it.
      { _id: row._id, countryId: row.countryId } as Record<string, unknown>,
      { $set: { countryId: row.correctCountryId, updatedAt: now } }
    );
    updated += res.modifiedCount ?? 0;
  }

  return {
    documentsScanned: rows.length,
    documentsUpdated: updated,
    notes: [
      `re-keyed ${updated} of ${approved.size} approved pool row(s)`,
      ...rows
        .filter((row) => approved.has(String(row._id)))
        .slice(0, 20)
        .map(describe),
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const { rows, statelessCount } = await findMisfiled(db);
  return {
    ok: rows.length === 0,
    remaining: rows.length,
    notes: [
      rows.length === 0
        ? "every unowned pool row is filed under its state's country"
        : `${rows.length} pool row(s) still misfiled`,
      `${statelessCount} row(s) on missing states remain, by design`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Unowned pool rows filed under the corporation's country, or under a literal US",
  severity: "P2",
  codeFix: {
    issue: 1271,
    mergedTo: "development",
  },
  // The seeder writes the pool from the state list itself
  // (`seedUnownedSectors` iterates states and stamps `state.countryId`), so a
  // fresh world cannot produce this shape. It is created only by the runtime
  // capacity command.
  seedFix: {
    status: "not-needed",
    files: ["src/lib/admin/seed/seedUnownedSectors.ts"],
    note: "the seeder stamps the country from the state row it is iterating; only buildCapacity could substitute another country",
  },
  // ENVS DELIBERATELY EXCLUDE prod UNTIL `requiredCommit` IS PINNED. The ledger
  // gate (`evaluateCodeGate`) passes unconditionally when `requiredCommit` is
  // absent, so listing prod here today would let an operator heal an environment
  // the code half has not reached: production deploys `main`, and this fix is on
  // `development`. Healing there would re-corrupt on the next write, which is the
  // treadmill the ledger exists to prevent. Pin the squash-merge SHA and add
  // "prod" in the same change.
  envs: ["dev", "sandbox"],
  idempotent: true,
  guards: ["turn-lock-free", "money-conserving", "max-affected:500"],
  detect,
  plan,
  apply,
  verify,
};
