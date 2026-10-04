/** Batched government responsibility and continuous party-tenure observation. */
import type { Db, ObjectId } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import type { ElectedOfficial, StateApprovalHistory, State } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { GovernmentAccountability } from "@/lib/db/types/governmentAccountability";
import {
  responsibilityShares,
  accountabilityDrain,
  continuingPartySinceTurn,
} from "./rules/accountability";

export async function observeGovernmentAccountability(db: Db): Promise<Map<string, number>> {
  const [game, officials, formations, approvals, regionalApprovals, previous, states, runtimes] =
    await Promise.all([
      db
        .collection<{ _id: string; currentTurn?: number; preset?: string }>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1, preset: 1 } }),
      db
        .collection<ElectedOfficial>("electedOfficials")
        .find(
          {},
          {
            projection: {
              countryId: 1,
              officeType: 1,
              state: 1,
              party: 1,
              characterId: 1,
              nppId: 1,
              seatsHeld: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<GovernmentFormation>("governmentFormations")
        .find(
          { status: "formed" },
          {
            projection: {
              countryId: 1,
              pmCharacterId: 1,
              pmNppId: 1,
              governingPartyId: 1,
              formationType: 1,
              coalitionPartyIds: 1,
              coalitionId: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<{ _id: CountryId; approvalRating: number }>("governmentApprovals")
        .find({}, { projection: { approvalRating: 1 } })
        .toArray(),
      db
        .collection<StateApprovalHistory>("stateApprovalHistory")
        .find({}, { projection: { countryId: 1, stateId: 1, approvalRating: 1 } })
        .toArray(),
      db.collection<GovernmentAccountability>("governmentAccountability").find({}).toArray(),
      db
        .collection<State>("states")
        .find({}, { projection: { countryId: 1, stateSenateSeats: 1 } })
        .toArray(),
      db
        .collection<{ _id: CountryId; governmentType: string }>("countryState")
        .find({}, { projection: { governmentType: 1 } })
        .toArray(),
    ]);
  const turn = game?.currentTurn ?? 0;
  const charIds = [
    ...formations.flatMap((g) => (g.pmCharacterId ? [g.pmCharacterId] : [])),
    ...officials.flatMap((o) =>
      o.officeType === "president" && o.characterId ? [o.characterId] : []
    ),
  ];
  const nppIds = [
    ...formations.flatMap((g) => (g.pmNppId ? [g.pmNppId] : [])),
    ...officials.flatMap((o) => (o.officeType === "president" && o.nppId ? [o.nppId] : [])),
  ];
  type Actor = { _id: ObjectId; party?: string };
  const [characters, npps, coalitions] = await Promise.all([
    db
      .collection<Actor>("characters")
      .find({ _id: { $in: charIds } }, { projection: { party: 1 } })
      .toArray(),
    db
      .collection<Actor>("npps")
      .find({ _id: { $in: nppIds } }, { projection: { party: 1 } })
      .toArray(),
    db
      .collection<{
        sequentialId: number;
        countryId: CountryId;
        members: { partySequentialId: number }[];
      }>("coalitions")
      .find(
        {
          sequentialId: {
            $in: formations.flatMap((g) => (g.coalitionId != null ? [g.coalitionId] : [])),
          },
        },
        { projection: { sequentialId: 1, countryId: 1, members: 1 } }
      )
      .toArray(),
  ]);
  const characterParty = new Map(characters.map((c) => [String(c._id), c.party]));
  const nppParty = new Map(npps.map((c) => [String(c._id), c.party]));
  const approvalByCountry = new Map(approvals.map((a) => [a._id, a.approvalRating]));
  const prior = new Map(previous.map((p) => [p._id, p]));
  const types = new Map(runtimes.map((r) => [r._id, r.governmentType]));
  const responsibilityKey = (party: string | undefined, identity: string | undefined) =>
    party === "independent" || !party ? (identity ? `@${identity}` : null) : party;
  const drains = new Map<string, number>();
  const observations: GovernmentAccountability[] = [];
  const attributionRepairs: {
    countryId: CountryId;
    fields: { governingPartyId?: string; formationType?: null };
  }[] = [];
  const observe = (
    countryId: CountryId,
    stateId: string | null,
    shares: Record<string, number>,
    approval: number
  ) => {
    for (const [partyId, responsibility] of Object.entries(shares)) {
      if (responsibility <= 0) continue;
      const id = `${countryId}:${stateId ?? "national"}:${partyId}`;
      const sinceTurn = continuingPartySinceTurn(prior.get(id), turn);
      observations.push({
        _id: id,
        countryId,
        stateId,
        partyId,
        sinceTurn,
        lastObservedTurn: turn,
        responsibility,
        approval,
      });
      drains.set(id, accountabilityDrain(approval, responsibility, turn - sinceTurn));
    }
  };
  const countries = new Set([
    ...officials.flatMap((o) => (o.countryId ? [o.countryId] : [])),
    ...formations.map((g) => g.countryId),
  ]);
  for (const countryId of countries) {
    const config = getCountryConfig(countryId, game?.preset);
    const formation = formations.find((g) => g.countryId === countryId);
    const president = officials.find(
      (o) => o.countryId === countryId && o.officeType === "president" && (o.characterId || o.nppId)
    );
    const parliamentary =
      (types.get(countryId) ?? config.governmentType) !== "presidential" ||
      config.electionSystems.headOfGovernment === "parliamentary";
    const executiveParty = parliamentary
      ? formation?.pmCharacterId
        ? characterParty.get(String(formation.pmCharacterId))
        : nppParty.get(String(formation?.pmNppId))
      : ((president?.characterId
          ? characterParty.get(String(president.characterId))
          : nppParty.get(String(president?.nppId))) ?? president?.party);
    if (formation) {
      const fields: { governingPartyId?: string; formationType?: null } = {};
      if (executiveParty && formation.governingPartyId !== executiveParty)
        fields.governingPartyId = executiveParty;
      if (!parliamentary && formation.formationType != null) fields.formationType = null;
      if (Object.keys(fields).length) attributionRepairs.push({ countryId, fields });
    }
    const executiveIdentity = parliamentary
      ? formation?.pmCharacterId
        ? `character:${formation.pmCharacterId}`
        : formation?.pmNppId
          ? `npp:${formation.pmNppId}`
          : undefined
      : president?.characterId
        ? `character:${president.characterId}`
        : president?.nppId
          ? `npp:${president.nppId}`
          : undefined;
    const lower = officials.filter(
      (o) =>
        o.countryId === countryId &&
        o.officeType === getLowerChamberOfficeType(countryId, game?.preset) &&
        (o.characterId || o.nppId)
    );
    const seats: Record<string, number> = {};
    for (const o of lower)
      if (o.party && o.party !== "independent")
        seats[o.party] = (seats[o.party] ?? 0) + (o.seatsHeld ?? 1);
    const legislativeChambers = [
      { seatsByParty: seats, chamberSize: config.legislature.lowerChamber.seats },
    ];
    const upperOffice = getUpperChamberOfficeType(countryId, game?.preset);
    if (upperOffice && config.legislature.upperChamber) {
      const upperSeats: Record<string, number> = {};
      for (const official of officials) {
        if (
          official.countryId === countryId &&
          official.officeType === upperOffice &&
          (official.characterId || official.nppId) &&
          official.party &&
          official.party !== "independent"
        )
          upperSeats[official.party] =
            (upperSeats[official.party] ?? 0) + (official.seatsHeld ?? 1);
      }
      legislativeChambers.push({
        seatsByParty: upperSeats,
        chamberSize: config.legislature.upperChamber.seats,
      });
    }
    const coalition = coalitions.find(
      (c) => c.countryId === countryId && c.sequentialId === formation?.coalitionId
    );
    observe(
      countryId,
      null,
      responsibilityShares({
        executiveParty: responsibilityKey(executiveParty, executiveIdentity),
        coalitionParties: parliamentary
          ? (formation?.coalitionPartyIds ??
            coalition?.members.map((m) => String(m.partySequentialId)))
          : [],
        seatsByParty: seats,
        chamberSize: config.legislature.lowerChamber.seats,
        legislativeChambers,
      }),
      approvalByCountry.get(countryId) ?? 50
    );
  }
  for (const a of regionalApprovals) {
    const stateId = a.stateId ?? a._id;
    const regional = officials.filter(
      (o) => o.countryId === a.countryId && o.state === stateId && (o.characterId || o.nppId)
    );
    const executive = regional.find((o) =>
      ["governor", "ministerPresident", "firstSecretary"].includes(o.officeType)
    );
    const seats: Record<string, number> = {};
    for (const o of regional)
      if (
        o.party &&
        o.party !== "independent" &&
        ["stateSenate", "regionalCouncil", "landtag", "peoplesCongress", "stateAssembly"].includes(
          o.officeType
        )
      )
        seats[o.party] = (seats[o.party] ?? 0) + (o.seatsHeld ?? 1);
    observe(
      a.countryId,
      stateId,
      responsibilityShares({
        executiveParty: responsibilityKey(
          executive?.party,
          executive?.characterId
            ? `character:${executive.characterId}`
            : executive?.nppId
              ? `npp:${executive.nppId}`
              : undefined
        ),
        seatsByParty: seats,
        chamberSize:
          states.find((state) => state.countryId === a.countryId && state._id === stateId)
            ?.stateSenateSeats || Object.values(seats).reduce((sum, value) => sum + value, 0),
      }),
      a.approvalRating
    );
  }
  if (observations.length)
    await db.collection<GovernmentAccountability>("governmentAccountability").bulkWrite(
      observations.map((doc) => ({
        updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
      }))
    );
  if (attributionRepairs.length)
    await db.collection<GovernmentFormation>("governmentFormations").bulkWrite(
      attributionRepairs.map(({ countryId, fields }) => ({
        updateOne: {
          filter: { _id: countryId, status: "formed" },
          update: { $set: fields },
        },
      }))
    );
  return drains;
}

/** National and regional consequences overlap; apply only the greater cost. */
export function memberAccountabilityDrain(
  drains: Map<string, number>,
  countryId: string,
  stateId: string | undefined,
  partyId: string | null | undefined,
  actorIdentity?: string
): number {
  const key =
    partyId === "independent" || !partyId ? (actorIdentity ? `@${actorIdentity}` : null) : partyId;
  if (!key) return 0;
  return Math.max(
    drains.get(`${countryId}:national:${key}`) ?? 0,
    stateId ? (drains.get(`${countryId}:${stateId}:${key}`) ?? 0) : 0
  );
}
