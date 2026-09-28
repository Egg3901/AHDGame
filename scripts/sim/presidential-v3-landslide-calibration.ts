/**
 * Presidential v3 landslide calibration, READ ONLY.
 *
 * Replays the next US presidential vote turn through the production engine
 * under the legacy post-processing knobs, each individual v3 correction, and
 * the combined v3 rules. Existing ballots remain fixed in every arm.
 *
 * Uses MONGODB_URI_LIVE when present and never writes because every engine run
 * is dry-run-only. Output is aggregate party/share/EV evidence only.
 *
 * Run: npx tsx scripts/sim/presidential-v3-landslide-calibration.ts
 */

import * as path from "path";
import * as dotenv from "dotenv";

const loadedEnv = dotenv.config({
  path: process.env.AHD_ENV_FILE ?? path.resolve(process.cwd(), ".env.local"),
});
const liveUri = loadedEnv.parsed?.MONGODB_URI_LIVE ?? process.env.MONGODB_URI_LIVE;
if (liveUri) {
  const directLiveUri = liveUri.includes("directConnection=")
    ? liveUri
    : `${liveUri}${liveUri.includes("?") ? "&" : "?"}directConnection=true`;
  process.env.MONGODB_URI_LIVE = directLiveUri;
  process.env.MONGODB_URI = directLiveUri;
}

import { ObjectId } from "mongodb";
import type {
  PresidentVoteTurnDryRun,
  PresidentVoteTurnCalibration,
} from "@/lib/presidentialElectionEngine";

const COUNTRY = "US";

const LEGACY = {
  campaignStrengthMaxBonus: 1,
  applyExplicitLeanMultiplier: true,
  tacticalMovementRate: 0,
  incumbentApprovalStateWeight: 0,
} as const;

const CURRENT = {
  campaignStrengthMaxBonus: 0.25,
  applyExplicitLeanMultiplier: false,
  tacticalMovementRate: 0.05,
  incumbentApprovalStateWeight: 0.5,
} as const;

const scenarios: Array<{
  id: string;
  label: string;
  override: NonNullable<PresidentVoteTurnCalibration["rulesetOverride"]>;
}> = [
  { id: "legacy", label: "Legacy v3 behavior", override: LEGACY },
  {
    id: "campaign",
    label: "Campaign cap only",
    override: { ...LEGACY, campaignStrengthMaxBonus: CURRENT.campaignStrengthMaxBonus },
  },
  {
    id: "lean",
    label: "Lean deduplication only",
    override: { ...LEGACY, applyExplicitLeanMultiplier: CURRENT.applyExplicitLeanMultiplier },
  },
  {
    id: "tactical",
    label: "5% tactical movement only",
    override: { ...LEGACY, tacticalMovementRate: CURRENT.tacticalMovementRate },
  },
  {
    id: "approval",
    label: "50/50 approval blend only",
    override: {
      ...LEGACY,
      incumbentApprovalStateWeight: CURRENT.incumbentApprovalStateWeight,
    },
  },
  { id: "combined", label: "Combined current v3", override: CURRENT },
];

type ScenarioResult = {
  id: string;
  label: string;
  national: Record<string, number>;
  marginal: Record<string, number>;
  electoral: Record<string, number>;
  unitWinners: Record<string, string>;
  competitiveUnits: number;
};

function shares(votes: Record<string, number>, candidates: string[]): Record<string, number> {
  const total = candidates.reduce((sum, id) => sum + Math.max(0, votes[id] ?? 0), 0);
  return Object.fromEntries(
    candidates.map((id) => [id, total > 0 ? (100 * Math.max(0, votes[id] ?? 0)) / total : 0])
  );
}

function winnerAndMargin(votes: Record<string, number>, candidates: string[]) {
  const ranked = candidates
    .map((id) => ({ id, votes: Math.max(0, votes[id] ?? 0) }))
    .sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
  const total = ranked.reduce((sum, row) => sum + row.votes, 0);
  return {
    winner: ranked[0]?.id ?? "",
    margin: total > 0 ? (100 * ((ranked[0]?.votes ?? 0) - (ranked[1]?.votes ?? 0))) / total : 0,
  };
}

function partyLabel(
  candidateId: string,
  parties: Record<string, string>,
  partyNames: Map<string, string>
): string {
  const partyId = String(parties[candidateId] ?? candidateId);
  return String(partyNames.get(partyId) ?? partyId).replaceAll("|", "/");
}

async function main() {
  if (!process.env.MONGODB_URI_LIVE) {
    throw new Error("MONGODB_URI_LIVE is required for the read-only calibration replay");
  }

  // Runtime imports come after the live URI override. Some election modules
  // validate/cache the environment during import.
  const [{ getDb }, { loadApportionment }, { accumulatePresidentVoteTurn }] = await Promise.all([
    import("@/lib/mongodb"),
    import("@/lib/elections/apportionment"),
    import("@/lib/presidentialElectionEngine"),
  ]);
  const db = await getDb();
  const election = await db.collection("elections").findOne({
    countryId: COUNTRY,
    electionType: "president",
    status: "active",
  });
  if (!election) throw new Error("No active US presidential election");
  if (election.rulesetVersion !== 3) {
    throw new Error(
      `Expected the active election to use v3, found ${String(election.rulesetVersion)}`
    );
  }

  const [gameState, tally, partyDocs] = await Promise.all([
    db.collection("gameState").findOne({ _id: "current" as never }),
    db.collection("electionVoteTallies").findOne({ electionId: election._id as ObjectId }),
    db
      .collection("politicalParties")
      .find({ countryId: COUNTRY }, { projection: { sequentialId: 1, abbreviation: 1, name: 1 } })
      .toArray(),
  ]);
  if (!tally) throw new Error("Active election has no vote tally");

  const currentTurn = Number(gameState?.currentTurn ?? 0);
  const nextTurn = currentTurn + 1;
  const candidates = Object.keys((tally.totalVotes ?? {}) as Record<string, number>);
  const beforeNational = (tally.totalVotes ?? {}) as Record<string, number>;
  const parties = (tally.candidateParties ?? {}) as Record<string, string>;
  const partyNames = new Map(
    partyDocs.map((party) => [
      String(party.sequentialId),
      String(party.abbreviation ?? party.name ?? party._id),
    ])
  );
  const apportionment = await loadApportionment(
    db,
    gameState?.preset as string | undefined,
    gameState?.currentYear as number | undefined
  );
  const evByUnit = new Map(apportionment.electoralVoteUnits.map((unit) => [unit.unitId, unit.ev]));

  const results: ScenarioResult[] = [];
  const replayNow = new Date();
  for (const scenario of scenarios) {
    const run = (await accumulatePresidentVoteTurn(election._id as ObjectId, nextTurn, replayNow, {
      dryRun: true,
      rulesetOverride: scenario.override,
    })) as PresidentVoteTurnDryRun;
    if (!run) throw new Error(`Dry run returned no result for ${scenario.id}`);

    const marginalVotes = Object.fromEntries(
      candidates.map((id) => [id, (run.totalVotes[id] ?? 0) - (beforeNational[id] ?? 0)])
    );
    const electoral: Record<string, number> = Object.fromEntries(candidates.map((id) => [id, 0]));
    const unitWinners: Record<string, string> = {};
    let competitiveUnits = 0;
    for (const [unitId, votes] of Object.entries(run.totalVotesByUnit)) {
      const { winner, margin } = winnerAndMargin(votes, candidates);
      if (!winner) continue;
      unitWinners[unitId] = winner;
      electoral[winner] = (electoral[winner] ?? 0) + (evByUnit.get(unitId) ?? 0);
      if (margin < 5) competitiveUnits++;
    }
    results.push({
      id: scenario.id,
      label: scenario.label,
      national: shares(run.totalVotes, candidates),
      marginal: shares(marginalVotes, candidates),
      electoral,
      unitWinners,
      competitiveUnits,
    });
  }

  const legacy = results[0];
  console.log(`# Presidential v3 landslide calibration`);
  console.log(``);
  console.log(`Active ruleset: v${String(election.rulesetVersion)}; replay turn: ${nextTurn}.`);
  console.log(`Existing ballots are held fixed. Each row changes only the next turn.`);
  console.log(``);
  console.log(
    `| Scenario | National cumulative | Next-turn vote | Electoral votes | Flips vs legacy | <5pt units |`
  );
  console.log(`|---|---|---|---|---:|---:|`);
  for (const result of results) {
    const national = candidates
      .map((id) => `${partyLabel(id, parties, partyNames)} ${result.national[id].toFixed(2)}%`)
      .join(", ");
    const marginal = candidates
      .map((id) => `${partyLabel(id, parties, partyNames)} ${result.marginal[id].toFixed(2)}%`)
      .join(", ");
    const electoral = candidates
      .map((id) => `${partyLabel(id, parties, partyNames)} ${result.electoral[id] ?? 0}`)
      .join(", ");
    const flips = Object.keys(result.unitWinners).filter(
      (unitId) => result.unitWinners[unitId] !== legacy.unitWinners[unitId]
    ).length;
    console.log(
      `| ${result.label} | ${national} | ${marginal} | ${electoral} | ${flips} | ${result.competitiveUnits} |`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
