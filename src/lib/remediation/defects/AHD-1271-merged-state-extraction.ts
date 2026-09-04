// AHD-1271 (a): states absorbed by a merge lose their extraction sectors.
//
// Extraction is the ONE sector type whose SOE placement is gated per state:
// `buildCommandSoeCorpEntries` only builds a plant where the seed capacity
// table says the state has deposits, and it looked that up with a bare
// `${countryId}:${stateId}` key. Every other sector type takes the state list
// unfiltered. When `mergeCountry` re-keys an absorbed country's states onto the
// survivor, the compound key stops matching: the state is asked for under the
// survivor's id but was seeded under its own, the lookup returns nothing, and
// the state is silently skipped with a log line nobody reads.
//
// On live this is German reunification. DD survived and the eleven western
// Laender were re-keyed onto it; the SOE rebuild that followed placed sixteen of
// the seventeen sector types across all sixteen states and ZERO extraction
// plants in the west. The deposits are still in `stateResourceCapacity` and
// still correct — 693,000 iron, 360,000 natural gas, 226,860 coal, 67,500 oil,
// 219,328 timber — but nothing exists to mine them: no sector, and no unowned
// market either, because the same pass drains the pool for sectors it believes
// the SOE now covers. A reunified Germany was left with no iron, oil or gas
// extraction anywhere, and `extractedUnits` on those states has not moved since
// the merge. Private founding is banned in a command economy, so no player can
// close the hole either.
//
// Half A (code): `resolveStateResourceEntry` resolves the key through the merge
// (exact key, then the state code alone when exactly one country defines it,
// and never a guess when two do).
// Half B (this heal): build the plants that were skipped.
//
// WHAT THE HEAL WRITES, AND WHY IT IS THE SEED PATH. The sectors are generated
// by `generateCountryOwnedSeedData` — the very function the rebuild ran — and
// then re-pointed at the country's EXISTING extraction enterprise. That is the
// state the world would have been in had the gate not misfired, and it keeps
// the new plants sized on the same basis as the sixteen sibling sectors those
// states already carry (`computeUnownedSeedRevenue` is per state, so scoping
// the input to the affected states produces byte-identical values to a full
// run). Inventing a turn-619 valuation instead would put these plants on a
// different footing from every sector beside them.
//
// The enterprise is NOT created if it is missing. A country with deposits and no
// extraction SOE at all is a different situation — nothing was lost by this bug,
// something was never built — and it needs a decision this heal should not make.

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { GameConfig, GameState, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { commandEconomySoeSectors, isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { generateCountryOwnedSeedData } from "@/lib/seeds/reference/budgets";
import type {
  Defect,
  DetectResult,
  HealPlan,
  HealResult,
  HealContext,
  TouchedDocs,
  VerifyResult,
} from "../types";

export const DEFECT_ID = "AHD-1271-merged-state-extraction";

/** A state that should be mining and has nothing to mine with. */
interface StrandedState {
  stateId: string;
  countryId: CountryId;
  /** Resource ceilings the state still holds, for the operator's receipt. */
  resources: Record<string, number>;
  /** The extraction enterprise that should own the plant. Null blocks the heal. */
  soeCorporationId: string | null;
  soeCorporationName: string | null;
}

interface Survey {
  stranded: StrandedState[];
  /** Deposits present, no extraction sector, and no SOE to give it to. */
  withoutEnterprise: StrandedState[];
  preset: string;
}

function seedYear(preset: string, gameYear: number | null | undefined): number | null {
  if (gameYear != null && Number.isFinite(gameYear)) return gameYear;
  try {
    return getStartingYearForPreset(preset);
  } catch {
    const parsed = parseInt(preset.slice(0, 4), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

/**
 * States in a command economy that hold deposits but carry no extraction sector
 * of any kind.
 *
 * Deliberately keyed off the LIVE `stateResourceCapacity` collection rather than
 * the seed table. That collection is what the whole runtime reads — contracts,
 * prospecting, commodity prices, settlement — so it is the authority on whether
 * a state has anything to mine, and it already carries the merge-corrected
 * country. A state genuinely seeded with no deposits has `resources: {}` and is
 * correctly skipped here, exactly as the gate intends.
 */
async function survey(db: Db): Promise<Survey> {
  const [gameConfig, gameState, preset] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" as never }, { projection: { currentYear: 1 } }),
    loadWorldPreset(db),
  ]);

  const empty: Survey = { stranded: [], withoutEnterprise: [], preset };
  if (gameConfig?.commandEconomyEnabled !== true) return empty;

  const year = seedYear(preset, gameState?.currentYear ?? null);
  const states = await db
    .collection<State>("states")
    .find({ _id: { $not: /^NATIONAL_/ } })
    .project<Pick<State, "_id" | "countryId">>({ countryId: 1 })
    .toArray();

  const commandStates = states.filter(
    (s) =>
      isCommandEconomy(s.countryId as CountryId, year, true) &&
      commandEconomySoeSectors(s.countryId as CountryId).includes("extraction")
  );
  if (commandStates.length === 0) return empty;

  const stateIds = commandStates.map((s) => s._id as string);
  const [capacities, ownedStateIds, unownedStateIds] = await Promise.all([
    db
      .collection<{ stateId: string; resources?: Record<string, number> }>("stateResourceCapacity")
      .find({ stateId: { $in: stateIds } }, { projection: { stateId: 1, resources: 1 } })
      .toArray(),
    db.collection("corporateSectors").distinct("stateId", {
      stateId: { $in: stateIds },
      sectorType: "extraction",
    }),
    db.collection("unownedSectors").distinct("stateId", {
      stateId: { $in: stateIds },
      sectorType: "extraction",
    }),
  ]);

  const covered = new Set<string>([...ownedStateIds, ...unownedStateIds] as string[]);
  const depositsByState = new Map(
    capacities
      .filter((c) => Object.keys(c.resources ?? {}).length > 0)
      .map((c) => [c.stateId, c.resources as Record<string, number>])
  );

  // One extraction enterprise per country, looked up the way the rebuild does.
  const countryIds = [...new Set(commandStates.map((s) => s.countryId as CountryId))];
  const enterprises = await db
    .collection<{ _id: ObjectId; name?: string; countryOwnerId?: string }>("corporations")
    .find(
      { countryOwnerId: { $in: countryIds }, assignedSectorTypes: "extraction" },
      { projection: { name: 1, countryOwnerId: 1 } }
    )
    .toArray();
  const soeByCountry = new Map(enterprises.map((c) => [c.countryOwnerId as string, c]));

  const stranded: StrandedState[] = [];
  const withoutEnterprise: StrandedState[] = [];
  for (const state of commandStates) {
    const stateId = state._id as string;
    const resources = depositsByState.get(stateId);
    if (!resources || covered.has(stateId)) continue;
    const soe = soeByCountry.get(state.countryId);
    const row: StrandedState = {
      stateId,
      countryId: state.countryId as CountryId,
      resources,
      soeCorporationId: soe ? String(soe._id) : null,
      soeCorporationName: soe?.name ?? null,
    };
    if (soe) stranded.push(row);
    else withoutEnterprise.push(row);
  }
  return { stranded, withoutEnterprise, preset };
}

function describe(row: StrandedState): string {
  const deposits = Object.entries(row.resources)
    .map(([resource, ceiling]) => `${resource} ${ceiling}`)
    .join(", ");
  return `${row.countryId}/${row.stateId} -> ${row.soeCorporationName}: ${deposits}`;
}

async function detect(db: Db): Promise<DetectResult> {
  const { stranded, withoutEnterprise } = await survey(db);
  const notes = [
    `${stranded.length} command-economy state(s) hold deposits with no extraction sector of any kind`,
  ];
  if (withoutEnterprise.length > 0) {
    notes.push(
      `${withoutEnterprise.length} further state(s) have deposits but their country runs no extraction enterprise, and are NOT healed: nothing was destroyed there, so creating one is a design decision rather than a repair (${withoutEnterprise
        .map((r) => `${r.countryId}/${r.stateId}`)
        .join(", ")})`
    );
  }
  return {
    affected: stranded.length,
    sample: stranded.slice(0, 10).map((row) => ({
      stateId: row.stateId,
      countryId: row.countryId,
      resources: row.resources,
      enterprise: row.soeCorporationName,
    })),
    notes,
  };
}

/**
 * The sector documents to insert, generated by the same seed path the rebuild
 * used and re-pointed at the enterprise that exists.
 */
async function buildSectors(
  db: Db,
  stranded: StrandedState[],
  preset: string
): Promise<Record<string, unknown>[]> {
  if (stranded.length === 0) return [];
  const strandedIds = stranded.map((s) => s.stateId);
  const states = await db
    .collection<State>("states")
    .find({ _id: { $in: strandedIds } })
    .project<Pick<State, "_id" | "countryId" | "population" | "gdp">>({
      countryId: 1,
      population: 1,
      gdp: 1,
    })
    .toArray();

  const seedInput = states.map((s) => ({
    id: s._id as string,
    population: s.population,
    gdp: s.gdp,
    countryId: s.countryId as CountryId,
  }));

  const soeByState = new Map(stranded.map((s) => [s.stateId, s.soeCorporationId]));
  const entries = generateCountryOwnedSeedData(seedInput, preset, true).filter(
    (e) => e.corporation.soe && e.corporation.assignedSectorTypes?.[0] === "extraction"
  );

  // PLANTS-GATED: the documents come from `buildSector`, which seeds
  // `capitalStock` from the same figure it writes `revenue` from, so the plant
  // has capacity on day one and `sectorTurn` restates the nameplate off that
  // capacity on the next tick. The revenue field is the legacy view travelling
  // alongside the quantity, not the quantity itself, exactly as it is on the
  // sixteen sibling sectors these states already carry.
  const docs: Record<string, unknown>[] = [];
  for (const entry of entries) {
    for (const sector of entry.sectors) {
      const corpId = soeByState.get(sector.stateId);
      // Only ever write a plant for a state the plan actually approved, owned by
      // the enterprise that already exists. The seed's own corporation id is
      // discarded: re-creating a second enterprise is how #1014 went wrong.
      if (!corpId) continue;
      const { _id: _seedId, corporationId: _seedCorpId, ...sectorData } = sector;
      docs.push({
        ...sectorData,
        _id: new ObjectId(),
        corporationId: new ObjectId(corpId),
      });
    }
  }
  return docs;
}

async function plan(db: Db, _ctx: HealContext): Promise<HealPlan> {
  const { stranded, withoutEnterprise, preset } = await survey(db);
  const docs = await buildSectors(db, stranded, preset);

  const notes = stranded.slice(0, 20).map(describe);
  if (withoutEnterprise.length > 0) {
    notes.push(
      `NOT healed (no extraction enterprise): ${withoutEnterprise
        .map((r) => `${r.countryId}/${r.stateId}`)
        .join(", ")}`
    );
  }
  if (docs.length !== stranded.length) {
    notes.push(
      `WARNING: ${stranded.length} stranded state(s) but ${docs.length} sector document(s) generated — review before applying`
    );
  }

  return {
    affected: stranded.length,
    // Nothing is mutated: this heal only inserts. `insertedIds` on the result is
    // what rollback reads, and a snapshot cannot capture a document that does
    // not exist yet.
    touched: [],
    // Producing capacity, not currency. No cash, share or capital balance moves;
    // the plants earn from the next turn like any other sector.
    moneyDelta: 0,
    summary: `build ${docs.length} missing extraction plant(s) across ${stranded.length} state(s) stranded by a country merge`,
    notes,
    payload: { docs, stateIds: stranded.map((s) => s.stateId) },
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const payload = healPlan.payload as
    { docs: Record<string, unknown>[]; stateIds: string[] } | undefined;
  const docs = payload?.docs ?? [];
  if (docs.length === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, notes: ["nothing to build"] };
  }

  // Re-check emptiness per state inside apply. The approved plan is the source
  // of WHAT to write, but a sector that appeared between plan and apply (a
  // concurrent reconcile, a second operator) must not be duplicated.
  const stateIds = docs.map((d) => d.stateId as string);
  const alreadyCovered = new Set(
    (await db
      .collection("corporateSectors")
      .distinct("stateId", { stateId: { $in: stateIds }, sectorType: "extraction" })) as string[]
  );

  const toInsert = docs.filter((d) => !alreadyCovered.has(d.stateId as string));
  const skipped = docs.length - toInsert.length;
  if (toInsert.length === 0) {
    return {
      documentsScanned: docs.length,
      documentsUpdated: 0,
      notes: [`all ${docs.length} plant(s) already present; nothing written`],
    };
  }

  const now = ctx.now;
  const stamped = toInsert.map((doc) => ({ ...doc, updatedAt: now }));
  const res = await db
    .collection("corporateSectors")
    .insertMany(stamped as never[], { ordered: false });

  const insertedIds: TouchedDocs[] = [
    {
      collection: "corporateSectors",
      ids: Object.values(res.insertedIds).map((id) => String(id)),
    },
  ];

  return {
    documentsScanned: docs.length,
    documentsInserted: res.insertedCount,
    notes: [
      `built ${res.insertedCount} extraction plant(s) in ${[...new Set(toInsert.map((d) => d.stateId))].join(", ")}`,
      ...(skipped > 0 ? [`${skipped} skipped: a sector appeared since the plan was approved`] : []),
    ],
    insertedIds,
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const { stranded, withoutEnterprise } = await survey(db);
  return {
    ok: stranded.length === 0,
    remaining: stranded.length,
    notes: [
      stranded.length === 0
        ? "every command-economy state with deposits now carries an extraction sector"
        : `${stranded.length} state(s) still stranded`,
      `${withoutEnterprise.length} state(s) whose country runs no extraction enterprise remain, by design`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Merged-in states lose their extraction sectors and their deposits go unreachable",
  severity: "P1",
  codeFix: {
    issue: 1271,
    mergedTo: "development",
  },
  // The seed half is the gate itself, and it is fixed: `buildCommandSoeCorpEntries`
  // now resolves the capacity key through `resolveStateResourceEntry`, so a
  // rebuild or a world reset places the plants instead of skipping them.
  // `seedStateResourceCapacity` carried the same bare-key lookup and would have
  // WIPED the deposits of every merged-in state on the next re-seed; it is fixed
  // in the same change.
  seedFix: {
    status: "fixed",
    files: [
      "src/lib/seeds/reference/budgets.ts",
      "src/lib/seeds/reference/stateResourceCapacity.ts",
      "src/lib/admin/seed/seedStateResourceCapacity.ts",
    ],
    seedCheck: { countryId: "DD", era: "1953-default" },
  },
  envs: ["dev", "sandbox", "prod"],
  idempotent: true,
  guards: ["turn-lock-free", "money-conserving", "max-affected:500"],
  detect,
  plan,
  apply,
  verify,
};
