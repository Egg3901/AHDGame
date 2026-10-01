/**
 * Russia seats only a certified president and vice-president ticket.
 * materializeRussianPresidentialSeating archives replaced offices and vacates
 * the winners' incompatible seats, preserving the remaining Congress and government.
 */
import { type Db, type ClientSession, type ObjectId } from "mongodb";
import type {
  Character,
  NPP,
  CountryGameState,
  ElectedOfficial,
  ElectionCandidate,
} from "@/lib/db/types";
import { PM_VACANCY_DEADLINE_TURNS } from "@/lib/constants/turnTime";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import {
  RUSSIAN_PRESIDENTIAL_RESULTS_COLLECTION,
  type RussianPresidentialResultRecord,
} from "./presidentialElectionResult";
export const RUSSIAN_PRESIDENTIAL_ARCHIVES_COLLECTION = "russianPresidentialOfficeArchives";
interface Archive {
  _id: string;
  preset: "1991-default";
  electionId: ObjectId;
  turn: number;
  official?: ElectedOfficial;
  cabinetMember?: UnifiedCabinetMember;
}
export async function materializeRussianPresidentialSeating(input: {
  db: Db;
  session: ClientSession;
  turn: number;
  now: Date;
  officialIds: [ObjectId, ObjectId];
}): Promise<boolean> {
  const { db, session, turn, now, officialIds } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Russian seating needs an active transaction, turn and time");
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruPresidencyMandateSinceTurn: 1,
        ruPresidencySinceTurn: 1,
        ruPresidencyCertifiedElectionId: 1,
        ruPresidencyElectionCertifiedSinceTurn: 1,
      },
    }
  );
  if (!country?.ruPresidencyCertifiedElectionId) return false;
  const results = db.collection<RussianPresidentialResultRecord>(
    RUSSIAN_PRESIDENTIAL_RESULTS_COLLECTION
  );
  const result = await results.findOne(
    {
      _id: country.ruPresidencyCertifiedElectionId.toHexString(),
      countryId: "RU",
      preset: "1991-default",
    },
    { session }
  );
  if (!result || result.seatedOnTurn != null) return false;
  if (
    result.decision.outcome !== "won" ||
    !result.winner ||
    !result.vicePresident ||
    result.mandateSinceTurn !== country.ruPresidencyMandateSinceTurn ||
    result.resolvedOnTurn > turn ||
    country.ruPresidencyElectionCertifiedSinceTurn !== result.resolvedOnTurn
  )
    throw new Error("Russian presidency requires its current certified ticket");
  if (!country.ruSovietSuccessionSinceTurn || country.ruSovietSuccessionSinceTurn > turn)
    throw new Error("Russian presidency requires completed Soviet succession");
  if (officialIds[0].equals(officialIds[1]))
    throw new Error("Russian executive offices need distinct ids");
  const ticket = [
    { ...result.winner, officeType: "president" as const },
    { ...result.vicePresident, officeType: "vicePresident" as const },
  ];
  const charIds = ticket.flatMap((p) => (p.characterId ? [p.characterId] : []));
  const nppIds = ticket.flatMap((p) => (p.nppId ? [p.nppId] : []));
  if (
    charIds.length + nppIds.length !== 2 ||
    new Set(charIds.map((id) => id.toHexString())).size !== charIds.length ||
    new Set(nppIds.map((id) => id.toHexString())).size !== nppIds.length
  )
    throw new Error("Russian certified ticket identities overlap");
  const chars = charIds.length
    ? await db
        .collection<Character>("characters")
        .find(
          {
            _id: { $in: charIds },
            countryId: "RU",
            federationPendingResidenceId: { $exists: false },
          },
          { session, projection: { _id: 1 } }
        )
        .toArray()
    : [];
  const npps = nppIds.length
    ? await db
        .collection<NPP>("npps")
        .find(
          {
            _id: { $in: nppIds },
            countryId: "RU",
            $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }],
            isTechnocrat: { $ne: true },
          },
          { session, projection: { _id: 1 } }
        )
        .toArray()
    : [];
  if (chars.length !== charIds.length || npps.length !== nppIds.length)
    throw new Error("Russian certified ticket is no longer resident");
  const identities = [
    ...(charIds.length ? [{ characterId: { $in: charIds } }] : []),
    ...(nppIds.length ? [{ nppId: { $in: nppIds } }] : []),
  ];
  const cabinet = db.collection<UnifiedCabinetMember>("cabinetMembers");
  const winningMinisters = await cabinet
    .find({ countryId: "RU", $or: identities }, { session })
    .toArray();
  if (winningMinisters.length) {
    await db.collection<Archive>(RUSSIAN_PRESIDENTIAL_ARCHIVES_COLLECTION).bulkWrite(
      winningMinisters.map((cabinetMember) => ({
        updateOne: {
          filter: { _id: `${result._id}:cabinet:${cabinetMember._id.toHexString()}` },
          update: {
            $setOnInsert: {
              _id: `${result._id}:cabinet:${cabinetMember._id.toHexString()}`,
              preset: "1991-default" as const,
              electionId: result.electionId,
              turn,
              cabinetMember,
            },
          },
          upsert: true,
        },
      })),
      { session }
    );
    await cabinet.deleteMany({ _id: { $in: winningMinisters.map((row) => row._id) } }, { session });
  }
  const officials = db.collection<ElectedOfficial>("electedOfficials");
  const retiredTypes = ["chairmanOfSupremeSoviet", "president", "vicePresident"];
  const old = await officials
    .find(
      { countryId: "RU", $or: [{ officeType: { $in: retiredTypes } }, ...identities] },
      { session }
    )
    .toArray();
  if (old.length) {
    await db.collection<Archive>(RUSSIAN_PRESIDENTIAL_ARCHIVES_COLLECTION).bulkWrite(
      old.map((official) => ({
        updateOne: {
          filter: { _id: `${result._id}:${official._id.toHexString()}` },
          update: {
            $setOnInsert: {
              _id: `${result._id}:${official._id.toHexString()}`,
              preset: "1991-default" as const,
              electionId: result.electionId,
              turn,
              official,
            },
          },
          upsert: true,
        },
      })),
      { session }
    );
    const replaceIds = old.filter((o) => retiredTypes.includes(o.officeType)).map((o) => o._id);
    const vacancyIds = old.filter((o) => !retiredTypes.includes(o.officeType)).map((o) => o._id);
    if (replaceIds.length) await officials.deleteMany({ _id: { $in: replaceIds } }, { session });
    if (vacancyIds.length)
      await officials.updateMany(
        { _id: { $in: vacancyIds } },
        {
          $set: {
            characterId: null,
            nppId: null,

            isNPP: false,
            updatedAt: now,
          },
          $unset: { seatsHeld: "", characterName: "", party: "" },
        },
        { session }
      );
  }
  await db
    .collection<Character>("characters")
    .updateMany(
      { countryId: "RU", "currentOffice.type": { $in: retiredTypes }, _id: { $nin: charIds } },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId: "RU", "currentOffice.type": { $in: retiredTypes }, _id: { $nin: nppIds } },
      { $set: { currentOffice: null, updatedAt: now } },
      { session }
    );
  const rows: ElectedOfficial[] = ticket.map((person, i) => ({
    _id: officialIds[i],
    countryId: "RU",
    officeType: person.officeType,
    characterId: person.characterId ?? null,
    nppId: person.nppId ?? null,
    isNPP: !!person.nppId,
    characterName: person.name,
    party: person.party,
    electedAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  await officials.insertMany(rows, { session });
  for (const isNpp of [false, true]) {
    const people = ticket.filter((p) => !!p.nppId === isNpp);
    if (!people.length) continue;
    const writes = people.map((person) => ({
      updateOne: {
        filter: { _id: (isNpp ? person.nppId : person.characterId)!, countryId: "RU" as const },
        update: {
          $set: { currentOffice: { type: person.officeType }, updatedAt: now },
          ...(!isNpp
            ? {
                $push: {
                  careerHistory: {
                    type: "elected" as const,
                    office: { type: person.officeType },
                    officeLabel:
                      person.officeType === "president"
                        ? "President of Russia"
                        : "Vice-President of Russia",
                    party: person.party,
                    partyCountryId: "RU" as const,
                    electionId: result.electionId.toHexString(),
                    date: now,
                  },
                },
              }
            : {}),
        },
      },
    }));
    const updated = isNpp
      ? await db.collection<NPP>("npps").bulkWrite(writes, { session })
      : await db.collection<Character>("characters").bulkWrite(writes, { session });
    if (updated.matchedCount !== people.length)
      throw new Error("Russian certified office holder changed");
  }
  await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { countryId: "RU", status: "active", $or: identities },
      { $set: { status: "withdrawn", withdrawnAt: now } },
      { session }
    );
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "RU" },
    {
      $set: {
        hosCharacterId: result.winner.characterId ?? null,
        hosNppId: result.winner.nppId ?? null,
        hosName: result.winner.name,
        updatedAt: now,
      },
    },
    { session }
  );
  // A PM elected to the national ticket vacates that job; other PMs retain it.
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "RU", $or: [{ pmCharacterId: { $in: charIds } }, { pmNppId: { $in: nppIds } }] },
    {
      $set: {
        status: "pending",
        pmCharacterId: null,
        pmNppId: null,
        pmName: null,
        activeVoteId: null,
        pmVacancyDeadlineTurn: turn + PM_VACANCY_DEADLINE_TURNS,
        updatedAt: now,
      },
    },
    { session }
  );
  await db
    .collection("pmAppointmentVotes")
    .updateMany(
      { countryId: "RU", office: "headOfState", status: "active" },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } },
      { session }
    );
  const activated = await countries.updateOne(
    {
      _id: "RU",
      ruPresidencyCertifiedElectionId: result.electionId,
      ruPresidencyMandateSinceTurn: result.mandateSinceTurn,
    },
    { $set: { ruPresidencySinceTurn: country.ruPresidencySinceTurn ?? turn, updatedAt: now } },
    { session }
  );
  if (activated.matchedCount !== 1)
    throw new Error("Russian certified mandate changed before seating");
  const seated = await results.updateOne(
    { _id: result._id, seatedOnTurn: { $exists: false } },
    { $set: { seatedOnTurn: turn } },
    { session }
  );
  if (seated.matchedCount !== 1) throw new Error("Russian certified ticket was already seated");
  return true;
}
