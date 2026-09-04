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
// Half A (code): `lookupStateResourceCapacity` resolves the key through the
// merge, preferring the live owner's own entry and falling back to a previous
// owner's for the same region. Geology does not move when the flag above it
// does. (Where two countries both define a region code and neither is the
// asker, that fallback takes the first by sorted key: a deterministic pick
// rather than a provably right one. Unreachable today, and pinned by a test.)
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
import { CAPITAL_SEED_HEADROOM } from "@/lib/market/capital";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
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
  currentTurn: number;
  plantsEnabled: boolean;
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
  const [gameConfig, gameState, preset, marketMode] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" as never }, { projection: { currentYear: 1, currentTurn: 1 } }),
    loadWorldPreset(db),
    getMarketSystemModeForDb(db),
  ]);

  const currentTurn = gameState?.currentTurn ?? 0;
  const plantsEnabled = marketAtLeast(marketMode, "plants");
  const empty: Survey = {
    stranded: [],
    withoutEnterprise: [],
    preset,
    currentTurn,
    plantsEnabled,
  };
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
  //
  // SORTED, AND A SECOND CANDIDATE DISQUALIFIES THE COUNTRY. `assignedSectorTypes`
  // is an array-contains match, so a corp that claims extraction alongside other
  // types matches too. The one-per-(country, type) invariant is enforced at the
  // runtime paths, but if it is ever broken, silently taking whichever document
  // the cursor happened to yield last would decide who permanently owns the new
  // plants. Sorting makes the choice deterministic, and a country with more than
  // one candidate is routed to `withoutEnterprise` so a human picks.
  const countryIds = [...new Set(commandStates.map((s) => s.countryId as CountryId))];
  const enterprises = await db
    .collection<{ _id: ObjectId; name?: string; countryOwnerId?: string }>("corporations")
    .find(
      { countryOwnerId: { $in: countryIds }, assignedSectorTypes: "extraction" },
      { projection: { name: 1, countryOwnerId: 1 } }
    )
    .sort({ _id: 1 })
    .toArray();
  const soeByCountry = new Map<string, { _id: ObjectId; name?: string }>();
  const contestedCountries = new Set<string>();
  for (const corp of enterprises) {
    const owner = corp.countryOwnerId as string;
    if (soeByCountry.has(owner)) contestedCountries.add(owner);
    else soeByCountry.set(owner, corp);
  }
  for (const owner of contestedCountries) soeByCountry.delete(owner);

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
  return { stranded, withoutEnterprise, preset, currentTurn, plantsEnabled };
}

function describe(row: StrandedState): string {
  const deposits = Object.entries(row.resources)
    .map(([resource, ceiling]) => `${resource} ${ceiling}`)
    .join(", ");
  return `${row.countryId}/${row.stateId} -> ${row.soeCorporationName}: ${deposits}`;
}

/**
 * One assessment, shared by detect, plan and verify.
 *
 * THE COUNT HAS TO BE THE SAME EVERYWHERE OR THE DEFECT CAN NEVER CLOSE.
 * `survey` decides "stranded" from the LIVE capacity collection, while the seed
 * builder decides what it can produce from the STATIC reference and its own
 * schedule gates. The two drift as a world runs on past its seed year. Where
 * they disagree and only `detect` counts the difference, the env matrix reads
 * `detect.affected` and reports dirty, `plan` mints no token because it has
 * nothing to build, and there is no way to clear it. So every step counts the
 * states this heal can actually build a plant for, and the rest are reported.
 */
async function assess(db: Db) {
  const { stranded, withoutEnterprise, preset, currentTurn, plantsEnabled } = await survey(db);
  const docs = await buildSectors(db, stranded, preset, currentTurn, plantsEnabled);
  const buildableStates = new Set(docs.map((d) => d.stateId as string));
  return {
    docs,
    buildable: stranded.filter((s) => buildableStates.has(s.stateId)),
    unbuildable: stranded.filter((s) => !buildableStates.has(s.stateId)),
    withoutEnterprise,
  };
}

function skippedNotes(withoutEnterprise: StrandedState[], unbuildable: StrandedState[]): string[] {
  const notes: string[] = [];
  if (withoutEnterprise.length > 0) {
    notes.push(
      `${withoutEnterprise.length} state(s) have deposits but their country runs no single extraction enterprise (none at all, or several claiming the sector), and are NOT healed: nothing was destroyed there, so choosing or creating an owner is a design decision rather than a repair (${withoutEnterprise
        .map((r) => `${r.countryId}/${r.stateId}`)
        .join(", ")})`
    );
  }
  if (unbuildable.length > 0) {
    notes.push(
      `${unbuildable.length} state(s) are NOT healed because the seed builder produces no plant for them (live capacity and the static reference disagree): ${unbuildable
        .map((r) => `${r.countryId}/${r.stateId}`)
        .join(", ")}`
    );
  }
  return notes;
}

async function detect(db: Db): Promise<DetectResult> {
  const { buildable, unbuildable, withoutEnterprise } = await assess(db);
  return {
    affected: buildable.length,
    sample: buildable.slice(0, 10).map((row) => ({
      stateId: row.stateId,
      countryId: row.countryId,
      resources: row.resources,
      enterprise: row.soeCorporationName,
    })),
    notes: [
      `${buildable.length} command-economy state(s) hold deposits with no extraction sector that this heal can build a plant for`,
      ...skippedNotes(withoutEnterprise, unbuildable),
    ],
  };
}

/**
 * The sector documents to insert, generated by the same seed path the rebuild
 * used and re-pointed at the enterprise that exists.
 */
async function buildSectors(
  db: Db,
  stranded: StrandedState[],
  preset: string,
  currentTurn: number,
  plantsEnabled: boolean
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

  // PLANTS-GATED: the three stamps below are applied ONLY when the world is at
  // the plants tier, exactly as `expandSector` gates the same fields. They are
  // answers to questions that only exist under plants, and on a capital-tier
  // world each one is actively wrong: `sectorTurn` takes a stored `capitalStock`
  // verbatim there (the 1.1x lazy seed fires only when the field is ABSENT), so
  // the headroom would make these plants ~10% LARGER than an identically-endowed
  // neighbour rather than equal to one; and a `plantsStartTurn` on a non-plants
  // world is the "stale-plants-start-turn" anomaly `plantsTransition` warns
  // about, which would make these rows skip the one-time migration every sibling
  // takes when an admin later flips the world.
  //
  // The un-stamped document is the seed path's own output, which is exactly what
  // a capital-tier world should get: `revenue` is the quantity there, and
  // `capitalStock` is written in lockstep from the same figure.
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
        ...(plantsEnabled
          ? {
              // Absent, `sectorCapacityBookAnchor` falls back to `capitalStock x
              // capacityPricePerUnit` forever, i.e. full LIST price for capacity
              // nobody paid for. Restructuring salvage, nationalization
              // compensation and the listing quote all read that basis and pay
              // out against it, so an absent anchor on plants dropped into a
              // turn-619 world is a money-creation path the `money-conserving`
              // guard cannot see. `expandSector` stamps 0 for exactly this
              // reason, and the state paid nothing for these.
              capacityBookAnchor: 0,
              // Without this the row is a "flip turn" and `sectorTurn` lifts
              // `capitalStock` on the next tick, so the world would not keep the
              // capacity the operator approved. Stamping it also keeps the shed
              // pass from reading a brand-new plant as long-idle.
              plantsStartTurn: currentTurn,
              // ...and because the flip is skipped, the 10% the flip would have
              // added is applied HERE instead. Every sibling sector in these
              // states took that lift on its own flip turn (`seedCapitalStock`
              // is `impliedOutputUnits x CAPITAL_SEED_HEADROOM`), and under
              // plants revenue is derived from capacity, so leaving it off would
              // leave the restored plants permanently ~9% smaller than an
              // identically-endowed neighbour and pinned at full utilisation.
              capitalStock:
                typeof sectorData.capitalStock === "number"
                  ? sectorData.capitalStock * CAPITAL_SEED_HEADROOM
                  : sectorData.capitalStock,
            }
          : {}),
      });
    }
  }
  return docs;
}

async function plan(db: Db, _ctx: HealContext): Promise<HealPlan> {
  const { docs, buildable, unbuildable, withoutEnterprise } = await assess(db);

  const targetStates = buildable.map((s) => s.stateId).sort();
  const targetCorps = [...new Set(docs.map((d) => String(d.corporationId)))].sort();

  const notes = [
    ...buildable.slice(0, 20).map(describe),
    ...skippedNotes(withoutEnterprise, unbuildable),
    "capacityBookAnchor is stamped 0 on every new plant: the state paid nothing " +
      "for this capacity, so it carries no salvage or compensation basis.",
    // Said out loud because rollback CANNOT undo it, by deliberate design (see
    // `touched` below).
    "Rolling this run back deletes the plants but leaves each enterprise's " +
      "soe.planTarget raised. The exact per-enterprise amounts are in the apply " +
      "result. Reverse them by hand before re-applying: the plan target is only " +
      "ever recomputed from zero, so a rollback followed by a second apply " +
      "leaves it raised twice and permanently understates the shortfall that " +
      "drives directed credit.",
  ];

  return {
    affected: targetStates.length,
    // EMPTY ON PURPOSE, even though `apply` raises each enterprise's plan target.
    //
    // `touched` drives a whole-document snapshot, and rollback restores it with
    // `replaceOne`. Listing the owning corporations would mean a rollback taken
    // a few turns later rewinds every OTHER field on a live SOE as well, its
    // `liquidCapital` included: money created or destroyed, invisible to the
    // `money-conserving` guard, to undo a sector insert. The plan target is one
    // additive number and is recoverable by hand from the result notes; a
    // rewound treasury is not. So rollback stays surgical: delete exactly the
    // documents `insertedIds` names, and touch nothing else.
    touched: [],
    // Producing capacity, not currency. No cash, share or capital balance moves;
    // the plants earn from the next turn like any other sector, and the book
    // anchor is stamped 0 so no salvage value is created either.
    moneyDelta: 0,
    // The state and corp ids are IN the summary on purpose. The confirm token
    // hashes {affected, moneyDelta, summary, touched}, so with an insert-only
    // heal a counts-only summary would let a token approved for one set of
    // states authorise a completely different set at the same count.
    summary:
      `build ${docs.length} missing extraction plant(s) in ${targetStates.join(", ") || "no states"}` +
      ` under ${targetCorps.join(", ") || "no enterprise"}, stranded by a country merge`,
    notes,
    payload: { docs, stateIds: targetStates },
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
  // concurrent reconcile, a second operator) must not be duplicated. Both
  // collections are consulted, matching `survey`: an unowned extraction market
  // that appeared in the meantime is coverage too, and inserting an owned plant
  // beside it would count the same capacity twice.
  const stateIds = docs.map((d) => d.stateId as string);
  const [ownedNow, unownedNow] = await Promise.all([
    db
      .collection("corporateSectors")
      .distinct("stateId", { stateId: { $in: stateIds }, sectorType: "extraction" }),
    db
      .collection("unownedSectors")
      .distinct("stateId", { stateId: { $in: stateIds }, sectorType: "extraction" }),
  ]);
  const alreadyCovered = new Set([...ownedNow, ...unownedNow] as string[]);

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
  const stamped: Record<string, unknown>[] = toInsert.map((doc) => ({ ...doc, updatedAt: now }));

  // INSERTED ONE AT A TIME, ON PURPOSE, and the ids are recorded as they land.
  //
  // A single `insertMany` that fails part-way through throws, so the ids of the
  // rows that DID land never reach the result, and rollback is then told there
  // is nothing to undo while live plants sit in the collection earning revenue
  // with no record they exist. At most a few dozen documents, so the round
  // trips are irrelevant next to being able to reverse the write.
  const insertedIdList: string[] = [];
  const failures: string[] = [];
  for (const doc of stamped) {
    try {
      await db.collection("corporateSectors").insertOne(doc as never);
      insertedIdList.push(String(doc._id));
    } catch (error) {
      failures.push(`${doc.stateId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const insertedIds: TouchedDocs[] = [{ collection: "corporateSectors", ids: insertedIdList }];

  // Bring the owning enterprise's plan up to the plant list it now operates.
  // `planTarget` is STICKY (`commandEconomyTurn` only recomputes it from zero),
  // so leaving it behind would read as permanent over-fulfilment: the director's
  // grade inflates, the shortfall that drives directed credit shrinks, and the
  // enterprise is under-funded against its peers for the rest of the run. The
  // seed path sums it over every plant at build time, which is exactly what an
  // un-misfired gate would have produced.
  const planTargetByCorp = new Map<string, number>();
  for (const doc of stamped) {
    if (!insertedIdList.includes(String(doc._id))) continue;
    const corpId = String(doc.corporationId);
    const revenue = typeof doc.revenue === "number" ? doc.revenue : 0;
    planTargetByCorp.set(corpId, (planTargetByCorp.get(corpId) ?? 0) + revenue);
  }
  // NEVER THROWS PAST THIS POINT. The plants are already in the collection and
  // their ids only reach rollback through the returned result, so a plan-target
  // update that failed and propagated would take the receipt for live documents
  // with it. A failure here is recorded in the notes instead; the sectors are
  // correct either way and the plan target is recoverable by hand.
  const planTargetNotes: string[] = [];
  let planTargetsRaised = 0;
  for (const [corpId, added] of planTargetByCorp) {
    try {
      const res = await db
        .collection("corporations")
        .updateOne(
          { _id: new ObjectId(corpId), "soe.planTarget": { $exists: true } },
          { $inc: { "soe.planTarget": Math.round(added) }, $set: { updatedAt: now } }
        );
      if (res.modifiedCount > 0) planTargetsRaised++;
      planTargetNotes.push(
        res.modifiedCount > 0
          ? `raised ${corpId} soe.planTarget by ${Math.round(added)}`
          : `${corpId} carries no soe.planTarget; left alone`
      );
    } catch (error) {
      planTargetNotes.push(
        `FAILED to raise ${corpId} soe.planTarget by ${Math.round(added)}, raise it by hand: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    documentsScanned: docs.length,
    documentsInserted: insertedIdList.length,
    documentsUpdated: planTargetsRaised,
    notes: [
      `built ${insertedIdList.length} extraction plant(s) in ${[...new Set(toInsert.map((d) => d.stateId))].join(", ")}`,
      ...planTargetNotes,
      ...(skipped > 0 ? [`${skipped} skipped: a sector appeared since the plan was approved`] : []),
      ...(failures.length > 0
        ? [
            `${failures.length} insert(s) FAILED and the run is incomplete; verify will still report them as stranded: ${failures.join("; ")}`,
          ]
        : []),
    ],
    insertedIds,
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  // The SAME assessment `detect` and `plan` use, so a state this heal cannot
  // build can never hold the defect open and the three can never disagree.
  const { buildable, unbuildable, withoutEnterprise } = await assess(db);

  return {
    ok: buildable.length === 0,
    remaining: buildable.length,
    notes: [
      buildable.length === 0
        ? "every command-economy state with deposits and an enterprise now carries an extraction sector"
        : `${buildable.length} state(s) still stranded: ${buildable.map((r) => `${r.countryId}/${r.stateId}`).join(", ")}`,
      ...skippedNotes(withoutEnterprise, unbuildable),
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
  // The seed half is the gate itself, and it is fixed upstream (#1405):
  // `buildCommandSoeCorpEntries` resolves the capacity key through
  // `lookupStateResourceCapacity`, so a rebuild or a world reset places the
  // plants instead of skipping them. `seedStateResourceCapacity` carried the
  // same bare-key lookup and would have WIPED the deposits of every merged-in
  // state on the next re-seed; fixed in the same upstream change.
  //
  // ONE HAZARD FOR THE OPERATOR. Now that the gate is fixed,
  // `reconcileCommandEconomyUnowned` will build these same plants itself if it
  // is ever re-run, but from the raw seed path: no `plantsStartTurn`, no
  // `capacityBookAnchor`, i.e. a full list-price salvage basis. Worse, running
  // it AFTER this heal `$set`s `capitalStock` back to the un-headroomed value
  // while leaving `plantsStartTurn` stamped, silently undoing the 1.1x. Run one
  // or the other, not both.
  seedFix: {
    status: "fixed",
    files: [
      "src/lib/seeds/reference/budgets.ts",
      "src/lib/seeds/reference/stateResourceCapacity.ts",
      "src/lib/admin/seed/seedStateResourceCapacity.ts",
    ],
    seedCheck: { countryId: "DD", era: "1953-default" },
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
