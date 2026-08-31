/**
 * Read-only live-data report for ticket #1233.
 *
 * The war-stage foreign-policy actions (`conduct_war`, `seek_peace`) were based
 * at 25 and 38 while routine diplomacy scores in the 46-73 band and only the
 * single top-ranked choice acts, so an autonomous belligerent could never win a
 * slot for its own war. This report shows the live evidence (selection counts,
 * the alternatives each belligerent actually faced) and replays both score
 * bases against those alternatives to project the fix's effect.
 *
 *   MONGODB_URI_LIVE=... npx tsx scripts/sim/nppWarActionPriority2026-08-30.ts
 */
import { MongoClient, ObjectId, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { NPP } from "@/lib/db/types/npp";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

dotenv.config({
  path: [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../../.env.local"),
  ],
});
const configuredUri = process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI;
if (!configuredUri) throw new Error("MONGODB_URI_LIVE or MONGODB_URI is required");
const uri = /directConnection=/.test(configuredUri)
  ? configuredUri
  : `${configuredUri}${configuredUri.includes("?") ? "&" : "?"}directConnection=true`;

interface DecisionRow {
  countryId: CountryId;
  turn: number;
  headNppId: ObjectId;
  selected: { type: string; score: number } | null;
  alternatives: Array<{ type: string; score: number }>;
}

const OLD_CONDUCT_BASE = 25;
const NEW_CONDUCT_BASE = 60;
const CONDUCT_COOLDOWN_TURNS = 6;

function conductScore(base: number, ambition: number, defenseLean: number, readiness: number) {
  return base + ambition * 8 + defenseLean * 10 + (readiness - 40) * 0.2;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as Db;
    const gameState = await db
      .collection<{
        _id: string;
        currentTurn?: number;
        nppForeignPolicyMode?: string;
        nppForeignPolicyStage?: string;
      }>("gameState")
      .findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;
    console.log(`# NPP war-action priority report, turn ${currentTurn}`);
    console.log(
      `Foreign policy: mode ${gameState?.nppForeignPolicyMode ?? "active"}, stage ${gameState?.nppForeignPolicyStage ?? "votes"}\n`
    );

    const decisions = (await db
      .collection<DecisionRow>("nppForeignPolicyDecisions")
      .find({})
      .sort({ turn: -1 })
      .toArray()) as DecisionRow[];
    const total = decisions.length;
    const conductSelected = decisions.filter((d) => d.selected?.type === "conduct_war").length;
    const peaceSelected = decisions.filter((d) => d.selected?.type === "seek_peace").length;
    const conductVisible = decisions.filter((d) =>
      d.alternatives.some((a) => a.type === "conduct_war")
    ).length;
    const byType = new Map<string, number>();
    for (const d of decisions) {
      const type = d.selected?.type ?? "none";
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
    console.log("## Historical evidence");
    console.log(
      `\n${total} recorded autonomous decisions: conduct_war selected ${conductSelected} times, seek_peace ${peaceSelected} times; conduct_war reached the top-5 alternatives ${conductVisible} times.`
    );
    console.log(
      `Selected-action distribution: ${[...byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `${type} ${n}`)
        .join(", ")}\n`
    );

    const conflicts = (await db
      .collection<ConflictDoc>("conflicts")
      .find({ status: { $in: ["active", "escalating", "winding_down"] } })
      .toArray()) as ConflictDoc[];
    const autonomous = new Set(decisions.map((d) => d.countryId));
    const latestByCountry = new Map<CountryId, DecisionRow>();
    for (const d of decisions) {
      if (!latestByCountry.has(d.countryId)) latestByCountry.set(d.countryId, d);
    }

    console.log("## Belligerent replay, old base vs new base");
    for (const conflict of conflicts) {
      console.log(`\n### ${conflict.name} (${conflict._id})`);
      console.log(
        "\n| Country | Deployed | Readiness | Approval | Old | New | Best routine alternative | Verdict |"
      );
      console.log("| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
      const belligerents = [
        ...new Set([...(conflict.sideA.countries ?? []), ...(conflict.sideB.countries ?? [])]),
      ] as CountryId[];
      for (const countryId of belligerents) {
        if (!autonomous.has(countryId)) continue;
        const latest = latestByCountry.get(countryId);
        if (!latest) continue;
        const [head, approval, units] = await Promise.all([
          db.collection<NPP>("npps").findOne({ _id: latest.headNppId }),
          db.collection<GovernmentApproval>("governmentApprovals").findOne({ _id: countryId }),
          db
            .collection<MilitaryUnit>("militaryUnits")
            .find({ countryId, theaterId: conflict._id, personnel: { $gt: 0 } })
            .toArray(),
        ]);
        const readiness =
          units.length > 0
            ? units.reduce((sum, unit) => sum + unit.readiness, 0) / units.length
            : 0;
        const approvalRating = approval?.approvalRating ?? 0;
        const ambition = Math.min(1, Math.max(0, (head?.personality.ambition ?? 50) / 100));
        const defenseLean = ((head?.policies.domainPositions?.defense ?? 0) + 100) / 200;
        const gatesPass = units.length > 0 && readiness >= 40 && approvalRating >= 40;
        const oldScore = conductScore(OLD_CONDUCT_BASE, ambition, defenseLean, readiness);
        const newScore = conductScore(NEW_CONDUCT_BASE, ambition, defenseLean, readiness);
        const routine = (latest.alternatives ?? [])
          .filter((a) => a.type !== "conduct_war" && a.type !== "seek_peace")
          .sort((a, b) => b.score - a.score)[0];
        const verdict = !gatesPass
          ? "gated (units/readiness/approval)"
          : routine === undefined
            ? "no routine alternative recorded"
            : oldScore > routine.score
              ? "already won (unexpected)"
              : newScore > routine.score
                ? `flips to conduct_war (+${(newScore - routine.score).toFixed(1)})`
                : `still loses to ${routine.type}`;
        console.log(
          `| ${countryId} | ${units.length} | ${readiness.toFixed(0)} | ${approvalRating.toFixed(0)} | ${gatesPass ? oldScore.toFixed(1) : "n/a"} | ${gatesPass ? newScore.toFixed(1) : "n/a"} | ${routine ? `${routine.type} ${routine.score}` : "none"} | ${verdict} |`
        );
      }
    }

    console.log("\n## Tempo projection");
    console.log(
      `\nA belligerent that clears the gates now spends its slot on conduct_war whenever no extreme-score vote (46 + min(35, |support| * 0.4) can reach 81-86) is pending. The ${CONDUCT_COOLDOWN_TURNS}-turn conduct cooldown paces this to roughly one autonomous offensive per ${CONDUCT_COOLDOWN_TURNS + 1} turns per belligerent, so a six-member bloc field on one front projects several ally offensives per month of turns instead of the zero observed.`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
