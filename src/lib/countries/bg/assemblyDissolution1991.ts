/**
 * A continued Bulgarian constituent chamber may end its retained mandate by
 * a separate ordinary vote. The motion never adopts a constitution or cancels
 * recorded ballots; an enacted bound result advances only untouched campaigns.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Bill, Character, CountryGameState, GameState } from "@/lib/db/types";
import type { CountryState } from "@/lib/db/types/countryState";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  BG_1991_PROPOSALS_COLLECTION,
  Bg1991ConstitutionalConflict,
  rebindBg1991PrimaryCohort,
  type Bg1991ConstitutionalProposal,
} from "./constitutionalProposals1991";
import {
  passesBgContinuedAssemblyDissolution,
  bgContinuedAssemblyDissolutionAvailability,
} from "./rules/constitutionalDecision1991";

export const BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID =
  "1991-default:bg-constitutional:dissolution1991";
async function availability(db: Db, turn: number, session?: ClientSession) {
  const readGame = () =>
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { session, projection: { preset: 1, preIteration: 1 } });
  const readCountry = () =>
    db.collection<CountryGameState>("countryGameStates").findOne(
      { _id: "BG" },
      {
        session,
        projection: {
          bgConstitution1991SinceTurn: 1,
          bgGrandAssemblyContinuationSinceTurn: 1,
          bgGrandAssemblyDissolutionSinceTurn: 1,
          bgOrdinaryAssemblySinceTurn: 1,
          dissolvedTurn: 1,
        },
      }
    );
  const readRuntime = () =>
    db
      .collection<CountryState>("countryState")
      .findOne({ _id: "BG" }, { session, projection: { governmentType: 1 } });
  // Parallel operations on a single transaction session are unsupported.
  const [game, country, runtime] = session
    ? ([await readGame(), await readCountry(), await readRuntime()] as const)
    : await Promise.all([readGame(), readCountry(), readRuntime()]);
  return bgContinuedAssemblyDissolutionAvailability({
    preset: game?.preset,
    founding: game?.preIteration?.active,
    turn,
    constitutionTurn: country?.bgConstitution1991SinceTurn,
    continuationTurn: country?.bgGrandAssemblyContinuationSinceTurn,
    dissolutionTurn: country?.bgGrandAssemblyDissolutionSinceTurn,
    ordinaryTurn: country?.bgOrdinaryAssemblySinceTurn,
    hasParliament:
      country?.dissolvedTurn == null &&
      (!runtime || runtime.governmentType === "parliamentaryRepublic"),
  });
}

export async function loadBg1991AssemblyDissolutionDecision(db: Db, turn: number) {
  const allowed = await availability(db, turn);
  const proposal = await db
    .collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION)
    .findOne({ _id: BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID });
  const bill = proposal
    ? await db
        .collection<Bill>("bills")
        .findOne({ _id: proposal.billId }, { projection: { status: 1 } })
    : null;
  return {
    ...allowed,
    kind: "dissolution1991" as const,
    proposal: proposal
      ? {
          billId: proposal.billId.toHexString(),
          billStatus: bill?.status ?? null,
          canRevise:
            allowed.available &&
            !!bill &&
            ["failed", "vetoed", "override_failed"].includes(bill.status),
        }
      : null,
  };
}

export async function openBg1991AssemblyDissolution(input: {
  db: Db;
  turn: number;
  now: Date;
  sponsor: Pick<Character, "_id" | "name"> | null;
}) {
  const { db, turn, now, sponsor } = input;
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Invalid Bulgarian dissolution clock");
  const billId = new ObjectId();
  return runRequiredTransaction(
    async (session) => {
      const allowed = await availability(db, turn, session);
      if (!allowed.available) throw new Bg1991ConstitutionalConflict(allowed.reason);
      const journal = db.collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION);
      const prior = await journal.findOne(
        { _id: BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID },
        { session }
      );
      if (prior) {
        const bill = await db.collection<Bill>("bills").findOne(
          { _id: prior.billId },
          {
            session,
            projection: {
              countryId: 1,
              status: 1,
              bulgarianConstitutionalMandate: 1,
              "voteSnapshot.resolvedAtTurn": 1,
            },
          }
        );
        if (
          !Number.isSafeInteger(prior.revision) ||
          prior.revision < 1 ||
          !bill ||
          bill.countryId !== "BG" ||
          bill.bulgarianConstitutionalMandate?.proposalId !== prior._id ||
          bill.bulgarianConstitutionalMandate.revision !== prior.revision ||
          bill.bulgarianConstitutionalMandate.kind !== "dissolution1991"
        )
          throw new Bg1991ConstitutionalConflict("Dissolution proposal no longer matches its bill");
        if (!["failed", "vetoed", "override_failed"].includes(bill.status)) return prior;
        if (
          turn < prior.openedOnTurn ||
          (bill.voteSnapshot && turn < bill.voteSnapshot.resolvedAtTurn)
        )
          throw new Bg1991ConstitutionalConflict(
            "A revised motion cannot precede the previous vote"
          );
      }
      const regions = await db
        .collection("states")
        .find({ countryId: "BG" }, { session, projection: { houseDistricts: 1 } })
        .toArray();
      if (regions.reduce((sum, row) => sum + (row.houseDistricts ?? 0), 0) !== 400)
        throw new Bg1991ConstitutionalConflict(
          "The continued chamber must retain its 400 mandates"
        );
      const office = sponsor
        ? await db.collection("electedOfficials").findOne(
            {
              countryId: "BG",
              characterId: sponsor._id,
              officeType: { $in: ["assemblyDeputy", "primeMinister", "president"] },
              seatsHeld: { $ne: 0 },
            },
            { session, projection: { party: 1 } }
          )
        : null;
      if (sponsor && !office)
        throw new Bg1991ConstitutionalConflict(
          "A continued deputy, government or President must introduce this motion"
        );
      const proposal: Bg1991ConstitutionalProposal = {
        _id: BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID,
        billId,
        revision: (prior?.revision ?? 0) + 1,
        openedOnTurn: turn,
        status: "open",
        reason: "continued_assembly_motion",
        capacity: 400,
        disposition: "dissolve",
        createdAt: now,
      };
      const bill: Bill = {
        _id: billId,
        countryId: "BG",
        stateId: "bg_national",
        title: "Dissolve the Continued Bulgarian Assembly",
        summary:
          "End the alternate constitution's continued 400-seat mandate and advance the ordinary 240-seat election. More than 200 deputies must participate, and a majority present must support the motion. Recorded ballots retain their frozen rules; deputies continue caretaker legislative functions until their elected successors take office.",
        originChamber: "nationalAssembly",
        currentChamber: "nationalAssembly",
        sponsorId: sponsor?._id ?? null,
        sponsorName: sponsor?.name ?? "Bulgarian Government",
        ...(typeof office?.party === "string" ? { sponsorParty: office.party } : {}),
        status: "proposed",
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 0,
        votes: {},
        category: "government",
        provisions: [],
        bulgarianConstitutionalMandate: {
          proposalId: proposal._id,
          revision: proposal.revision,
          kind: "dissolution1991",
          disposition: "dissolve",
        },
        proposedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      const claimed = await journal.updateOne(
        { _id: proposal._id, ...(prior ? { revision: prior.revision } : {}) },
        { $set: proposal },
        { session, upsert: !prior }
      );
      if (prior && claimed.matchedCount !== 1)
        throw new Bg1991ConstitutionalConflict("Dissolution motion changed concurrently");
      await db.collection<Bill>("bills").insertOne(bill, { session });
      return proposal;
    },
    { client: db.client }
  );
}

export async function processBg1991AssemblyDissolution(
  db: Db,
  game: Pick<GameState, "preset" | "preIteration" | "preIterationTurns">,
  turn: number,
  now: Date
) {
  if (game.preset !== "1991-default") return false;
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Invalid Bulgarian dissolution clock");
  const journal = db.collection<Bg1991ConstitutionalProposal>(BG_1991_PROPOSALS_COLLECTION);
  const pending = await journal.findOne(
    { _id: BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID, status: "open" },
    { projection: { billId: 1 } }
  );
  if (
    !pending ||
    !(await db
      .collection<Bill>("bills")
      .findOne({ _id: pending.billId, status: "signed" }, { projection: { _id: 1 } }))
  )
    return false;
  return runRequiredTransaction(
    async (session) => {
      if (!(await availability(db, turn, session)).available) return false;
      const proposal = await journal.findOne(
        { _id: BG_CONTINUED_ASSEMBLY_DISSOLUTION_ID, status: "open" },
        { session }
      );
      if (!proposal || proposal.capacity !== 400) return false;
      if (!Number.isSafeInteger(proposal.revision) || proposal.revision < 1)
        throw new Bg1991ConstitutionalConflict("Invalid dissolution revision");
      const bill = await db.collection<Bill>("bills").findOne(
        {
          _id: proposal.billId,
          countryId: "BG",
          stateId: "bg_national",
          status: "signed",
          enactedAt: { $type: "date" },
        },
        { session, projection: { bulgarianConstitutionalMandate: 1, "voteSnapshot.totals": 1 } }
      );
      const mandate = bill?.bulgarianConstitutionalMandate;
      if (
        !mandate ||
        mandate.proposalId !== proposal._id ||
        mandate.revision !== proposal.revision ||
        mandate.kind !== "dissolution1991" ||
        mandate.disposition !== "dissolve"
      )
        return false;
      if (
        !bill?.voteSnapshot ||
        !passesBgContinuedAssemblyDissolution(bill.voteSnapshot.totals, 400)
      )
        throw new Bg1991ConstitutionalConflict("Dissolution lacks a frozen quorate majority vote");
      await rebindBg1991PrimaryCohort(db, game, turn, now, session);
      const changed = await db
        .collection<CountryGameState>("countryGameStates")
        .updateOne(
          { _id: "BG", bgGrandAssemblyDissolutionSinceTurn: { $exists: false } },
          { $set: { bgGrandAssemblyDissolutionSinceTurn: turn } },
          { session }
        );
      if (changed.modifiedCount !== 1)
        throw new Bg1991ConstitutionalConflict("Continued chamber authority changed concurrently");
      const marked = await journal.updateOne(
        { _id: proposal._id, status: "open", revision: proposal.revision },
        { $set: { status: "authorized", authorizedOnTurn: turn } },
        { session }
      );
      if (marked.modifiedCount !== 1)
        throw new Bg1991ConstitutionalConflict("Dissolution motion changed concurrently");
      return true;
    },
    { client: db.client }
  );
}
