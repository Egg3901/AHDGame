/**
 * Russian constitutional proposals put each institutional choice to the seated chamber.
 * materializeRussianConstitutionalProposal creates a normal bill transactionally;
 * authorizeRussianConstitutionalMandate records only its bound enacted decision.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Bill, Character, CountryGameState, GameState } from "@/lib/db/types";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
import { calendarTurn } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  russianConstitutionalDecisionAvailability,
  type RussianConstitutionalDecisionKind,
} from "./rules/constitutionalDecisions";

export const RUSSIAN_CONSTITUTIONAL_PROPOSALS_COLLECTION = "russianConstitutionalProposals";
export interface RussianConstitutionalProposal {
  _id: string;
  preset: "1991-default";
  kind: RussianConstitutionalDecisionKind;
  revision: number;
  billId: ObjectId;
  openedOnTurn: number;
  status: "open" | "authorized";
  authorizedOnTurn?: number;
  createdAt: Date;
}
export type RussianConstitutionalCalendar = Pick<
  GameState,
  "preset" | "preIteration" | "preIterationTurns"
>;
const markerProjection = {
  ruSovietSuccessionSinceTurn: 1,
  ruProvisionalCongressSeats: 1,
  ruPresidencySinceTurn: 1,
  ruPresidencyMandateSinceTurn: 1,
  ruCongressDissolvedSinceTurn: 1,
  ruFederalAssemblySinceTurn: 1,
  ruFederalAssemblyMandateSinceTurn: 1,
};
function decisionClock(game: RussianConstitutionalCalendar, turn: number) {
  return calendarTurn(turn, {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  });
}
export class RussianConstitutionalDecisionConflict extends Error {}

export async function materializeRussianConstitutionalProposal(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
  kind: RussianConstitutionalDecisionKind;
  sponsor: Pick<Character, "_id" | "name"> | null;
  sponsorParty?: string;
  newBillId?: ObjectId;
}): Promise<RussianConstitutionalProposal> {
  const { db, session, game, turn, now, kind, sponsor, sponsorParty } = input;
  if (!session.inTransaction() || !Number.isFinite(now.getTime()))
    throw new Error("Russian constitutional proposal needs an active transaction and time");
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne({ _id: "RU" }, { session, projection: markerProjection });
  const available = russianConstitutionalDecisionAvailability({
    preset: game.preset,
    currentTurn: turn,
    calendarTurn: decisionClock(game, turn),
    country,
    kind,
  });
  if (!available.available) throw new RussianConstitutionalDecisionConflict(available.reason);
  const config = getCountryConfigForRuntime("RU", "1991-default", country);
  if (
    config.legislature.lowerChamber.elected === false ||
    config.legislature.lowerChamber.seats < 1
  )
    throw new RussianConstitutionalDecisionConflict("no-legislature");
  const proposals = db.collection<RussianConstitutionalProposal>(
    RUSSIAN_CONSTITUTIONAL_PROPOSALS_COLLECTION
  );
  const proposalId = `1991-default:ru-constitution:${kind}`;
  const existing = await proposals.findOne({ _id: proposalId }, { session });
  if (existing) {
    const oldBill = await db
      .collection<Bill>("bills")
      .findOne(
        { _id: existing.billId },
        { session, projection: { status: 1, russianConstitutionalMandate: 1, countryId: 1 } }
      );
    if (
      !oldBill ||
      oldBill.countryId !== "RU" ||
      oldBill.russianConstitutionalMandate?.proposalId !== proposalId ||
      oldBill.russianConstitutionalMandate.kind !== kind ||
      oldBill.russianConstitutionalMandate.revision !== existing.revision
    )
      throw new RussianConstitutionalDecisionConflict(
        "Existing constitutional bill no longer matches its proposal"
      );
    if (oldBill.status !== "failed") return existing;
  }
  const proposal: RussianConstitutionalProposal = {
    _id: proposalId,
    preset: "1991-default",
    kind,
    revision: (existing?.revision ?? 0) + 1,
    billId: input.newBillId ?? new ObjectId(),
    openedOnTurn: turn,
    status: "open",
    createdAt: now,
  };
  const chamber = config.legislature.lowerChamber.key;
  const bill: Bill = {
    _id: proposal.billId,
    countryId: "RU",
    stateId: "ru_national",
    title:
      kind === "presidency"
        ? "Russian Presidency Constitutional Decision"
        : "Russian Federal Assembly Constitutional Decision",
    summary:
      kind === "presidency"
        ? "Two-thirds of the full current chamber capacity must approve. Authorize a direct presidential election. The current legislature and government remain in place. A certified election is required before the presidency replaces the appointed head of state."
        : "Two-thirds of the full current chamber capacity must approve. Authorize elections for a 450-seat State Duma and 178-seat Federation Council. The presidency remains a separate decision. A certified election is required before the new chambers take office.",
    originChamber: chamber,
    currentChamber: chamber,
    sponsorId: sponsor?._id ?? null,
    sponsorName: sponsor?.name ?? "Russian Government",
    ...(sponsorParty ? { sponsorParty } : {}),
    status: "proposed",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    category: "government",
    provisions: [],
    russianConstitutionalMandate: { proposalId, kind, revision: proposal.revision },
    proposedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const updated = await proposals.updateOne(
    { _id: proposalId, ...(existing ? { revision: existing.revision } : {}) },
    { $set: proposal },
    { session, upsert: !existing }
  );
  if (existing && updated.matchedCount !== 1)
    throw new RussianConstitutionalDecisionConflict("Constitutional proposal changed");
  await db.collection<Bill>("bills").insertOne(bill, { session });
  return proposal;
}

export async function openRussianConstitutionalProposal(
  input: Omit<Parameters<typeof materializeRussianConstitutionalProposal>[0], "session">
): Promise<RussianConstitutionalProposal> {
  const newBillId = input.newBillId ?? new ObjectId();
  return runRequiredTransaction(
    (session) => materializeRussianConstitutionalProposal({ ...input, newBillId, session }),
    { client: input.db.client }
  );
}

export async function authorizeRussianConstitutionalMandate(input: {
  db: Db;
  session: ClientSession;
  proposalId: string;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
}): Promise<boolean> {
  const { db, session, proposalId, game, turn, now } = input;
  if (!session.inTransaction() || !Number.isFinite(now.getTime()))
    throw new Error("Constitutional authorization needs a transaction and time");
  const proposals = db.collection<RussianConstitutionalProposal>(
    RUSSIAN_CONSTITUTIONAL_PROPOSALS_COLLECTION
  );
  const proposal = await proposals.findOne(
    { _id: proposalId, status: "open", preset: "1991-default" },
    { session }
  );
  if (!proposal || game.preset !== "1991-default") return false;
  if (
    (proposal.kind !== "presidency" && proposal.kind !== "federalAssembly") ||
    proposal._id !== `1991-default:ru-constitution:${proposal.kind}` ||
    !Number.isSafeInteger(proposal.revision) ||
    proposal.revision < 1
  )
    throw new RussianConstitutionalDecisionConflict("Invalid constitutional proposal identity");
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: proposal.billId,
      countryId: "RU",
      stateId: "ru_national",
      status: "signed",
      enactedAt: { $exists: true, $ne: null },
    },
    { session, projection: { russianConstitutionalMandate: 1, enactedAt: 1 } }
  );
  if (!bill) return false;
  const mandate = bill.russianConstitutionalMandate;
  if (
    !mandate ||
    mandate.proposalId !== proposalId ||
    mandate.kind !== proposal.kind ||
    mandate.revision !== proposal.revision ||
    proposal.openedOnTurn > turn
  )
    throw new RussianConstitutionalDecisionConflict(
      "Enacted constitutional bill does not match its proposal"
    );
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne({ _id: "RU" }, { session, projection: markerProjection });
  const available = russianConstitutionalDecisionAvailability({
    preset: game.preset,
    currentTurn: turn,
    calendarTurn: decisionClock(game, turn),
    country,
    kind: proposal.kind,
  });
  if (!available.available) return false;
  const field =
    proposal.kind === "presidency"
      ? "ruPresidencyMandateSinceTurn"
      : "ruFederalAssemblyMandateSinceTurn";
  const previousMarker = country![field];
  const result = await countries.updateOne(
    {
      _id: "RU",
      [field]: previousMarker === undefined ? { $exists: false } : previousMarker,
      ruSovietSuccessionSinceTurn: country!.ruSovietSuccessionSinceTurn,
    },
    { $set: { [field]: turn, updatedAt: now } },
    { session }
  );
  if (result.matchedCount !== 1)
    throw new RussianConstitutionalDecisionConflict("Russian constitutional authority changed");
  const recorded = await proposals.updateOne(
    { _id: proposalId, revision: proposal.revision, status: "open" },
    { $set: { status: "authorized", authorizedOnTurn: turn } },
    { session }
  );
  if (recorded.matchedCount !== 1)
    throw new RussianConstitutionalDecisionConflict("Russian constitutional proposal changed");
  return true;
}

export async function processRussianConstitutionalMandates(
  db: Db,
  game: RussianConstitutionalCalendar,
  turn: number,
  now: Date
): Promise<number> {
  if (game.preset !== "1991-default") return 0;
  const proposals = await db
    .collection<RussianConstitutionalProposal>(RUSSIAN_CONSTITUTIONAL_PROPOSALS_COLLECTION)
    .find(
      {
        preset: "1991-default",
        status: "open",
        _id: {
          $in: [
            "1991-default:ru-constitution:presidency",
            "1991-default:ru-constitution:federalAssembly",
          ],
        },
      },
      { projection: { _id: 1 } }
    )
    .limit(2)
    .toArray();
  let count = 0;
  for (const proposal of proposals)
    if (
      await runRequiredTransaction(
        (session) =>
          authorizeRussianConstitutionalMandate({
            db,
            session,
            proposalId: proposal._id,
            game,
            turn,
            now,
          }),
        { client: db.client }
      )
    )
      count += 1;
  return count;
}

/** Public decision state contains the parliamentary bill, never private actor data. */
export async function loadRussianConstitutionalDecisions(
  db: Db,
  game: RussianConstitutionalCalendar,
  turn: number
) {
  if (game.preset !== "1991-default") return [];
  const kinds: RussianConstitutionalDecisionKind[] = ["presidency", "federalAssembly"];
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "RU" }, { projection: markerProjection });
  const proposals = await db
    .collection<RussianConstitutionalProposal>(RUSSIAN_CONSTITUTIONAL_PROPOSALS_COLLECTION)
    .find(
      { _id: { $in: kinds.map((kind) => `1991-default:ru-constitution:${kind}`) } },
      { projection: { kind: 1, billId: 1, revision: 1, status: 1 } }
    )
    .toArray();
  const bills = proposals.length
    ? await db
        .collection<Bill>("bills")
        .find(
          { _id: { $in: proposals.map((proposal) => proposal.billId) } },
          { projection: { status: 1 } }
        )
        .toArray()
    : [];
  const config = getCountryConfigForRuntime("RU", "1991-default", country);
  return kinds.map((kind) => {
    const availability = russianConstitutionalDecisionAvailability({
      preset: game.preset,
      currentTurn: turn,
      calendarTurn: decisionClock(game, turn),
      country,
      kind,
    });
    const proposal = proposals.find((row) => row.kind === kind);
    const bill = proposal ? bills.find((row) => row._id.equals(proposal.billId)) : undefined;
    return {
      kind,
      ...availability,
      seatCapacity: config.legislature.lowerChamber.seats,
      proposal: proposal
        ? {
            billId: proposal.billId.toHexString(),
            revision: proposal.revision,
            status: proposal.status,
            billStatus: bill?.status ?? null,
            canRevise: availability.available && bill?.status === "failed",
          }
        : null,
    };
  });
}
