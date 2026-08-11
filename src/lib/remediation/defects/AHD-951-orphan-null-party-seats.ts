// AHD-951: orphan `party:null seatsHeld>0` electedOfficials blocs.
//
// When a multi-seat winner (commons/bundestag/seanad) moved from a previous
// office to a new seat, generalResolution vacated the OLD bloc by nulling the
// holder identity (party/characterId/nppId) but left `seatsHeld` intact. The
// seat tallies skip null-party rows, so those seats silently vanished from the
// party — the Conservatives' 14 NEE UK-commons seats reported as "vacant".
//
// Half A (code): $unset seatsHeld on vacate, stopping new orphans.
// Half B (this heal): delete the existing phantom blocs. Vacancy is represented
// by row ABSENCE in this codebase — true vacancies delete rows rather than
// leaving null placeholders — so deletion is the correct repair, and the next
// election re-contests the seats.
//
// Ported from scripts/heal-orphan-null-party-seats.ts, which stays as the
// standalone escape hatch. The office-type allowlist is deliberate: a
// null-party row on any OTHER office type may be a legitimate non-party seat,
// so those are reported and left alone rather than swept up.

import type { Db } from "mongodb";
import type { Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "../types";

/** Office types where a null-party bloc can only be the vacate bug. */
const HEALED_OFFICE_TYPES = ["commons", "snap_commons", "bundestag", "snap_bundestag", "seanad"];

/** No holder of any kind, yet still claiming seats. */
const ORPHAN_SHAPE = {
  party: null,
  characterId: null,
  nppId: null,
  seatsHeld: { $gt: 0 },
} as const;

const HEAL_FILTER = { ...ORPHAN_SHAPE, officeType: { $in: HEALED_OFFICE_TYPES } };

interface OrphanRow {
  _id: unknown;
  countryId?: string;
  officeType?: string;
  state?: string;
  seatsHeld?: number;
}

async function findOrphans(db: Db): Promise<OrphanRow[]> {
  return db
    .collection<OrphanRow>("electedOfficials")
    .find(HEAL_FILTER, { projection: { countryId: 1, officeType: 1, state: 1, seatsHeld: 1 } })
    .toArray();
}

async function countFlagged(db: Db): Promise<number> {
  return db
    .collection("electedOfficials")
    .countDocuments({ ...ORPHAN_SHAPE, officeType: { $nin: HEALED_OFFICE_TYPES } });
}

async function detect(db: Db): Promise<DetectResult> {
  const orphans = await findOrphans(db);
  const flagged = await countFlagged(db);
  const phantomSeats = orphans.reduce((sum, row) => sum + (row.seatsHeld ?? 0), 0);

  const notes = [`${phantomSeats} phantom seats across ${orphans.length} bloc(s)`];
  if (flagged > 0) {
    notes.push(
      `${flagged} null-party bloc(s) on OTHER office types are flagged but NOT touched — review against the seed before deleting, they may be legitimate non-party seats`
    );
  }

  return {
    affected: orphans.length,
    sample: orphans.slice(0, 10).map((row) => ({
      id: String(row._id),
      countryId: row.countryId,
      officeType: row.officeType,
      state: row.state,
      seatsHeld: row.seatsHeld,
    })),
    notes,
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const orphans = await findOrphans(db);
  const phantomSeats = orphans.reduce((sum, row) => sum + (row.seatsHeld ?? 0), 0);

  return {
    affected: orphans.length,
    touched: [{ collection: "electedOfficials", ids: orphans.map((row) => String(row._id)) }],
    moneyDelta: 0,
    summary: `delete ${orphans.length} orphan null-party bloc(s) holding ${phantomSeats} phantom seat(s)`,
    notes: orphans
      .slice(0, 20)
      .map((row) => `${row.countryId}/${row.officeType}/${row.state} seats=${row.seatsHeld}`),
  };
}

async function apply(db: Db, healPlan: HealPlan): Promise<HealResult> {
  const ids = healPlan.touched.find((t) => t.collection === "electedOfficials")?.ids ?? [];
  // Delete by the SHAPE filter restricted to the approved ids, not by id alone.
  // If a row stopped being an orphan between plan and apply, it survives.
  const docs = await db
    .collection<OrphanRow>("electedOfficials")
    .find(HEAL_FILTER)
    .project({ _id: 1 })
    .toArray();
  const approved = new Set(ids);
  const toDelete = docs.map((d) => d._id).filter((id) => approved.has(String(id)));

  const res = await db
    .collection("electedOfficials")
    .deleteMany({ ...HEAL_FILTER, _id: { $in: toDelete } } as Record<string, unknown>);

  return {
    documentsScanned: docs.length,
    documentsDeleted: res.deletedCount,
    notes: [`deleted ${res.deletedCount} of ${ids.length} approved orphan bloc(s)`],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const remaining = await db.collection("electedOfficials").countDocuments(HEAL_FILTER);
  const flagged = await countFlagged(db);
  return {
    ok: remaining === 0,
    remaining,
    notes: [
      remaining === 0
        ? "no orphan null-party blocs remain on healed office types"
        : `${remaining} orphan bloc(s) still present`,
      `${flagged} null-party bloc(s) on other office types remain, by design`,
    ],
  };
}

export const defect: Defect = {
  id: "AHD-951",
  title: "Orphan null-party electedOfficials blocs hold phantom seats",
  severity: "P1",
  // b6e272979 "clear seatsHeld when vacating multi-seat blocs to stop
  // party:null orphans" (PR #3135). generalResolution now $unsets seatsHeld on
  // the vacated bloc instead of leaving the count behind. The gate refuses to
  // heal any env whose deployed build predates it, because that build would
  // recreate the orphans on the next resolution.
  codeFix: {
    issue: 951,
    pr: 3135,
    mergedTo: "master",
    requiredCommit: "b6e272979d214b07ac6b07cbf9bde07839d5fb96",
  },
  // Checked 2026-08-08. The roster seeder allocates seatsHeld proportionally
  // across default parties, so every seeded row carries a party, and "vacant"
  // is expressed by leaving the chamber empty rather than by writing a
  // holder-less row (priors mode seeds no incumbents at all). A seed therefore
  // cannot emit `party:null seatsHeld>0`; this shape only comes from the
  // runtime vacate path.
  seedFix: {
    status: "not-needed",
    files: ["src/lib/admin/seed/seedEconTierRosters.ts", "src/lib/admin/seed/seedUK.ts"],
    note: "seeded rosters always stamp a party; vacancy is row absence, not a null-party row",
  },
  envs: ["dev", "sandbox", "prod"],
  idempotent: true,
  guards: ["turn-lock-free", "max-affected:500"],
  detect,
  plan,
  apply,
  verify,
};
