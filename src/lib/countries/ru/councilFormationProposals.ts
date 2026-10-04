/**
 * Council formation laws put regional heads and delegates to ordinary parliamentary votes.
 * materializeRussianCouncilFormationProposal binds each bill to a dated revision;
 * authorizeRussianCouncilFormation records only that revision's signed enactment.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Bill, Character, CountryGameState } from "@/lib/db/types";
import { calendarTurn } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  type RussianConstitutionalCalendar,
  RussianConstitutionalDecisionConflict,
} from "./constitutionalProposals";
import {
  russianCouncilCompositionAvailable,
  type RussianCouncilCompositionMode,
} from "./rules/councilComposition";
export const RUSSIAN_COUNCIL_FORMATION_PROPOSALS_COLLECTION = "russianCouncilFormationProposals";
export interface RussianCouncilFormationProposal {
  _id: string;
  countryId: "RU";
  preset: "1991-default";
  mode: RussianCouncilCompositionMode;
  revision: number;
  billId: ObjectId;
  openedOnTurn: number;
  status: "open" | "authorized";
  authorizedOnTurn?: number;
  createdAt: Date;
}
const projection = {
  ruFederalAssemblySinceTurn: 1,
  ruCouncilFormationMandate: 1,
  ruCouncilComposition: 1,
} as const;
function clock(game: RussianConstitutionalCalendar, turn: number) {
  return calendarTurn(turn, {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  });
}
function availability(
  game: RussianConstitutionalCalendar,
  turn: number,
  mode: RussianCouncilCompositionMode,
  country: CountryGameState | null
) {
  return russianCouncilCompositionAvailable({
    mode,
    preset: game.preset,
    currentTurn: turn,
    calendarTurn: clock(game, turn),
    assemblySinceTurn: country?.ruFederalAssemblySinceTurn,
    enactedMode: country?.ruCouncilFormationMandate?.mode ?? country?.ruCouncilComposition?.mode,
  });
}
/** A country pointer alone cannot authorize regional appointments or physical handover. */
export async function loadEnactedRussianCouncilFormation(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  country: CountryGameState;
  turn: number;
}) {
  const { db, session, game, country, turn } = input;
  const mandate = country.ruCouncilFormationMandate;
  if (!mandate || game.preset !== "1991-default") return null;
  if (
    !["regionalHeads", "regionalDelegates"].includes(mandate.mode) ||
    !Number.isSafeInteger(mandate.revision) ||
    mandate.revision < 1 ||
    !Number.isSafeInteger(mandate.sinceTurn) ||
    mandate.sinceTurn < 1 ||
    mandate.sinceTurn > turn ||
    mandate.proposalId !== `1991-default:ru-council:${mandate.mode}` ||
    !russianCouncilCompositionAvailable({
      mode: mandate.mode,
      preset: game.preset,
      currentTurn: turn,
      calendarTurn: clock(game, turn),
      assemblySinceTurn: country.ruFederalAssemblySinceTurn,
    }).available
  )
    throw new Error("Council formation requires valid dated authority");
  const proposal = await db
    .collection<RussianCouncilFormationProposal>(RUSSIAN_COUNCIL_FORMATION_PROPOSALS_COLLECTION)
    .findOne(
      {
        _id: mandate.proposalId,
        countryId: "RU",
        preset: "1991-default",
        status: "authorized",
        mode: mandate.mode,
        revision: mandate.revision,
        authorizedOnTurn: mandate.sinceTurn,
      },
      { session }
    );
  if (
    !proposal ||
    !Number.isSafeInteger(proposal.openedOnTurn) ||
    proposal.openedOnTurn < 1 ||
    proposal.openedOnTurn > mandate.sinceTurn
  )
    throw new Error("Council formation lacks its actual enactment receipt");
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: proposal.billId,
      countryId: "RU",
      stateId: "ru_national",
      status: "signed",
      enactedAt: { $type: "date" },
      "russianCouncilFormationMandate.proposalId": mandate.proposalId,
      "russianCouncilFormationMandate.revision": mandate.revision,
      "russianCouncilFormationMandate.mode": mandate.mode,
    },
    { session, projection: { _id: 1 } }
  );
  if (!bill) throw new Error("Council formation lacks its signed bound law");
  return mandate;
}
export async function materializeRussianCouncilFormationProposal(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
  mode: RussianCouncilCompositionMode;
  sponsor: Pick<Character, "_id" | "name"> | null;
  sponsorParty?: string;
  newBillId?: ObjectId;
}): Promise<RussianCouncilFormationProposal> {
  const { db, session, game, turn, now, mode } = input;
  if (!session.inTransaction() || !Number.isFinite(now.getTime()))
    throw new Error("Council formation needs a transaction and time");
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "RU" }, { session, projection });
  const available = availability(game, turn, mode, country);
  if (!available.available) throw new RussianConstitutionalDecisionConflict(available.reason);
  const proposals = db.collection<RussianCouncilFormationProposal>(
    RUSSIAN_COUNCIL_FORMATION_PROPOSALS_COLLECTION
  );
  const id = `1991-default:ru-council:${mode}`;
  const old = await proposals.findOne({ _id: id }, { session });
  if (old) {
    const bill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: old.billId },
        { session, projection: { countryId: 1, status: 1, russianCouncilFormationMandate: 1 } }
      );
    if (
      !bill ||
      bill.countryId !== "RU" ||
      bill.russianCouncilFormationMandate?.proposalId !== id ||
      bill.russianCouncilFormationMandate.revision !== old.revision ||
      bill.russianCouncilFormationMandate.mode !== mode
    )
      throw new RussianConstitutionalDecisionConflict(
        "Council bill no longer matches its proposal"
      );
    if (bill.status !== "failed") return old;
  }
  const proposal: RussianCouncilFormationProposal = {
    _id: id,
    countryId: "RU",
    preset: "1991-default",
    mode,
    revision: (old?.revision ?? 0) + 1,
    billId: input.newBillId ?? new ObjectId(),
    openedOnTurn: turn,
    status: "open",
    createdAt: now,
  };
  if (!Number.isSafeInteger(proposal.revision))
    throw new Error("Council formation revision exceeds precision");
  const bill: Bill = {
    _id: proposal.billId,
    countryId: "RU",
    stateId: "ru_national",
    title:
      mode === "regionalHeads"
        ? "Federation Council Regional Heads Formation Law"
        : "Federation Council Regional Delegates Formation Law",
    summary:
      mode === "regionalHeads"
        ? "Authorize the executive head and legislative chair of each federal subject to represent their region in the Federation Council. Each chamber must approve by a majority of its full capacity. Existing Council members remain until a viable regional handover."
        : "Authorize separate executive and legislative representatives, appointed by their respective regional authorities, to serve in the Federation Council. Each chamber must approve by a majority of its full capacity. Regional authority terms govern appointments; the national Council has no fixed election cycle.",
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
    russianCouncilFormationMandate: { proposalId: id, mode, revision: proposal.revision },
    proposedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const written = await proposals.updateOne(
    { _id: id, ...(old ? { revision: old.revision } : {}) },
    { $set: proposal },
    { session, upsert: !old }
  );
  if (old && written.matchedCount !== 1) throw new Error("Council proposal changed before opening");
  await db.collection<Bill>("bills").insertOne(bill, { session });
  return proposal;
}
export async function openRussianCouncilFormationProposal(
  input: Omit<Parameters<typeof materializeRussianCouncilFormationProposal>[0], "session">
) {
  const newBillId = new ObjectId();
  return runRequiredTransaction(
    (session) => materializeRussianCouncilFormationProposal({ ...input, newBillId, session }),
    { client: input.db.client }
  );
}
export async function authorizeRussianCouncilFormation(input: {
  db: Db;
  session: ClientSession;
  proposalId: string;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
}) {
  const { db, session, game, turn, now, proposalId } = input;
  if (!session.inTransaction() || !Number.isFinite(now.getTime()))
    throw new Error("Council enactment needs a transaction and time");
  if (game.preset !== "1991-default") return false;
  const proposals = db.collection<RussianCouncilFormationProposal>(
    RUSSIAN_COUNCIL_FORMATION_PROPOSALS_COLLECTION
  );
  const proposal = await proposals.findOne(
    { _id: proposalId, status: "open", preset: "1991-default", countryId: "RU" },
    { session }
  );
  if (!proposal) return false;
  if (
    !["regionalHeads", "regionalDelegates"].includes(proposal.mode) ||
    proposalId !== `1991-default:ru-council:${proposal.mode}` ||
    !Number.isSafeInteger(proposal.revision) ||
    proposal.revision < 1 ||
    proposal.openedOnTurn > turn
  )
    throw new Error("Council formation proposal identity changed");
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: proposal.billId,
      countryId: "RU",
      stateId: "ru_national",
      status: "signed",
      enactedAt: { $type: "date" },
    },
    { session, projection: { russianCouncilFormationMandate: 1 } }
  );
  if (!bill) return false;
  const binding = bill.russianCouncilFormationMandate;
  if (
    !binding ||
    binding.proposalId !== proposalId ||
    binding.revision !== proposal.revision ||
    binding.mode !== proposal.mode
  )
    throw new Error("Signed Council law does not match its proposal");
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne({ _id: "RU" }, { session, projection });
  if (!availability(game, turn, proposal.mode, country).available) return false;
  const claimed = await countries.updateOne(
    {
      _id: "RU",
      ruFederalAssemblySinceTurn: country!.ruFederalAssemblySinceTurn,
      ruCouncilFormationMandate: country!.ruCouncilFormationMandate ?? { $exists: false },
    },
    {
      $set: {
        ruCouncilFormationMandate: {
          mode: proposal.mode,
          proposalId,
          revision: proposal.revision,
          sinceTurn: turn,
        },
        updatedAt: now,
      },
    },
    { session }
  );
  if (claimed.matchedCount !== 1) throw new Error("Council formation authority changed");
  const recorded = await proposals.updateOne(
    { _id: proposalId, status: "open", revision: proposal.revision },
    { $set: { status: "authorized", authorizedOnTurn: turn } },
    { session }
  );
  if (recorded.matchedCount !== 1)
    throw new Error("Council law changed at final enactment receipt");
  return true;
}
export async function loadRussianCouncilFormationDecisions(
  db: Db,
  game: RussianConstitutionalCalendar,
  turn: number
) {
  if (game.preset !== "1991-default" || clock(game, turn) < 237) return [];
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "RU" }, { projection });
  if (country?.ruFederalAssemblySinceTurn == null) return [];
  const modes: RussianCouncilCompositionMode[] = ["regionalHeads", "regionalDelegates"];
  const proposals = await db
    .collection<RussianCouncilFormationProposal>(RUSSIAN_COUNCIL_FORMATION_PROPOSALS_COLLECTION)
    .find(
      { _id: { $in: modes.map((mode) => `1991-default:ru-council:${mode}`) } },
      { projection: { mode: 1, billId: 1, revision: 1, status: 1 } }
    )
    .toArray();
  const bills = proposals.length
    ? await db
        .collection<Bill>("bills")
        .find({ _id: { $in: proposals.map((row) => row.billId) } }, { projection: { status: 1 } })
        .toArray()
    : [];
  return modes.map((mode) => {
    const state = availability(game, turn, mode, country),
      proposal = proposals.find((row) => row.mode === mode),
      bill = proposal ? bills.find((row) => row._id.equals(proposal.billId)) : undefined;
    return {
      kind: mode,
      ...state,
      seatCapacity: 450,
      threshold: "majority" as const,
      proposal: proposal
        ? {
            billId: proposal.billId.toHexString(),
            revision: proposal.revision,
            status: proposal.status,
            billStatus: bill?.status ?? null,
            canRevise: state.available && bill?.status === "failed",
          }
        : null,
    };
  });
}
