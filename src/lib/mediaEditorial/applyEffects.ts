/**
 * Editorial audience effect. Filled local ad share nudges active candidates
 * whose party platform aligns with the publisher, with one receipt per turn.
 */
import type { Db, ObjectId } from "mongodb";
import { editorialAudienceFavorabilityNudge, type EditorialPosition } from "./rules";

interface ActiveElection {
  _id: ObjectId;
  countryId: string;
  state: string;
  status: string;
}

interface ActiveCandidate {
  _id: ObjectId;
  electionId: ObjectId;
  characterId: ObjectId;
  nppId?: ObjectId;
  isNPP?: boolean;
  party: string;
  countryId?: string;
  status: string;
}

interface EditorialParty {
  _id: ObjectId;
  countryId: string;
  sequentialId: number;
  name: string;
  abbreviation: string;
  economicPosition: number;
  socialPosition: number;
}

interface EditorialPerson {
  _id: ObjectId;
  favorability: number;
  mediaEditorialLastAppliedTurn?: number;
}

interface EffectTarget {
  id: ObjectId;
  amount: number;
}

export async function applyMediaEditorialEffects(args: {
  db: Db;
  turn: number;
  outletsByState: ReadonlyMap<
    string,
    readonly { corporationId: string; stance: EditorialPosition; audienceShare: number }[]
  >;
}): Promise<void> {
  const { db, turn, outletsByState } = args;
  if (!Number.isInteger(turn) || outletsByState.size === 0) return;

  const elections = await db
    .collection<ActiveElection>("elections")
    .find({ status: "active" }, { projection: { _id: 1, countryId: 1, state: 1 } })
    .toArray();
  const relevantElections = elections.filter((election) => outletsByState.has(election.state));
  if (relevantElections.length === 0) return;

  const electionById = new Map(
    relevantElections.map((election) => [String(election._id), election])
  );
  const candidates = await db
    .collection<ActiveCandidate>("electionCandidates")
    .find(
      { electionId: { $in: relevantElections.map((election) => election._id) }, status: "active" },
      {
        projection: {
          _id: 1,
          electionId: 1,
          characterId: 1,
          nppId: 1,
          isNPP: 1,
          party: 1,
          countryId: 1,
          status: 1,
        },
      }
    )
    .toArray();
  if (candidates.length === 0) return;

  const countryIds = [...new Set(relevantElections.map((election) => election.countryId))];
  const parties = await db
    .collection<EditorialParty>("politicalParties")
    .find(
      { countryId: { $in: countryIds } },
      {
        projection: {
          _id: 1,
          countryId: 1,
          sequentialId: 1,
          name: 1,
          abbreviation: 1,
          economicPosition: 1,
          socialPosition: 1,
        },
      }
    )
    .toArray();
  const partyByKey = new Map<string, EditorialParty>();
  for (const party of parties) {
    for (const name of [String(party.sequentialId), party.name, party.abbreviation]) {
      partyByKey.set(`${party.countryId}:${name}`, party);
    }
  }

  const characterAmounts = new Map<string, EffectTarget>();
  const nppAmounts = new Map<string, EffectTarget>();
  for (const candidate of candidates) {
    const election = electionById.get(String(candidate.electionId));
    if (!election) continue;
    const party = partyByKey.get(`${candidate.countryId ?? election.countryId}:${candidate.party}`);
    if (!party) continue;
    const outlets = outletsByState.get(election.state);
    if (!outlets) continue;
    const amount = editorialAudienceFavorabilityNudge(outlets, {
      economic: party.economicPosition,
      social: party.socialPosition,
    });
    if (!(amount > 0)) continue;

    if (candidate.isNPP && candidate.nppId) {
      const id = String(candidate.nppId);
      const existing = nppAmounts.get(id);
      nppAmounts.set(id, {
        id: candidate.nppId,
        amount: Math.min(0.5, (existing?.amount ?? 0) + amount),
      });
    } else {
      const id = String(candidate.characterId);
      const existing = characterAmounts.get(id);
      characterAmounts.set(id, {
        id: candidate.characterId,
        amount: Math.min(0.5, (existing?.amount ?? 0) + amount),
      });
    }
  }

  await Promise.all([
    applyToPeople(db, "characters", characterAmounts, turn),
    applyToPeople(db, "npps", nppAmounts, turn),
  ]);
}

async function applyToPeople(
  db: Db,
  collectionName: "characters" | "npps",
  targets: ReadonlyMap<string, EffectTarget>,
  turn: number
): Promise<void> {
  if (targets.size === 0) return;
  const collection = db.collection<EditorialPerson>(collectionName);
  const people = await collection
    .find(
      { _id: { $in: [...targets.values()].map((target) => target.id) } },
      { projection: { _id: 1, favorability: 1, mediaEditorialLastAppliedTurn: 1 } }
    )
    .toArray();
  const peopleById = new Map(people.map((person) => [String(person._id), person]));
  const operations = [...targets].flatMap(([key, target]) => {
    const person = peopleById.get(key);
    if (
      !person ||
      (person.mediaEditorialLastAppliedTurn != null && person.mediaEditorialLastAppliedTurn >= turn)
    ) {
      return [];
    }
    const amount = Math.max(0, Math.min(target.amount, 100 - (person.favorability ?? 50)));
    return [
      {
        updateOne: {
          filter: {
            _id: target.id,
            $or: [
              { mediaEditorialLastAppliedTurn: { $lt: turn } },
              { mediaEditorialLastAppliedTurn: { $exists: false } },
            ],
          },
          update: {
            ...(amount > 0 ? { $inc: { favorability: amount } } : {}),
            $set: { mediaEditorialLastAppliedTurn: turn },
          },
        },
      },
    ];
  });
  if (operations.length > 0) await collection.bulkWrite(operations);
}
