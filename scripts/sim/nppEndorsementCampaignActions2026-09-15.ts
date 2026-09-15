/**
 * NPP endorsements and campaign-action accrual: what does restoring them cost?
 *
 * The balance report for putting `nppEndorsementCount` back into the
 * `calculateCampaignActions` argument in `campaignTurn.ts`, reversing the
 * campaign-action half of #1891 ("keep NPP endorsements informational").
 *
 *   BEFORE  player endorsements only (presidential), plus governor/executive
 *           weighted by GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS -- what the engine
 *           does today
 *   AFTER   the same, plus active+visible NPP endorsements counted 1:1
 *
 * Two arms, because the two questions are different:
 *
 *   Arm A  replays every active campaign on the live world, so the verdict is
 *          measured on the endorsement counts players actually hold rather than
 *          on a fixture chosen to make a point.
 *   Arm B  sweeps NPP count for a fixed player-endorsement base, which is the
 *          farmability question: NPP endorsements carry `arrangedBy`, so they are
 *          requested rather than organic, and the marginal yield of the next
 *          arranged endorsement is the number that decides whether restoring
 *          them re-opens the direction conflict #1891 closed.
 *
 * Accrual math is never reimplemented here -- `calculateCampaignActions` is
 * imported from the module the turn engine itself calls, so the arms cannot
 * drift from production the way the read path did.
 *
 *   npx tsx scripts/sim/nppEndorsementCampaignActions2026-09-15.ts
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { Campaign } from "@/lib/db/types/campaign";
import type { Election, NPPEndorsement } from "@/lib/db/types";
import { calculateCampaignActions } from "@/lib/campaigns/actions";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";
import { GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS } from "@/lib/constants/governorOffice";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

/** Player-endorsement bases for the Arm B sweep: none, typical, and heavy. */
const SWEEP_PLAYER_BASES = [0, 2, 9];
/** NPP counts to sweep. The live maximum today is 13. */
const SWEEP_NPP_MAX = Number(process.env.SIM_NPP_MAX ?? 20);

interface CampaignRow {
  name: string;
  electionType: string;
  countryId: string;
  isPresidential: boolean;
  candidateIsNPP: boolean;
  npp: number;
  player: number;
  governor: number;
  executive: number;
  before: number;
  after: number;
}

/**
 * The engine's endorsement argument, with NPP either excluded (today) or
 * included (the proposed change). Mirrors campaignTurn.ts exactly: player
 * endorsements are gated to presidential races, governor endorsements are
 * excluded from presidential (they land as an in-state vote multiplier
 * instead), and executive endorsements always apply.
 */
function endorsementArgument(
  row: Pick<CampaignRow, "isPresidential" | "npp" | "player" | "governor" | "executive">,
  countNpp: boolean
): number {
  const player = row.isPresidential ? row.player : 0;
  const governor = row.isPresidential ? 0 : row.governor;
  const weighted = (governor + row.executive) * GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS;
  return (countNpp ? row.npp : 0) + player + weighted;
}

async function loadRows(db: Db, baseline: number, nppBaseline: number): Promise<CampaignRow[]> {
  const campaigns = await db
    .collection<Campaign>("campaigns")
    .find({ status: { $ne: "archived" }, archivedAt: null })
    .toArray();

  const electionIds = campaigns.map((c) => c.electionId);
  const elections = new Map(
    (
      await db
        .collection<Election>("elections")
        .find({ _id: { $in: electionIds } })
        .project<{ _id: ObjectId; electionType: string; countryId: string }>({
          electionType: 1,
          countryId: 1,
        })
        .toArray()
    ).map((e) => [e._id.toString(), e])
  );

  const rows: CampaignRow[] = [];
  for (const campaign of campaigns) {
    const election = elections.get(campaign.electionId.toString());
    const isPresidential = election?.electionType === "president";

    // The engine counts only active AND visible NPP endorsements: legacy
    // `source: "organic"` rows are hidden, and counting them here would
    // overstate the change.
    const npp = await db.collection<NPPEndorsement>("nppEndorsements").countDocuments(
      buildActiveVisibleNppEndorsementFilter({
        electionId: campaign.electionId,
        candidateId: campaign.candidateId,
      })
    );

    // playerEndorsements.candidateId is the electionCandidates row _id, not the
    // character identity id (ticket #868), so resolve the row before joining.
    const candidateRows = await db
      .collection("electionCandidates")
      .find({ electionId: campaign.electionId, characterId: campaign.candidateId })
      .project<{ _id: ObjectId; status?: string; characterName?: string }>({
        status: 1,
        characterName: 1,
      })
      .toArray();
    const candidateRow =
      candidateRows.find((r) => r.status === "active") ?? candidateRows[0] ?? null;
    const player = candidateRow
      ? await db.collection("playerEndorsements").countDocuments({
          electionId: campaign.electionId,
          candidateId: candidateRow._id,
          isActive: true,
        })
      : 0;

    const [governor, executive] = await Promise.all([
      db.collection("governorEndorsements").countDocuments({
        electionId: campaign.electionId,
        candidateId: campaign.candidateId,
        isActive: true,
      }),
      db.collection("executiveEndorsements").countDocuments({
        electionId: campaign.electionId,
        candidateId: campaign.candidateId,
        isActive: true,
      }),
    ]);

    const partial = {
      isPresidential,
      npp,
      player,
      governor,
      executive,
    };
    const effectiveBaseline = campaign.candidateIsNPP ? nppBaseline : baseline;
    rows.push({
      name: candidateRow?.characterName ?? campaign.candidateId.toString(),
      electionType: election?.electionType ?? "unknown",
      countryId: election?.countryId ?? "??",
      candidateIsNPP: campaign.candidateIsNPP === true,
      ...partial,
      before: calculateCampaignActions(endorsementArgument(partial, false), effectiveBaseline),
      after: calculateCampaignActions(endorsementArgument(partial, true), effectiveBaseline),
    });
  }
  return rows;
}

function armA(rows: CampaignRow[]): void {
  console.log("\n=== Arm A: live campaigns, actions per turn ===\n");
  const changed = rows.filter((r) => r.after !== r.before);

  console.log(
    `${"candidate".padEnd(24)}${"race".padEnd(12)}${"NPP".padStart(4)}${"PLR".padStart(5)}` +
      `${"before".padStart(8)}${"after".padStart(7)}${"delta".padStart(7)}${"change".padStart(9)}`
  );
  for (const r of [...changed].sort((a, b) => b.after - b.before - (a.after - a.before))) {
    const delta = r.after - r.before;
    const pctChange = r.before > 0 ? ((delta / r.before) * 100).toFixed(0) + "%" : "n/a";
    console.log(
      `${r.name.slice(0, 23).padEnd(24)}${r.electionType.padEnd(12)}` +
        `${String(r.npp).padStart(4)}${String(r.player).padStart(5)}` +
        `${String(r.before).padStart(8)}${String(r.after).padStart(7)}` +
        `${("+" + delta).padStart(7)}${pctChange.padStart(9)}`
    );
  }

  const totalBefore = rows.reduce((s, r) => s + r.before, 0);
  const totalAfter = rows.reduce((s, r) => s + r.after, 0);
  console.log(
    `\n${rows.length} active campaigns, ${changed.length} affected ` +
      `(${((changed.length / Math.max(1, rows.length)) * 100).toFixed(0)}% of the field).`
  );
  console.log(
    `Field-wide accrual ${totalBefore} -> ${totalAfter} actions/turn ` +
      `(+${totalAfter - totalBefore}, ` +
      `+${(((totalAfter - totalBefore) / Math.max(1, totalBefore)) * 100).toFixed(1)}%).`
  );
  if (changed.length > 0) {
    const worst = changed.reduce((m, r) => (r.after - r.before > m.after - m.before ? r : m));
    console.log(
      `Largest single gain: ${worst.name} at ${worst.npp} NPP endorsements, ` +
        `${worst.before} -> ${worst.after} per turn.`
    );
  }
}

function armB(baseline: number): void {
  console.log("\n=== Arm B: farmability sweep (presidential) ===\n");
  console.log("Actions per turn as arranged NPP endorsements accumulate.");
  console.log("`marginal` is the gain from the NEXT arranged endorsement.\n");

  for (const base of SWEEP_PLAYER_BASES) {
    console.log(`-- player endorsements: ${base} --`);
    console.log(
      `${"NPP".padStart(5)}${"actions".padStart(9)}${"vs 0 NPP".padStart(10)}${"marginal".padStart(10)}`
    );
    let previous = 0;
    for (let npp = 0; npp <= SWEEP_NPP_MAX; npp++) {
      const actions = calculateCampaignActions(npp + base, baseline);
      if (npp === 0) previous = actions;
      const zero = calculateCampaignActions(base, baseline);
      const marginal = calculateCampaignActions(npp + 1 + base, baseline) - actions;
      // Only print rows where something changes, plus the endpoints: the sqrt
      // curve is flat over long stretches and printing every step buries it.
      if (npp === 0 || npp === SWEEP_NPP_MAX || actions !== previous || marginal > 0) {
        console.log(
          `${String(npp).padStart(5)}${String(actions).padStart(9)}` +
            `${("+" + (actions - zero)).padStart(10)}${("+" + marginal).padStart(10)}`
        );
      }
      previous = actions;
    }
    console.log("");
  }
  console.log(
    "Diminishing returns are structural: accrual is baseline + floor(sqrt(n) * 3), so the\n" +
      "n-th arranged endorsement yields less than the one before it. The curve, not a cap,\n" +
      "is what bounds farming."
  );
}

async function main(): Promise<void> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  try {
    // Baseline mirrors the turn engine: max(baseActionsPerTurn, 4) for players,
    // half that (floor, min 1) for NPP-run campaigns.
    const gameConfig = await db
      .collection<{ _id: string; baseActionsPerTurn?: number }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { baseActionsPerTurn: 1 } });
    const baseline = Math.max(gameConfig?.baseActionsPerTurn ?? 4, 4);
    const nppBaseline = Math.max(1, Math.floor(baseline / 2));
    console.log(`baseActionsPerTurn baseline: ${baseline} (NPP-run campaigns: ${nppBaseline})`);

    const rows = await loadRows(db, baseline, nppBaseline);
    armA(rows);
    armB(baseline);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
