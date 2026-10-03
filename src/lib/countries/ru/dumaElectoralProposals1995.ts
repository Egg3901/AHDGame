/**
 * Russia's 1995 Duma law opens a normal bicameral bill after its date.
 * openRussianDuma1995Proposal binds one revision; enactment changes only future
 * campaigns, whose frozen authority is checked by loadEnactedRussianDumaLaw.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Bill, Character, CountryGameState, GameState } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  RussianConstitutionalDecisionConflict,
  type RussianConstitutionalCalendar,
} from "./constitutionalProposals";
import {
  russianDuma1995DecisionAvailability,
  passesRussianDumaLawChamber,
} from "./rules/dumaElectoralLaw";

export const RUSSIAN_DUMA_LAW_PROPOSALS_COLLECTION = "russianDumaLawProposals";
const ID = "1991-default:ru-duma:law1995";
export interface RussianDuma1995Proposal {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  kind: "law1995";
  revision: number;
  billId: ObjectId;
  openedOnTurn: number;
  status: "open" | "authorized";
  authorizedOnTurn?: number;
  createdAt: Date;
}
const projection = {
  ruFederalAssemblySinceTurn: 1,
  ruDumaElectoralMandate: 1,
  dissolvedTurn: 1,
} as const;
function availability(
  game: RussianConstitutionalCalendar,
  turn: number,
  country: Pick<
    CountryGameState,
    "ruFederalAssemblySinceTurn" | "ruDumaElectoralMandate" | "dissolvedTurn"
  > | null
) {
  return russianDuma1995DecisionAvailability({
    preset: game.preset,
    turn,
    calendarTurn: calendarTurn(turn, {
      preIterationActive: game.preIteration?.active,
      preIterationTurns: game.preIterationTurns,
    }),
    assemblySinceTurn: country?.ruFederalAssemblySinceTurn,
    enacted: country?.ruDumaElectoralMandate != null,
    dissolved: country?.dissolvedTurn != null,
  });
}
async function canonicalGame(db: Db, session?: ClientSession) {
  return db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
}
function validClock(turn: number, now: Date) {
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Duma law needs a valid turn and time");
}
export async function materializeRussianDuma1995Proposal(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
  sponsor: Pick<Character, "_id" | "name"> | null;
  sponsorParty?: string;
  newBillId?: ObjectId;
}): Promise<RussianDuma1995Proposal> {
  const { db, session, turn, now } = input;
  validClock(turn, now);
  if (!session.inTransaction()) throw new Error("Duma law needs a required transaction");
  const game = await canonicalGame(db, session);
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "RU" }, { session, projection });
  if (!game || input.game.preset !== game.preset)
    throw new RussianConstitutionalDecisionConflict("other-era");
  const allowed = availability(game, turn, country);
  if (!allowed.available) throw new RussianConstitutionalDecisionConflict(allowed.reason);
  if (
    input.sponsor &&
    !(await db.collection("electedOfficials").findOne(
      {
        countryId: "RU",
        characterId: input.sponsor._id,
        officeType: { $in: ["dumaDeputy", "federationCouncilMember"] },
        seatsHeld: { $ne: 0 },
      },
      { session, projection: { _id: 1 } }
    ))
  )
    throw new RussianConstitutionalDecisionConflict(
      "A seated Russian legislator must introduce this law"
    );
  const proposals = db.collection<RussianDuma1995Proposal>(RUSSIAN_DUMA_LAW_PROPOSALS_COLLECTION);
  const prior = await proposals.findOne({ _id: ID }, { session });
  if (prior) {
    const bill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: prior.billId },
        { session, projection: { countryId: 1, status: 1, russianDumaElectoralMandate: 1 } }
      );
    if (
      !Number.isSafeInteger(prior.revision) ||
      prior.revision < 1 ||
      !bill ||
      bill.countryId !== "RU" ||
      bill.russianDumaElectoralMandate?.proposalId !== ID ||
      bill.russianDumaElectoralMandate.revision !== prior.revision ||
      bill.russianDumaElectoralMandate.kind !== "law1995"
    )
      throw new RussianConstitutionalDecisionConflict("Duma law no longer matches its proposal");
    if (!["failed", "vetoed", "override_failed"].includes(bill.status)) return prior;
  }
  const revision = (prior?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new Error("Duma law revision exceeds precision");
  const proposal: RussianDuma1995Proposal = {
    _id: ID,
    countryId: "RU",
    preset: "1991-default",
    kind: "law1995",
    revision,
    billId: input.newBillId ?? new ObjectId(),
    openedOnTurn: turn,
    status: "open",
    createdAt: now,
  };
  const bill: Bill = {
    _id: proposal.billId,
    countryId: "RU",
    stateId: "ru_national",
    title: "Duma 1995 Electoral Law Decision",
    summary:
      "Authorize the 1995 parallel 225 constituency and 225 national list system. The five-percent list gate includes invalid ballots. District participation uses recorded ballot receipts. Both chambers must approve by a majority of their full capacity, followed by presidential enactment. Existing campaigns and repeats retain their frozen law.",
    originChamber: "stateDuma",
    currentChamber: "stateDuma",
    sponsorId: input.sponsor?._id ?? null,
    sponsorName: input.sponsor?.name ?? "Russian Government",
    ...(input.sponsorParty ? { sponsorParty: input.sponsorParty } : {}),
    status: "proposed",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "government",
    provisions: [],
    russianDumaElectoralMandate: { proposalId: ID, revision, kind: "law1995" },
    proposedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const claim = await proposals.updateOne(
    { _id: ID, ...(prior ? { revision: prior.revision } : {}) },
    { $set: proposal },
    { session, upsert: !prior }
  );
  if (prior && claim.matchedCount !== 1) throw new Error("Duma proposal changed");
  await db.collection<Bill>("bills").insertOne(bill, { session });
  return proposal;
}
export async function openRussianDuma1995Proposal(
  input: Omit<Parameters<typeof materializeRussianDuma1995Proposal>[0], "session">
) {
  const newBillId = input.newBillId ?? new ObjectId();
  return runRequiredTransaction(
    (session) => materializeRussianDuma1995Proposal({ ...input, newBillId, session }),
    { client: input.db.client }
  );
}
function validBinding(bill: Bill, proposal: RussianDuma1995Proposal) {
  const binding = bill.russianDumaElectoralMandate;
  return (
    binding?.proposalId === ID &&
    binding.revision === proposal.revision &&
    binding.kind === "law1995" &&
    proposal._id === ID &&
    proposal.countryId === "RU" &&
    proposal.preset === "1991-default" &&
    proposal.kind === "law1995" &&
    Number.isSafeInteger(proposal.revision) &&
    proposal.revision > 0
  );
}
async function signedBill(db: Db, proposal: RussianDuma1995Proposal, session?: ClientSession) {
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: proposal.billId,
      countryId: "RU",
      stateId: "ru_national",
      status: "signed",
      enactedAt: { $type: "date" },
    },
    {
      session,
      projection: {
        russianDumaElectoralMandate: 1,
        "voteSnapshot.totals": 1,
        "otherChamberVoteSnapshot.totals": 1,
        originChamber: 1,
        currentChamber: 1,
      },
    }
  );
  if (!bill) return null;
  if (!validBinding(bill, proposal)) throw new Error("Duma law lacks its bound signed decision");
  // Each chamber retains its own frozen result. Presidential override still
  // requires at least these full-capacity ordinary majorities.
  if (
    bill.originChamber !== "stateDuma" ||
    !bill.voteSnapshot ||
    !bill.otherChamberVoteSnapshot ||
    !passesRussianDumaLawChamber(bill.voteSnapshot.totals, 450) ||
    !passesRussianDumaLawChamber(bill.otherChamberVoteSnapshot.totals, 178)
  )
    throw new Error("Duma law lacks full-capacity bicameral consent");
  return bill;
}
export async function authorizeRussianDuma1995Proposal(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
}) {
  const { db, session, turn, now } = input;
  validClock(turn, now);
  if (!session.inTransaction()) throw new Error("Duma enactment needs a required transaction");
  const proposals = db.collection<RussianDuma1995Proposal>(RUSSIAN_DUMA_LAW_PROPOSALS_COLLECTION);
  const proposal = await proposals.findOne({ _id: ID, status: "open" }, { session });
  if (!proposal || !(await signedBill(db, proposal, session))) return false;
  if (
    !Number.isSafeInteger(proposal.openedOnTurn) ||
    proposal.openedOnTurn < 1 ||
    proposal.openedOnTurn > turn
  )
    throw new Error("Duma law opening clock changed");
  const game = await canonicalGame(db, session);
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne({ _id: "RU" }, { session, projection });
  if (!game || input.game.preset !== game.preset || !availability(game, turn, country).available)
    return false;
  const claim = await countries.updateOne(
    {
      _id: "RU",
      ruFederalAssemblySinceTurn: country!.ruFederalAssemblySinceTurn,
      ruDumaElectoralMandate: { $exists: false },
      dissolvedTurn:
        country!.dissolvedTurn === undefined ? { $exists: false } : country!.dissolvedTurn,
    },
    {
      $set: {
        ruDumaElectoralMandate: {
          law: "law1995",
          proposalId: ID,
          revision: proposal.revision,
          sinceTurn: turn,
        },
        updatedAt: now,
      },
    },
    { session }
  );
  if (claim.matchedCount !== 1) throw new Error("Duma electoral authority changed");
  const recorded = await proposals.updateOne(
    { _id: ID, status: "open", revision: proposal.revision },
    { $set: { status: "authorized", authorizedOnTurn: turn } },
    { session }
  );
  if (recorded.modifiedCount !== 1) throw new Error("Duma enactment receipt changed");
  return true;
}
export async function processRussianDuma1995Mandate(
  db: Db,
  game: RussianConstitutionalCalendar,
  turn: number,
  now: Date
) {
  if (
    game.preset !== "1991-default" ||
    !availability(game, turn, { ruFederalAssemblySinceTurn: 1 }).available
  )
    return false;
  const proposal = await db
    .collection<RussianDuma1995Proposal>(RUSSIAN_DUMA_LAW_PROPOSALS_COLLECTION)
    .findOne({ _id: ID, status: "open" }, { projection: { billId: 1 } });
  if (
    !proposal ||
    !(await db
      .collection<Bill>("bills")
      .findOne({ _id: proposal.billId, status: "signed" }, { projection: { _id: 1 } }))
  )
    return false;
  return runRequiredTransaction(
    (session) => authorizeRussianDuma1995Proposal({ db, session, game, turn, now }),
    { client: db.client }
  );
}
export async function loadEnactedRussianDumaLaw(input: {
  db: Db;
  session?: ClientSession;
  country: Pick<
    CountryGameState,
    "ruFederalAssemblySinceTurn" | "ruDumaElectoralMandate" | "dissolvedTurn"
  >;
  turn: number;
}) {
  const { db, session, country, turn } = input;
  const mandate = country.ruDumaElectoralMandate;
  if (!mandate) return "decree1993" as const;
  if (
    mandate.law !== "law1995" ||
    mandate.proposalId !== ID ||
    !Number.isSafeInteger(mandate.revision) ||
    mandate.revision < 1 ||
    !Number.isSafeInteger(mandate.sinceTurn) ||
    mandate.sinceTurn < 1 ||
    mandate.sinceTurn > turn
  )
    throw new Error("Duma law requires valid recorded authority");
  const proposal = await db
    .collection<RussianDuma1995Proposal>(RUSSIAN_DUMA_LAW_PROPOSALS_COLLECTION)
    .findOne(
      {
        _id: ID,
        revision: mandate.revision,
        status: "authorized",
        authorizedOnTurn: mandate.sinceTurn,
      },
      { session }
    );
  if (!proposal || !(await signedBill(db, proposal, session)))
    throw new Error("Duma law lacks its actual enactment receipt");
  const game = await canonicalGame(db, session);
  if (
    !game ||
    !availability(game, mandate.sinceTurn, { ...country, ruDumaElectoralMandate: undefined })
      .available
  )
    throw new Error("Duma law predates its parliamentary decision");
  return "law1995" as const;
}
export async function loadRussianDuma1995Decisions(
  db: Db,
  game: RussianConstitutionalCalendar,
  turn: number
) {
  if (game.preset !== "1991-default") return [];
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "RU" }, { projection });
  const allowed = availability(game, turn, country);
  if (allowed.reason === "before-date" || allowed.reason === "no-legislature") return [];
  const proposal = await db
    .collection<RussianDuma1995Proposal>(RUSSIAN_DUMA_LAW_PROPOSALS_COLLECTION)
    .findOne({ _id: ID }, { projection: { billId: 1, revision: 1, status: 1 } });
  const bill = proposal
    ? await db
        .collection<Bill>("bills")
        .findOne({ _id: proposal.billId }, { projection: { status: 1 } })
    : null;
  return [
    {
      kind: "law1995" as const,
      ...allowed,
      threshold: "majority" as const,
      seatCapacity: 450,
      proposal: proposal
        ? {
            billId: proposal.billId.toHexString(),
            revision: proposal.revision,
            status: proposal.status,
            billStatus: bill?.status ?? null,
            canRevise:
              allowed.available &&
              !!bill &&
              ["failed", "vetoed", "override_failed"].includes(bill.status),
          }
        : null,
    },
  ];
}
