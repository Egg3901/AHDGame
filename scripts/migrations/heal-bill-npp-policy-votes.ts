import { config } from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import type {
  Bill,
  BillWhip,
  ElectedOfficial,
  LegislationType,
  NPP,
  NPPVotePrediction,
  StateDemographics,
  StatePartyOrg,
} from "@/lib/db/types";
import { computeCrossPressureForces, verdictFromForces } from "@/lib/turn/npp/crossPressure";
import { resolveWhipForNPP } from "@/lib/turn/npp/whipResolution";

config({ path: ".env.local" });

type Vote = "for" | "against" | "abstain";
type Counts = Record<Vote, number>;

interface ChamberRepair {
  label: string;
  field: "votes" | "otherChamberVotes";
  chamber: string;
  oldNppCounts: Counts;
  newNppCounts: Counts;
  oldTotals: Counts;
  newTotals: Counts;
  changedVotes: Array<{
    key: string;
    nppId: ObjectId;
    name: string;
    party: string | null | undefined;
    seatsHeld: number;
    from: Vote;
    to: Vote;
    forces: { ideology: number; whip: number; district: number; donors: number };
  }>;
  predictions: Array<{
    nppId: ObjectId;
    forces: { ideology: number; whip: number; district: number; donors: number };
    donorsLabel: string;
    verdict: Vote;
    resolvedVote: Vote;
  }>;
}

function emptyCounts(): Counts {
  return { for: 0, against: 0, abstain: 0 };
}

function addCount(counts: Counts, vote: Vote, weight: number): void {
  counts[vote] += weight;
}

function getArg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function getBillCounter(bill: Bill, field: keyof Bill): number {
  const value = bill[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function totalsFor(bill: Bill, field: "votes" | "otherChamberVotes"): Counts {
  if (field === "otherChamberVotes") {
    return {
      for: getBillCounter(bill, "otherChamberVotesFor"),
      against: getBillCounter(bill, "otherChamberVotesAgainst"),
      abstain: getBillCounter(bill, "otherChamberVotesAbstain"),
    };
  }
  return {
    for: getBillCounter(bill, "votesFor"),
    against: getBillCounter(bill, "votesAgainst"),
    abstain: getBillCounter(bill, "votesAbstain"),
  };
}

function counterFields(field: "votes" | "otherChamberVotes") {
  if (field === "otherChamberVotes") {
    return {
      for: "otherChamberVotesFor",
      against: "otherChamberVotesAgainst",
      abstain: "otherChamberVotesAbstain",
    } as const;
  }
  return {
    for: "votesFor",
    against: "votesAgainst",
    abstain: "votesAbstain",
  } as const;
}

function recomputeChamber(params: {
  bill: Bill;
  label: string;
  field: "votes" | "otherChamberVotes";
  chamber: string;
  npps: Map<string, NPP>;
  officials: ElectedOfficial[];
  whips: BillWhip[];
  statePartyOrgs: Map<string, StatePartyOrg>;
  legislationType: LegislationType | null;
  demographics: Map<string, StateDemographics>;
}): ChamberRepair {
  const existing = (params.bill[params.field] ?? {}) as Record<string, Vote>;
  const nppKeys = new Set(Object.keys(existing).filter((key) => key.startsWith("npp_")));
  const countryId = params.bill.countryId ?? "US";
  const oldNppCounts = emptyCounts();
  const newNppCounts = emptyCounts();
  const changedVotes: ChamberRepair["changedVotes"] = [];
  const predictions: ChamberRepair["predictions"] = [];

  for (const official of params.officials) {
    if (!official.nppId || !official.isNPP) continue;
    if (official.officeType !== params.chamber) continue;
    if (official.countryId && official.countryId !== countryId) continue;

    const key = `npp_${official.nppId.toString()}`;
    if (!nppKeys.has(key)) continue;

    const oldVote = existing[key];
    if (!oldVote) continue;

    const npp = params.npps.get(official.nppId.toString());
    if (!npp) continue;

    const applicableWhip = resolveWhipForNPP(
      npp,
      params.whips,
      params.statePartyOrgs,
      official.officeType
    );
    const homeStateDemographics = params.demographics.get(npp.homeState) ?? null;
    const { forces, donorsLabel } = computeCrossPressureForces(npp, params.bill, {
      legislationType: params.legislationType,
      homeStateDemographics,
      whips: { partyWhip: applicableWhip, caucusWhip: null },
    });
    const vote = verdictFromForces(forces);
    const weight = official.seatsHeld ?? 1;

    addCount(oldNppCounts, oldVote, weight);
    addCount(newNppCounts, vote, weight);

    predictions.push({
      nppId: official.nppId,
      forces,
      donorsLabel,
      verdict: vote,
      resolvedVote: vote,
    });

    if (oldVote !== vote) {
      changedVotes.push({
        key,
        nppId: official.nppId,
        name: npp.name,
        party: npp.party,
        seatsHeld: weight,
        from: oldVote,
        to: vote,
        forces,
      });
    }
  }

  const oldTotals = totalsFor(params.bill, params.field);
  const newTotals = {
    for: oldTotals.for - oldNppCounts.for + newNppCounts.for,
    against: oldTotals.against - oldNppCounts.against + newNppCounts.against,
    abstain: oldTotals.abstain - oldNppCounts.abstain + newNppCounts.abstain,
  };

  return {
    label: params.label,
    field: params.field,
    chamber: params.chamber,
    oldNppCounts,
    newNppCounts,
    oldTotals,
    newTotals,
    changedVotes,
    predictions,
  };
}

async function main() {
  const billId = getArg("bill") ?? "6a063d11faf4a6cf1e8a19a9";
  const apply = process.argv.includes("--apply");
  const currentOnly = process.argv.includes("--current-only");
  const uri = process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI_LIVE or MONGODB_URI must be set");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db("a-house-divided");
    const bill = await db.collection<Bill>("bills").findOne({ _id: new ObjectId(billId) });
    if (!bill) throw new Error(`Bill ${billId} not found`);

    const [
      npps,
      officials,
      whips,
      statePartyOrgRows,
      legislationType,
      demographicsRows,
      gameState,
    ] = await Promise.all([
      db.collection<NPP>("npps").find({ retiredAt: null }).toArray(),
      db.collection<ElectedOfficial>("electedOfficials").find({ isNPP: true }).toArray(),
      db
        .collection<BillWhip>("billWhips")
        .find({
          targetType: "bill",
          targetId: bill._id,
          $or: [{ audience: "npp" }, { audience: { $exists: false } }],
        })
        .toArray(),
      db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray(),
      bill.legislationTypeId
        ? db
            .collection<LegislationType>("legislationTypes")
            .findOne({ _id: bill.legislationTypeId })
        : Promise.resolve(null),
      db.collection<StateDemographics>("stateDemographics").find({}).toArray(),
      db.collection<{ _id: string; currentTurn?: number }>("gameState").findOne({ _id: "current" }),
    ]);

    const nppMap = new Map(npps.map((npp) => [npp._id.toString(), npp]));
    const statePartyOrgs = new Map(statePartyOrgRows.map((org) => [org._id, org]));
    const demographics = new Map(demographicsRows.map((row) => [row._id, row]));

    const hasOtherChamberVote = bill.status === "active_other" || !!bill.otherChamberVotes;
    const repairs: ChamberRepair[] = [];

    if (!currentOnly || !hasOtherChamberVote) {
      repairs.push(
        recomputeChamber({
          bill,
          label: "origin",
          field: "votes",
          chamber: bill.originChamber,
          npps: nppMap,
          officials,
          whips,
          statePartyOrgs,
          legislationType,
          demographics,
        })
      );
    }

    if (hasOtherChamberVote) {
      repairs.push(
        recomputeChamber({
          bill,
          label: "other",
          field: "otherChamberVotes",
          chamber: bill.currentChamber,
          npps: nppMap,
          officials,
          whips,
          statePartyOrgs,
          legislationType,
          demographics,
        })
      );
    }

    const summary = {
      mode: apply ? "apply" : "dry-run",
      currentOnly,
      bill: {
        id: bill._id.toString(),
        title: bill.title,
        status: bill.status,
        originChamber: bill.originChamber,
        currentChamber: bill.currentChamber,
      },
      repairs: repairs.map((repair) => ({
        label: repair.label,
        field: repair.field,
        chamber: repair.chamber,
        changedVotes: repair.changedVotes.length,
        oldNppCounts: repair.oldNppCounts,
        newNppCounts: repair.newNppCounts,
        oldTotals: repair.oldTotals,
        newTotals: repair.newTotals,
        sampleChanges: repair.changedVotes.slice(0, 12).map((change) => ({
          name: change.name,
          party: change.party,
          seatsHeld: change.seatsHeld,
          from: change.from,
          to: change.to,
          forces: change.forces,
        })),
      })),
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!apply) return;

    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    for (const repair of repairs) {
      const fields = counterFields(repair.field);
      setFields[fields.for] = repair.newTotals.for;
      setFields[fields.against] = repair.newTotals.against;
      setFields[fields.abstain] = repair.newTotals.abstain;
      for (const change of repair.changedVotes) {
        setFields[`${repair.field}.${change.key}`] = change.to;
      }
    }

    await db.collection<Bill>("bills").updateOne({ _id: bill._id }, { $set: setFields });

    const currentRepair =
      repairs.find((repair) => repair.field === "otherChamberVotes") ?? repairs[0];
    if (currentRepair.predictions.length > 0) {
      const now = new Date();
      await db.collection<NPPVotePrediction>("nppVotePredictions").bulkWrite(
        currentRepair.predictions.map((prediction) => ({
          updateOne: {
            filter: { nppId: prediction.nppId, billId: bill._id },
            update: {
              $set: {
                computedAtTurn: gameState?.currentTurn ?? 0,
                forces: prediction.forces,
                donorsLabel: prediction.donorsLabel,
                verdict: prediction.verdict,
                resolvedVote: prediction.resolvedVote,
                updatedAt: now,
              },
              $setOnInsert: {
                nppId: prediction.nppId,
                billId: bill._id,
                createdAt: now,
              },
            },
            upsert: true,
          },
        }))
      );
    }

    console.log("Applied bill NPP vote repair.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
