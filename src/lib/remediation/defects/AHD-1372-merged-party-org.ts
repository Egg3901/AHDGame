// AHD-1372: merged-away parties retained statePartyOrg rows in older worlds.
//
// The current merge path transfers half the absorbed party's Org, releases its
// Reg share to the state's unregistered pool, and deletes the old rows. UK
// mergers completed before that cleanup shipped left the party tombstone and
// all of its regional rows behind. Those rows remained visible in Org/Reg lists
// and continued participating in registration drift.
//
// Half A (code): every regional reader joins statePartyOrg to active parties,
// so a historical tombstone can never be presented as a live organization.
// Half B (this heal): restore the registration-pool invariant from active rows,
// then delete the defunct party rows. The pool value is SET from the invariant,
// not incremented, so a retry after any partial application is idempotent.

import type { Db } from "mongodb";
import type { PoliticalParty, StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "../types";

interface DefunctParty {
  countryId: CountryId;
  sequentialId: number;
  name?: string;
  abbreviation?: string;
}

type StalePartyOrg = Pick<
  StatePartyOrg,
  "_id" | "countryId" | "stateId" | "partyId" | "organization" | "registration"
>;

interface PoolRepair {
  id: string;
  countryId: CountryId;
  stateId: string;
  unregistered: number;
}

interface RepairPayload {
  staleRows: Array<{ id: string; countryId: CountryId; stateId: string; partyId: string }>;
  pools: PoolRepair[];
}

interface Survey {
  staleRows: StalePartyOrg[];
  healableRows: StalePartyOrg[];
  blockedRows: StalePartyOrg[];
  pools: PoolRepair[];
  partyByKey: Map<string, DefunctParty>;
  blockedNotes: string[];
}

const keyFor = (countryId: string, value: string | number) => `${countryId}:${value}`;
const stateKeyFor = (countryId: string, stateId: string) => `${countryId}:${stateId}`;

function roundShare(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 1e12) / 1e12;
}

async function survey(db: Db): Promise<Survey> {
  const defunctParties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { isDefunct: true },
      { projection: { countryId: 1, sequentialId: 1, name: 1, abbreviation: 1 } }
    )
    .toArray();
  const parties = defunctParties.map((party) => ({
    countryId: party.countryId,
    sequentialId: party.sequentialId,
    name: party.name,
    abbreviation: party.abbreviation,
  }));
  const partyByKey = new Map(
    parties.map((party) => [keyFor(party.countryId, party.sequentialId), party])
  );
  if (parties.length === 0) {
    return {
      staleRows: [],
      healableRows: [],
      blockedRows: [],
      pools: [],
      partyByKey,
      blockedNotes: [],
    };
  }

  const staleRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find(
      {
        $or: parties.map((party) => ({
          countryId: party.countryId,
          partyId: String(party.sequentialId),
        })),
      },
      {
        projection: {
          countryId: 1,
          stateId: 1,
          partyId: 1,
          organization: 1,
          registration: 1,
        },
      }
    )
    .toArray();
  if (staleRows.length === 0) {
    return {
      staleRows: [],
      healableRows: [],
      blockedRows: [],
      pools: [],
      partyByKey,
      blockedNotes: [],
    };
  }

  const affectedStates = Array.from(
    new Map(
      staleRows.map((row) => [
        stateKeyFor(row.countryId, row.stateId),
        { countryId: row.countryId, stateId: row.stateId },
      ])
    ).values()
  );
  const countryIds = [...new Set(affectedStates.map((state) => state.countryId))];
  const [allRows, activeParties, poolRows] = await Promise.all([
    db.collection<StatePartyOrg>("statePartyOrg").find({ $or: affectedStates }).toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find(
        { countryId: { $in: countryIds }, isDefunct: { $ne: true } },
        { projection: { countryId: 1, sequentialId: 1 } }
      )
      .toArray(),
    db
      .collection<StateRegistrationPool>("stateRegistrationPool")
      .find({ $or: affectedStates })
      .toArray(),
  ]);

  const activePartyKeys = new Set(
    activeParties.map((party) => keyFor(party.countryId, party.sequentialId))
  );
  const poolByState = new Map(
    poolRows.map((pool) => [stateKeyFor(pool.countryId, pool.stateId), pool])
  );
  const pools: PoolRepair[] = [];
  const healableStateKeys = new Set<string>();
  const blockedNotes: string[] = [];

  for (const state of affectedStates) {
    const stateKey = stateKeyFor(state.countryId, state.stateId);
    const pool = poolByState.get(stateKey);
    const staleRegistration = staleRows
      .filter((row) => stateKeyFor(row.countryId, row.stateId) === stateKey)
      .reduce((sum, row) => sum + (typeof row.registration === "number" ? row.registration : 0), 0);
    if (!pool && staleRegistration > 0) {
      blockedNotes.push(`${stateKey} has stale registration but no stateRegistrationPool`);
      continue;
    }

    if (!pool) {
      healableStateKeys.add(stateKey);
      continue;
    }

    const activeRegistration = allRows
      .filter(
        (row) =>
          stateKeyFor(row.countryId, row.stateId) === stateKey &&
          activePartyKeys.has(keyFor(row.countryId, row.partyId))
      )
      .reduce((sum, row) => sum + (typeof row.registration === "number" ? row.registration : 0), 0);
    const independent = pool.independent ?? 0;
    const rawUnregistered = 100 - independent - activeRegistration;
    if (
      !Number.isFinite(independent) ||
      !Number.isFinite(activeRegistration) ||
      independent < 0 ||
      activeRegistration < 0 ||
      rawUnregistered < -1e-9 ||
      rawUnregistered > 100 + 1e-9
    ) {
      blockedNotes.push(
        `${stateKey} has invalid active registration totals (active=${activeRegistration}, independent=${independent})`
      );
      continue;
    }

    healableStateKeys.add(stateKey);
    pools.push({
      id: String(pool._id),
      countryId: state.countryId,
      stateId: state.stateId,
      unregistered: roundShare(rawUnregistered),
    });
  }

  return {
    staleRows,
    healableRows: staleRows.filter((row) =>
      healableStateKeys.has(stateKeyFor(row.countryId, row.stateId))
    ),
    blockedRows: staleRows.filter(
      (row) => !healableStateKeys.has(stateKeyFor(row.countryId, row.stateId))
    ),
    pools,
    partyByKey,
    blockedNotes,
  };
}

async function detect(db: Db): Promise<DetectResult> {
  const found = await survey(db);
  return {
    affected: found.staleRows.length,
    sample: found.staleRows.slice(0, 10).map((row) => {
      const party = found.partyByKey.get(keyFor(row.countryId, row.partyId));
      return {
        id: row._id,
        countryId: row.countryId,
        stateId: row.stateId,
        partyId: row.partyId,
        party: party?.abbreviation ?? party?.name ?? row.partyId,
        organization: row.organization ?? 0,
        registration: row.registration ?? 0,
      };
    }),
    notes: [
      `${found.healableRows.length} row(s) can be repaired automatically`,
      `${found.blockedRows.length} row(s) require review`,
      ...found.blockedNotes,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const found = await survey(db);
  const payload: RepairPayload = {
    staleRows: found.healableRows.map((row) => ({
      id: row._id,
      countryId: row.countryId,
      stateId: row.stateId,
      partyId: row.partyId,
    })),
    pools: found.pools,
  };
  return {
    affected: found.healableRows.length,
    touched: [
      { collection: "statePartyOrg", ids: payload.staleRows.map((row) => row.id) },
      { collection: "stateRegistrationPool", ids: payload.pools.map((pool) => pool.id) },
    ],
    moneyDelta: 0,
    summary: `release registration and delete ${found.healableRows.length} merged-party regional row(s) across ${found.pools.length} pool(s)`,
    notes: found.blockedRows.length > 0 ? found.blockedNotes : [],
    payload,
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: { now: Date }): Promise<HealResult> {
  const payload = healPlan.payload as RepairPayload | undefined;
  if (!payload || payload.staleRows.length === 0) {
    return { documentsScanned: 0, documentsUpdated: 0, documentsDeleted: 0 };
  }

  const approvedIds = new Set(payload.staleRows.map((row) => row.id));
  const approvedById = new Map(payload.staleRows.map((row) => [row.id, row]));
  const currentRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ _id: { $in: [...approvedIds] } })
    .toArray();
  const partyPairs = Array.from(
    new Map(
      currentRows.map((row) => [
        keyFor(row.countryId, row.partyId),
        { countryId: row.countryId, sequentialId: Number(row.partyId) },
      ])
    ).values()
  );
  const stillDefunct = partyPairs.length
    ? await db
        .collection<PoliticalParty>("politicalParties")
        .find({
          isDefunct: true,
          $or: partyPairs,
        })
        .toArray()
    : [];
  const defunctKeys = new Set(
    stillDefunct.map((party) => keyFor(party.countryId, party.sequentialId))
  );
  const toDelete = currentRows.filter((row) => {
    const approved = approvedById.get(row._id);
    return (
      approved != null &&
      approved.countryId === row.countryId &&
      approved.stateId === row.stateId &&
      approved.partyId === row.partyId &&
      defunctKeys.has(keyFor(row.countryId, row.partyId))
    );
  });
  if (toDelete.length !== currentRows.length) {
    throw new Error(
      `${currentRows.length - toDelete.length} approved row(s) changed identity or no longer belong to a defunct party`
    );
  }
  const affectedStates = new Set(toDelete.map((row) => stateKeyFor(row.countryId, row.stateId)));
  const poolRepairs = payload.pools.filter((pool) =>
    affectedStates.has(stateKeyFor(pool.countryId, pool.stateId))
  );

  let poolsUpdated = 0;
  if (poolRepairs.length > 0) {
    const poolWrite = await db.collection<StateRegistrationPool>("stateRegistrationPool").bulkWrite(
      poolRepairs.map((pool) => ({
        updateOne: {
          filter: { _id: pool.id, countryId: pool.countryId, stateId: pool.stateId },
          update: { $set: { unregistered: pool.unregistered, updatedAt: ctx.now } },
        },
      }))
    );
    if (poolWrite.matchedCount !== poolRepairs.length) {
      throw new Error(
        `registration pool repair matched ${poolWrite.matchedCount} of ${poolRepairs.length} approved row(s)`
      );
    }
    poolsUpdated = poolWrite.modifiedCount;
  }

  const deleted = toDelete.length
    ? await db.collection<StatePartyOrg>("statePartyOrg").deleteMany({
        _id: { $in: toDelete.map((row) => row._id) },
      })
    : { deletedCount: 0 };
  if (deleted.deletedCount !== toDelete.length) {
    throw new Error(
      `merged-party cleanup deleted ${deleted.deletedCount} of ${toDelete.length} approved row(s)`
    );
  }

  return {
    documentsScanned: currentRows.length,
    documentsUpdated: poolsUpdated,
    documentsDeleted: deleted.deletedCount,
    notes: [
      `set ${poolRepairs.length} registration pool(s) from the active-party invariant`,
      `deleted ${deleted.deletedCount} approved defunct-party regional row(s)`,
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const result = await detect(db);
  return {
    ok: result.affected === 0,
    remaining: result.affected,
    notes:
      result.affected === 0
        ? ["no defunct party retains a regional Org/Reg row"]
        : (result.notes ?? []),
  };
}

export const defect: Defect = {
  id: "AHD-1372",
  title: "Merged parties retain regional organization and registration rows",
  severity: "P2",
  codeFix: {
    mergedTo: "development",
    requiredCommit: "885d7bb46624e22cc1060ab2d953a263eab8e1cd",
  },
  seedFix: {
    status: "not-needed",
    files: ["src/lib/admin/seed/seedParties.ts"],
    note: "fresh worlds contain no defunct parties; the stale shape only follows a runtime merger",
  },
  envs: ["dev", "sandbox", "prod"],
  idempotent: true,
  guards: ["turn-lock-free", "max-affected:500", "money-conserving"],
  detect,
  plan,
  apply,
  verify,
};
