/**
 * Post-bootstrap finalize pass for a world reset.
 *
 * `resetGameWorld` tears the old world down; `bootstrapGameWorld` builds the new
 * one. Everything here is the third phase: the steps that need a FULLY SEEDED
 * world and therefore cannot live in the teardown.
 *
 * They used to live in `resetGameWorld`, which called `seedAllCountryData`
 * itself so they had something to operate on. That call was the double-seed —
 * `resetAndBootstrapGameWorld` runs `bootstrapGameWorld` immediately afterwards,
 * which seeds the identical world a second time, and the reset-path call passed
 * a no-op logger so the duplicate pass logged nothing. Measured at exactly 2.00x
 * the write count on every collection `seedAllCountryData` touches.
 *
 * ⚠️ Deleting that call meant these steps had to move, not just shift: run
 * BEFORE bootstrap they would operate on the OUTGOING preset's data and then be
 * discarded by bootstrap's own drops. Two of them were in fact already being
 * discarded that way, and their counts in the reset result and the adminLog
 * described work that never survived — `demographicsReset`,
 * `customPartiesDeleted` and `partyOrgRecordsDeleted` are honest for the first
 * time here.
 *
 * ⚠️ `partyCharters` is the one to watch. It is NOT in `runSeed`'s drop list and
 * its cleanup keys on surviving default parties' `sequentialId`s. Run before
 * bootstrap it compared against PRE-drop ids, i.e. the wrong ones; run here it
 * compares against the ids the new world actually has.
 */

import type { Db, ObjectId } from "mongodb";
import type { PoliticalParty, StateDemographics, StatePartyOrg } from "@/lib/db/types";
import { getPresetById } from "@/lib/constants/historicalSeats";
import { ensureDefaultParties } from "@/lib/seeds/ensureDefaultParties";
import { realignPartyCountersToExisting, resetPartyCounters } from "@/lib/db/sequentialId";
import { ensureImfInstitutionPlaceholder } from "@/lib/imf/ensureImfInstitutionPlaceholder";
import type { ResetGameWorldResult } from "@/lib/admin/resetGameWorld";

export interface FinalizeResetOptions {
  preset: string;
  /** Teardown counts from `resetGameWorld`, folded into `adminDetails`. */
  teardown: ResetGameWorldResult["details"];
  deleteProfiles: boolean;
  log?: (msg: string) => void;
}

export interface FinalizeResetResult {
  demographicsReset: number;
  customPartiesDeleted: number;
  partyOrgRecordsDeleted: number;
  finalizeLog: string[];
  /**
   * The human-readable summary for the reset's audit row. Returned rather than
   * written here: the row is opened by the orchestrator at the seal and closed
   * with this, so a run that never reaches finalize is still recorded.
   */
  adminDetails: string;
}

export async function finalizeResetGameWorld(
  db: Db,
  options: FinalizeResetOptions
): Promise<FinalizeResetResult> {
  const { preset, teardown, deleteProfiles } = options;
  const now = new Date();
  const sink = options.log;
  const finalizeLog: string[] = [];
  const log = (msg: string) => {
    finalizeLog.push(msg);
    sink?.(`[finalize] ${msg}`);
  };
  const logCollector = log;

  // Add any default parties the new preset expects BEFORE seedHistoricalOfficials
  // runs — otherwise the NPP seeder resolves a missing preset-only slug
  // (e.g. uk_uup on a 1991 reset coming from a 2019 game) to "independent"
  // and the Commons MPs end up un-partied. Realign party counters first so
  // the new party gets `max(sequentialId) + 1`, never a colliding seqId.
  await realignPartyCountersToExisting(db);
  await ensureDefaultParties(db, preset);
  // Mirror for statePartyOrg: insert rows for newly-added defaults so they
  // show up on the region Party Organizations page. Non-destructive — never
  // overwrites existing rows.
  const { ensureMissingUKStatePartyOrgRows } = await import("@/lib/admin/seed/seedUK");
  await ensureMissingUKStatePartyOrgRows(db, log, preset);
  const { ensureMissingDEStatePartyOrgRows } = await import("@/lib/admin/seed/seedDE");
  await ensureMissingDEStatePartyOrgRows(db, log, preset);
  const { ensureMissingJPStatePartyOrgRows } = await import("@/lib/admin/seed/seedJP");
  await ensureMissingJPStatePartyOrgRows(db, log, preset);
  const { ensureMissingBRStatePartyOrgRows } = await import("@/lib/admin/seed/seedBR");
  await ensureMissingBRStatePartyOrgRows(db, log, preset);
  const { ensureMissingIEStatePartyOrgRows } = await import("@/lib/admin/seed/seedIE");
  await ensureMissingIEStatePartyOrgRows(db, log, preset);
  const { seedCnStatePartyOrg } = await import("@/lib/admin/seed/seedCnStatePartyOrg");
  await seedCnStatePartyOrg(db, false, log, preset);

  let demographicsReset = 0;
  const defaultDemographics = await db
    .collection<StateDemographics>("demographicDefaults")
    .find({})
    .toArray();

  if (defaultDemographics.length > 0) {
    for (const defaultDemo of defaultDemographics) {
      await db.collection<StateDemographics>("stateDemographics").updateOne(
        { _id: defaultDemo._id },
        {
          $set: {
            categoryWeights: defaultDemo.categoryWeights,
            groups: defaultDemo.groups,
            lastUpdated: now,
          },
        },
        { upsert: true }
      );
      demographicsReset++;
    }
  }

  const presetConfig = getPresetById(preset);
  const deleteAllParties = presetConfig?.deleteDefaultParties ?? false;

  let customPartiesResult;

  if (deleteAllParties) {
    customPartiesResult = await db.collection<PoliticalParty>("politicalParties").deleteMany({});
    await resetPartyCounters(db);
    // Phase 6 reset: drop ALL charter rows so stale ratified / migrated
    // charters can't immunize newly-resequenced parties from cleanup, and
    // so the migration script can re-run idempotently on the fresh seed.
    await db.collection("partyCharters").deleteMany({});
  } else {
    customPartiesResult = await db
      .collection<PoliticalParty>("politicalParties")
      .deleteMany({ isDefault: { $ne: true } });
    // Phase 6 reset: drop charters tied to the deleted custom parties.
    // Default parties don't carry charter rows (they bypass the system
    // per D5), so this is safe to run unconditionally — a default-only
    // DB will simply match nothing.
    const survivingPartyIds = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ isDefault: true })
      .project<{ sequentialId: number; countryId: string }>({ sequentialId: 1, countryId: 1 })
      .toArray();
    const survivingKeys = new Set(
      survivingPartyIds.map((p) => `${p.countryId}:${String(p.sequentialId)}`)
    );
    const allCharters = (await db
      .collection("partyCharters")
      .find({})
      .project({ _id: 1, partyId: 1, countryId: 1 })
      .toArray()) as Array<{ _id: ObjectId; partyId: string | null; countryId: string }>;
    const staleIds: ObjectId[] = allCharters
      .filter(
        (c) =>
          c.partyId === null ||
          c.partyId === undefined ||
          !survivingKeys.has(`${c.countryId}:${c.partyId}`)
      )
      .map((c) => c._id);
    if (staleIds.length > 0) {
      await db.collection("partyCharters").deleteMany({ _id: { $in: staleIds } });
    }

    await db.collection<PoliticalParty>("politicalParties").updateMany(
      { isDefault: true },
      {
        $set: {
          treasury: 1000000,
          memberCount: 0,
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          campaignerIds: [],
          updatedAt: now,
        },
        $unset: {
          coalitionId: "",
          logoUrl: "",
          heroImageUrl: "",
          // Per-game cooldowns + locked state. These are turn-based
          // (`*UntilTurn` compared against currentTurn, which resets to 1) or
          // game-scoped, so a stale value from the previous run would otherwise
          // lock the action for nearly the entire new game. Default parties
          // survive the reset in place, so they must be cleared explicitly —
          // the deleteAllParties branch drops the rows entirely instead.
          nppRecruitmentCooldownUntil: "",
          nppRecruitmentCooldownUntilTurn: "",
          lastPurgeAtTurn: "",
          purgeCount: "",
          positionShiftCooldowns: "",
          proposalCooldowns: "",
          priorityRegion: "",
          // Proposal-voted governance settings are game-scoped. Without these,
          // a party that passed a proposal last game would carry it into the
          // new one: elections at the old custom length instead of
          // NATIONAL_ELECTION_DURATION_TURNS, a "committee" election method
          // pointed at a committee that no longer exists, or a stale treasury
          // approval mode. ensureDefaultParties only inserts missing parties —
          // it never re-stamps survivors — so nothing downstream restores the
          // seed defaults.
          customElectionDurationTurns: "",
          leadershipElectionMethod: "",
          transactionApprovalMode: "",
        },
      }
    );

    // Drop default parties that don't match the new preset (e.g. UUP /
    // PDS / JSP / DSP are 1991-only; AfD / Linke / Reform UK / CDP /
    // Ishin / DPFP are 2019-only). A reset to the other preset must
    // remove the stale entries so the new roster doesn't carry parties
    // from the wrong era. Looks at the `validForPresets` field on the
    // party seed.
    const { ukParties } = await import("@/lib/seeds/uk/ukParties");
    const { politicalParties: usParties } = await import("@/lib/seeds/reference/politicalParties");
    const { deParties } = await import("@/lib/seeds/de/deParties");
    const { jpParties } = await import("@/lib/seeds/jp/jpParties");
    const { brParties } = await import("@/lib/seeds/br/brParties");
    const { ieParties } = await import("@/lib/seeds/ie/ieParties");
    const { frParties } = await import("@/lib/seeds/fr/frParties");
    const { itParties } = await import("@/lib/seeds/it/itParties");
    const { esParties } = await import("@/lib/seeds/es/esParties");
    const { seParties } = await import("@/lib/seeds/se/seParties");
    const { trParties } = await import("@/lib/seeds/tr/trParties");
    const { huParties } = await import("@/lib/seeds/hu/huParties");
    const { roParties } = await import("@/lib/seeds/ro/roParties");
    const { ngParties } = await import("@/lib/seeds/ng/ngParties");
    const { ruParties } = await import("@/lib/seeds/ru/ruParties");
    const { ddParties } = await import("@/lib/seeds/dd/ddParties");
    const { plParties } = await import("@/lib/seeds/pl/plParties");
    const { yuParties } = await import("@/lib/seeds/yu/yuParties");
    const { csParties } = await import("@/lib/seeds/cs/csParties");
    const { bgParties } = await import("@/lib/seeds/bg/bgParties");
    const { blrParties } = await import("@/lib/seeds/blr/blrParties");
    const { balParties } = await import("@/lib/seeds/bal/balParties");
    const presetMismatchedNames = [
      ...usParties,
      ...ukParties,
      ...deParties,
      ...jpParties,
      ...brParties,
      ...ieParties,
      ...frParties,
      ...itParties,
      ...esParties,
      ...seParties,
      ...trParties,
      ...huParties,
      ...roParties,
      ...ngParties,
      ...ruParties,
      ...ddParties,
      ...plParties,
      ...yuParties,
      ...csParties,
      ...bgParties,
      ...blrParties,
      ...balParties,
    ]
      .filter((seed) => seed.validForPresets && !seed.validForPresets.includes(preset))
      .map((seed) => ({ countryId: seed.countryId, name: seed.name }));
    if (presetMismatchedNames.length > 0) {
      const orFilter = presetMismatchedNames.map(({ countryId, name }) => ({
        countryId,
        name,
        isDefault: true,
      }));
      const deletedMismatched = await db
        .collection<PoliticalParty>("politicalParties")
        .deleteMany({ $or: orFilter });
      if (deletedMismatched.deletedCount > 0) {
        // Was a bare console.log with a hand-written "[reset]" prefix, so it
        // reached the container's stdout but never the admin's stream. The sink
        // adds the same prefix.
        log(
          `Removed ${deletedMismatched.deletedCount} preset-mismatched default party(s) for preset ${preset}`
        );
      }
    }

    const existingDefaultCount = await db
      .collection<PoliticalParty>("politicalParties")
      .countDocuments({ isDefault: true });

    if (existingDefaultCount === 0) {
      await resetPartyCounters(db);
    } else {
      // Surviving parties retain their sequentialIds. Realign every
      // party_<country> counter to max(sequentialId) so the next insert
      // (e.g. UUP when switching to 1991-default) gets max+1 instead of
      // colliding with an existing party. Also self-heals counters that
      // were wiped by an earlier failed reset.
      await realignPartyCountersToExisting(db);
    }

    await ensureDefaultParties(db, preset);
  }

  let partyOrgCleanupResult;
  if (deleteAllParties) {
    partyOrgCleanupResult = await db.collection<StatePartyOrg>("statePartyOrg").deleteMany({});
  } else {
    const defaultParties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ isDefault: true })
      .project({ sequentialId: 1 })
      .toArray();
    const defaultPartyIds = defaultParties.map((p) => String(p.sequentialId));

    partyOrgCleanupResult = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .deleteMany({ partyId: { $nin: defaultPartyIds } });

    await db.collection<StatePartyOrg>("statePartyOrg").updateMany(
      { partyId: { $in: defaultPartyIds } },
      {
        $set: {
          chairId: null,
          viceChairId: null,
          treasurerId: null,
          campaignerId: null,
          updatedAt: now,
        },
        // State-level NPP recruitment cooldown — turn-based, so a leftover
        // value strands the slot for the new game. Default-party org rows
        // survive in place (rows tied to deleted custom parties are removed
        // above), so clear it explicitly.
        $unset: {
          nppRecruitmentCooldownUntil: "",
          nppRecruitmentCooldownUntilTurn: "",
        },
      }
    );
  }

  // Orphan region-keyed row purge. `unownedSectors` and `regionDemographics` are
  // manifest `reference` collections, so the runtime sweep never touches them,
  // and both seeders are upsert-only fills that iterate the CURRENT `states`
  // roster — neither can remove a row for a region the new preset does not seed.
  // A preset switch therefore strands every row from the outgoing region scheme.
  //
  // Confirmed live after a 1979 → 1953 reset: 238 orphan `unownedSectors` rows,
  // including `BY`/`BY_BEL` — `BY` is not a CountryId at all (it is Bavaria, a DE
  // state id), the exact stale-id shape that crashed the corporation turn in
  // #3523 — plus DD/PL/YU/HU/BG/CS rows still on the 1979 region scheme
  // (DD_BER/DD_NOR/DD_SOU, PL_CEN/PL_SOU/PL_NOR, YU_NW/YU_CEN/YU_SOU, …). Three
  // orphan DD `regionDemographics` rows also double-counted DD's population
  // (36.8M against a real 18.4M) because population sums over the collection.
  //
  // Runs after every region seeder above, so `states` is the final roster.
  // `regionDemographics._id` IS the region id (matches `states._id`);
  // `unownedSectors` keys on `stateId`. Guarded on a non-empty roster so a
  // half-failed seed can never empty either collection.
  const seededStateIds = (
    await db
      .collection<{ _id: string }>("states")
      .find({}, { projection: { _id: 1 } })
      .toArray()
  ).map((s) => s._id as string);
  let orphanUnownedSectorsDeleted = 0;
  let orphanRegionDemographicsDeleted = 0;
  if (seededStateIds.length > 0) {
    orphanUnownedSectorsDeleted = (
      await db.collection("unownedSectors").deleteMany({ stateId: { $nin: seededStateIds } })
    ).deletedCount;
    orphanRegionDemographicsDeleted =
      // Typed on `_id: string` — this collection keys on the region id, not the
      // default ObjectId, so an untyped handle rejects the string `$nin`.
      (
        await db
          .collection<{ _id: string }>("regionDemographics")
          .deleteMany({ _id: { $nin: seededStateIds } })
      ).deletedCount;
    if (orphanUnownedSectorsDeleted > 0 || orphanRegionDemographicsDeleted > 0) {
      logCollector(
        `Purged orphan region rows: ${orphanUnownedSectorsDeleted} unownedSectors, ` +
          `${orphanRegionDemographicsDeleted} regionDemographics (regions absent from the ${preset} roster).`
      );
    }
  }

  // IMF placeholder: corp wipe above removed any prior IMF Corp; recreate
  // the singleton stub so sovereign-default orchestrators have a Corp to
  // reference. Admin assigns Board members afterward via the panel's
  // System → Post Reset Checklist (the old /admin/setup redirects there).
  const imfResult = await ensureImfInstitutionPlaceholder(db);
  if (imfResult.created) {
    logCollector(
      `IMF Corp placeholder seeded (sequentialId=${imfResult.sequentialId ?? "?"}). ` +
        `Assign Board members via System → Post Reset Checklist.`
    );
  } else {
    logCollector(`IMF Corp already present (sequentialId=${imfResult.sequentialId ?? "?"}).`);
  }

  // The audit row is OPENED by the orchestrator at the seal and CLOSED with
  // this string. It used to be inserted right here, which is precisely why a
  // reset that died in teardown or build left no trace at all — this code never
  // ran. The message text is unchanged, and it is no longer gated on
  // `adminUsername`: that gate meant a script-driven reset was never audited.
  const adminDetails = deleteProfiles
    ? `Full game reset: ${teardown.usersDeleted ?? 0} users, ${teardown.charactersDeleted ?? 0} characters, ${teardown.officialsDeleted} officials deleted, ${teardown.electionsDeleted} elections, ${teardown.nppsDeleted} NPPs deleted, ${teardown.statePartyElectionsDeleted} state party elections, ${teardown.stateBillsDeleted} state bills, ${demographicsReset} demographics reset, ${customPartiesResult.deletedCount} custom parties deleted, ${partyOrgCleanupResult.deletedCount} party org records deleted`
    : `Game reset: ${teardown.charactersRetired ?? 0} characters retired, ${teardown.officialsDeleted} officials deleted, ${teardown.electionsDeleted} elections, ${teardown.nppsDeleted} NPPs deleted, ${teardown.statePartyElectionsDeleted} state party elections, ${teardown.stateBillsDeleted} state bills, ${demographicsReset} demographics reset, ${customPartiesResult.deletedCount} custom parties deleted, ${partyOrgCleanupResult.deletedCount} party org records deleted`;

  return {
    demographicsReset,
    customPartiesDeleted: customPartiesResult.deletedCount,
    partyOrgRecordsDeleted: partyOrgCleanupResult.deletedCount,
    finalizeLog,
    adminDetails,
  };
}
