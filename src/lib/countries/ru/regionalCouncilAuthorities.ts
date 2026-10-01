/**
 * Regional Council authority uses a bounded proxy of certified constituency support.
 * materializeRussianRegionalAuthorities records distinct regional people backed by
 * existing NPC groups, without creating financial profiles or regional player offices.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryGameState, ElectedOfficial, GameState, NPP } from "@/lib/db/types";
import { loadEnactedRussianCouncilFormation } from "./councilFormationProposals";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import {
  loadCurrentRussianDumaClock,
  RUSSIAN_DUMA_AUTHORITY_PROJECTION,
} from "./dumaConvocationAuthority";
import type { RussianDumaResultRecord } from "./dumaElectionResult";
import {
  russianRegionalCouncilOfficeCompatible,
  planRussianCouncilComposition,
  type RussianCouncilRegionalAuthority,
} from "./rules/councilComposition";
import {
  planRussianRegionalCouncilAppointments,
  planRussianRegionalCouncilDelegates,
  planRussianRegionalCouncilRenewals,
  russianRegionalSupportFromDuma,
  type RussianRegionalNpcProfile,
} from "./rules/regionalCouncilAppointments";

export const RUSSIAN_REGIONAL_AUTHORITIES_COLLECTION = "russianRegionalAuthorities";
export interface RussianRegionalAuthorityRecord extends RussianCouncilRegionalAuthority {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  formationProposalId: string;
  formationRevision: number;
  sourceDumaResultId: string;
  sourceDumaRoot: ObjectId;
  decisionReason: "highest-regional-support-with-eligible-nominee";
  supportModel: "certified-duma-constituency-proxy";
  regionalTermModel: "bounded-four-year-default";
  regionalPartyVotes: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}
export interface RussianRegionalCouncilSeatingInputs {
  authorities: RussianRegionalAuthorityRecord[];
  profiles: RussianRegionalNpcProfile[];
}

/** Project existing groups and both physical and mirrored incompatible offices in batches. */
export async function loadRussianRegionalNpcProfiles(db: Db, session: ClientSession) {
  const profiles = await db
    .collection<NPP>("npps")
    .find(
      { countryId: "RU", retiredAt: null, isTechnocrat: { $ne: true } },
      { session, batchSize: 1000, projection: { name: 1, party: 1, currentOffice: 1 } }
    )
    .toArray();
  const ids = profiles.map((row) => row._id);
  const incompatible = new Set<string>();
  if (ids.length) {
    const physical = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find(
        { nppId: { $in: ids } },
        { session, batchSize: 1000, projection: { nppId: 1, countryId: 1, officeType: 1 } }
      )
      .toArray();
    const cabinet = await db
      .collection<UnifiedCabinetMember>("cabinetMembers")
      .find({ nppId: { $in: ids } }, { session, batchSize: 1000, projection: { nppId: 1 } })
      .toArray();
    for (const row of physical)
      if (
        row.nppId &&
        !russianRegionalCouncilOfficeCompatible({
          officeType: row.officeType,
          countryId: row.countryId,
          isNpc: true,
        })
      )
        incompatible.add(row.nppId.toHexString());
    for (const row of cabinet) if (row.nppId) incompatible.add(row.nppId.toHexString());
  }
  return profiles.map((row): RussianRegionalNpcProfile => {
    const office =
      typeof row.currentOffice === "string" ? row.currentOffice : row.currentOffice?.type;
    return {
      ownerId: row._id.toHexString(),
      name: row.name,
      party: row.party,
      eligible:
        !incompatible.has(row._id.toHexString()) &&
        russianRegionalCouncilOfficeCompatible({
          officeType: office,
          countryId: "RU",
          isNpc: true,
        }),
    };
  });
}

export async function materializeRussianRegionalAuthorities(input: {
  db: Db;
  session: ClientSession;
  turn: number;
  now: Date;
}) {
  const { db, session, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Regional Council authority needs a transaction, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default") return { kind: "wait" as const, reason: "other-era" };
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      session,
      projection: { ...RUSSIAN_DUMA_AUTHORITY_PROJECTION, ruCouncilFormationMandate: 1 },
    }
  );
  if (!country) return { kind: "wait" as const, reason: "no-country" };
  const mandate = await loadEnactedRussianCouncilFormation({ db, session, country, game, turn });
  if (!mandate) return { kind: "wait" as const, reason: "no-enacted-law" };
  const current = await loadCurrentRussianDumaClock({ db, session, country, turn });
  if (!current) return { kind: "wait" as const, reason: "no-seated-duma" };
  const profiles = await loadRussianRegionalNpcProfiles(db, session);
  const eligible = new Set(profiles.filter((row) => row.eligible).map((row) => row.ownerId));
  const collection = db.collection<RussianRegionalAuthorityRecord>(
    RUSSIAN_REGIONAL_AUTHORITIES_COLLECTION
  );
  const previous = await collection
    .find({ countryId: "RU", preset: "1991-default" }, { session, batchSize: 1000 })
    .toArray();
  const authorities = previous.map((row) => ({
    ...row,
    head: {
      ...row.head,
      eligible: row.head.eligible && (!row.head.isNpc || eligible.has(row.head.ownerId)),
    },
    ...(row.delegate
      ? {
          delegate: {
            ...row.delegate,
            eligible:
              row.delegate.eligible && (!row.delegate.isNpc || eligible.has(row.delegate.ownerId)),
          },
        }
      : {}),
  }));
  const needsSupport =
    !previous.length ||
    authorities.some(
      (row) =>
        row.head.isNpc &&
        (!row.head.eligible || (row.termEndTurn != null && row.termEndTurn <= turn))
    );
  let receipt: RussianDumaResultRecord | undefined;
  let root: ObjectId | undefined;
  let votesByRegion: Record<string, Record<string, number>> = {};
  if (needsSupport) {
    root = new ObjectId(current.rootId);
    receipt = (
      await db
        .collection<RussianDumaResultRecord>("russianDumaElectionResults")
        .find(
          {
            countryId: "RU",
            preset: "1991-default",
            $or: [{ cohortId: root }, { rootCohortId: root }],
          },
          {
            session,
            projection: {
              cohortId: 1,
              rootCohortId: 1,
              generation: 1,
              mandateSinceTurn: 1,
              resolvedOnTurn: 1,
              seatedOnTurn: 1,
              ballots: 1,
            },
          }
        )
        .sort({ generation: -1 })
        .limit(1)
        .toArray()
    )[0];
    if (!receipt?.ballots)
      return { kind: "wait" as const, reason: "no-certified-regional-support" };
    if (
      receipt._id !== receipt.cohortId.toHexString() ||
      !(receipt.rootCohortId ?? receipt.cohortId).equals(root) ||
      receipt.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
      !Number.isSafeInteger(receipt.resolvedOnTurn) ||
      receipt.resolvedOnTurn > turn ||
      !Number.isSafeInteger(receipt.seatedOnTurn) ||
      receipt.seatedOnTurn! > turn
    )
      throw new Error("Regional support needs the actual seated Duma certificate");
    votesByRegion = russianRegionalSupportFromDuma(receipt.ballots);
  } else {
    planRussianCouncilComposition({ mode: "regionalHeads", turn, authorities });
  }
  const decision = !needsSupport
    ? {
        kind: "renew" as const,
        changes: [] as RussianCouncilRegionalAuthority[],
        reason: "highest-regional-support-with-eligible-nominee" as const,
      }
    : previous.length
      ? planRussianRegionalCouncilRenewals({
          turn,
          termYears: 4,
          authorities,
          profiles,
          votesByRegion,
        })
      : planRussianRegionalCouncilAppointments({
          turn,
          revision: 1,
          termYears: 4,
          profiles,
          votesByRegion,
        });
  if (decision.kind === "wait") return decision;
  const chosen =
    decision.kind === "appoint"
      ? decision.authorities
      : authorities.map(
          (row) =>
            decision.changes.find(
              (next) => next.subjectId === row.subjectId && next.branch === row.branch
            ) ?? row
        );
  const delegated =
    mandate.mode === "regionalDelegates"
      ? planRussianRegionalCouncilDelegates({ turn, authorities: chosen, profiles })
      : chosen;
  const oldById = new Map(previous.map((row) => [row._id, row]));
  const changes = delegated.filter((row) => {
    const old = oldById.get(`${row.subjectId}:${row.branch}`);
    return (
      !old ||
      old.revision !== row.revision ||
      old.head.eligible !== row.head.eligible ||
      old.delegate?.personId !== row.delegate?.personId ||
      old.delegate?.eligible !== row.delegate?.eligible
    );
  });
  if (!changes.length)
    return {
      kind: "unchanged" as const,
      changed: 0,
      seatingInputs: { authorities: previous, profiles },
    };
  const records = changes.map((row): RussianRegionalAuthorityRecord => {
    const id = `${row.subjectId}:${row.branch}`,
      old = oldById.get(id);
    return {
      ...row,
      _id: id,
      countryId: "RU",
      preset: "1991-default",
      formationProposalId: mandate.proposalId,
      formationRevision: mandate.revision,
      sourceDumaResultId: receipt?._id ?? old!.sourceDumaResultId,
      sourceDumaRoot: root ?? old!.sourceDumaRoot,
      decisionReason: decision.reason,
      supportModel: "certified-duma-constituency-proxy",
      regionalTermModel: "bounded-four-year-default",
      regionalPartyVotes: { ...(receipt ? votesByRegion[row.regionId] : old!.regionalPartyVotes) },
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
  });
  if (!previous.length) await collection.insertMany(records, { session });
  else {
    const written = await collection.bulkWrite(
      records.map((row) => ({
        replaceOne: {
          filter: { _id: row._id, revision: oldById.get(row._id)!.revision },
          replacement: row,
        },
      })),
      { session }
    );
    if (written.matchedCount !== records.length)
      throw new Error("Regional authority changed before settlement");
  }
  const final = new Map(previous.map((row) => [row._id, row]));
  for (const row of records) final.set(row._id, row);
  return {
    kind: "settled" as const,
    changed: records.length,
    seatingInputs: { authorities: [...final.values()], profiles },
  };
}
