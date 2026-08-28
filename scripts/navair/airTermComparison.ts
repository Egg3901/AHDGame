/**
 * Air-term comparison: what replacing `airShare` does to a live war.
 *
 * The replay gate the design called for cannot be built. `battleReports` stores
 * OUTCOMES (unitResults, casualties, post-battle readiness) and not the pre-battle
 * inputs, so there is nothing to re-resolve historically. This is the forward
 * substitute: for each active conflict it computes the OLD air term and the NEW one
 * from the CURRENT rosters, and reports the difference.
 *
 * What it answers: "if the next battle in this war were fought today, how differently
 * would the air term land?" That is the question that matters before shipping onto a
 * war already in progress. It does NOT answer "would past battles have gone the other
 * way", and nothing can.
 *
 * Weighting caveat, stated plainly: the real battle path weights each unit by a cv that
 * also folds terrain, naval reach, role engagement share and national doctrine, none of
 * which are reconstructible outside a full BattleContext. This uses
 * `computeEffectivePower` as the weight instead. Absolute numbers here are therefore a
 * proxy; the OLD vs NEW comparison is still meaningful because both sides of the
 * comparison use the identical weighting, so the difference isolates the formula change.
 *
 * Usage:
 *   MONGODB_URI=... npx tsx scripts/navair/airTermComparison.ts --db=ahd
 *
 * Read-only. It opens no write handle and issues no update.
 */

export {};

import { MongoClient } from "mongodb";
import { computeEffectivePower } from "@/lib/constants/military";
import { sideChannel } from "@/lib/navair/channels";
import type { RegionChannels } from "@/lib/navair/types";
import type { RegionCode } from "@/lib/military/types";

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  return process.argv.find((v) => v.startsWith(prefix))?.slice(prefix.length);
}

/** The clamp the battle math applies to every side multiplier. */
const cl = (x: number): number => Math.max(-0.5, Math.min(0.5, x));

/** Coefficient and spread, unchanged between the two formulas by design. */
const AIRM_K = 0.24;
const AIRM_SPREAD = 120;

interface UnitRow {
  countryId: string;
  domain: string;
  basePower: number;
  posture: string;
  techTier: number;
  vet: number;
  equipment: { firepower: number; protection: number; support: number };
  personnel?: number;
  type?: string;
  theaterId?: string;
}

/**
 * The OLD air term, reconstructed.
 *
 * `airShare` is a side's own air-and-naval mass as a fraction of its own total mass,
 * compared against the ENEMY'S anti-air stat. It never looked at the enemy's aircraft, so
 * it was not a contest: it measured what a side brought, and it rose when that side's
 * ground forces died.
 */
function oldAirTerm(own: UnitRow[], enemyAntiAir: number): { share: number; airm: number } {
  let mass = 0;
  let air = 0;
  for (const u of own) {
    const w = computeEffectivePower(u as never);
    mass += w;
    if (u.domain === "air" || u.domain === "naval") air += w;
  }
  const share = air / Math.max(1, mass);
  return { share, airm: 1 + AIRM_K * cl((share * 100 - enemyAntiAir) / AIRM_SPREAD) };
}

/** The NEW air term: head to head air superiority from the navair channels. */
function newAirTerm(ownSuperiority: number, enemySuperiority: number): number {
  return 1 + AIRM_K * cl((ownSuperiority - enemySuperiority) / AIRM_SPREAD);
}

/**
 * Mass-weighted anti-air stat, the enemy figure the old formula compared against.
 *
 * Approximated from unit type, because the per-unit stat block is derived inside the
 * battle path. Air-defence formations carry the overwhelming share of it, which is the
 * property that matters for the comparison.
 */
function antiAirOf(units: UnitRow[]): number {
  let mass = 0;
  let aa = 0;
  for (const u of units) {
    const w = computeEffectivePower(u as never);
    mass += w;
    const type = u.type ?? "";
    const stat = /Air Defense/.test(type) ? 95 : u.domain === "air" ? 70 : 25;
    aa += stat * w;
  }
  return aa / Math.max(1, mass);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  const dbName = arg("db") ?? "ahd";

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);

    const conflicts = await db.collection("conflicts").find({ status: "active" }).toArray();

    if (!conflicts.length) {
      console.log("No active conflicts. Nothing to compare.");
      return;
    }

    const channelDocs = await db.collection("navairChannels").find({}).toArray();
    const channels = new Map<string, RegionChannels>(
      channelDocs.map((d) => [
        `${d.countryId}:${d.region}`,
        {
          airSuperiority: d.airSuperiority,
          seaControl: d.seaControl,
          detection: d.detection,
          updatedTurn: d.updatedTurn,
        },
      ])
    );

    console.log("# Air term comparison: old airShare vs new air superiority\n");
    if (!channelDocs.length) {
      console.log(
        "> WARNING: navairChannels is EMPTY. The navairOperations phase has not run yet,\n" +
          "> so every new-model figure below is zero and both sides read as parity. Run at\n" +
          "> least one turn before treating this report as evidence.\n"
      );
    }

    for (const c of conflicts) {
      const sideA = (c.sideA?.countries ?? []) as string[];
      const sideB = (c.sideB?.countries ?? []) as string[];
      const region = c.region as RegionCode;

      const units = (await db
        .collection("militaryUnits")
        .find({ countryId: { $in: [...sideA, ...sideB] }, theaterId: c._id })
        .toArray()) as unknown as UnitRow[];

      const aUnits = units.filter((u) => sideA.includes(u.countryId));
      const bUnits = units.filter((u) => sideB.includes(u.countryId));

      const oldA = oldAirTerm(aUnits, antiAirOf(bUnits));
      const oldB = oldAirTerm(bUnits, antiAirOf(aUnits));

      const supA = sideChannel(channels, sideA, region, "airSuperiority");
      const supB = sideChannel(channels, sideB, region, "airSuperiority");
      const newA = newAirTerm(supA, supB);
      const newB = newAirTerm(supB, supA);

      const swing = (n: number, o: number) => {
        const d = n - o;
        return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)} pts`;
      };

      console.log(`## ${c.name ?? c._id}  (region ${region}, control ${c.control?.toFixed?.(2)})`);
      console.log(`  Side A: ${sideA.join(", ")}   Side B: ${sideB.join(", ")}`);
      console.log(`  Formations at front: A ${aUnits.length}, B ${bUnits.length}`);
      console.log("");
      console.log(
        `  OLD  A airShare ${(oldA.share * 100).toFixed(1)}%  ->  airm ${oldA.airm.toFixed(4)}`
      );
      console.log(
        `  OLD  B airShare ${(oldB.share * 100).toFixed(1)}%  ->  airm ${oldB.airm.toFixed(4)}`
      );
      console.log(`  NEW  A superiority ${supA.toFixed(1)}  ->  airm ${newA.toFixed(4)}`);
      console.log(`  NEW  B superiority ${supB.toFixed(1)}  ->  airm ${newB.toFixed(4)}`);
      console.log("");
      console.log(`  SWING  A ${swing(newA, oldA.airm)}   B ${swing(newB, oldB.airm)}`);

      // The number that decides whether this is safe to ship onto a live war: how much
      // the RELATIVE advantage moves. A change that shifts both sides equally changes
      // nothing about who wins.
      const oldEdge = oldA.airm / oldB.airm;
      const newEdge = newA / newB;
      const edgeShift = ((newEdge - oldEdge) / oldEdge) * 100;
      console.log(
        `  RELATIVE EDGE  old ${oldEdge.toFixed(4)}  new ${newEdge.toFixed(4)}  ` +
          `shift ${edgeShift >= 0 ? "+" : ""}${edgeShift.toFixed(2)}% toward ${edgeShift >= 0 ? "A" : "B"}\n`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
