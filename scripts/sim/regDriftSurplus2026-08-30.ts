/**
 * Registration drift: does Reg move again once drift can source from
 * over-registered parties?
 *
 * The balance report for `sourceFromSurplus` in `regDriftDecay.ts`. Two arms on
 * the same live state rows:
 *
 *   BEFORE  measured from the live `orgRegLedger` (the code that has been
 *           running): net Reg movement per (state, party) over the last 240
 *           turns. Every US pool has been empty since turn ~140 and the
 *           ticket-1133 cap scaled drift to zero, so this arm is decay only.
 *   AFTER   `planStateRegDriftDecay` replayed for 654 turns (~27 days) from
 *           the live snapshot of every state that has a registration pool,
 *           with the current governor's home-field applied.
 *
 * Reported per country: how many states move at all, the largest incumbent
 * fall, turns for the biggest challenged stronghold to reach "Lean" (<60),
 * and the invariants (pool sum 100, no negative bucket, no party sourced
 * below its own Org). Read-only against MONGODB_URI_LIVE.
 *
 *   npx tsx scripts/sim/regDriftSurplus2026-08-30.ts
 *   SIM_TURNS=200 SIM_COUNTRIES=US,UK npx tsx scripts/sim/regDriftSurplus2026-08-30.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { ElectedOfficial, StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { planStateRegDriftDecay } from "@/lib/turn/partyOrg/regDriftDecay";
import {
  regionalExecutiveFromOfficial,
  resolveExecutiveOffice,
} from "@/lib/states/regionalExecutive";
import { STRONGHOLD_FALL_TIME_TURNS_TARGET } from "@/lib/turn/partyOrg/pacingConstants";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const TURNS = Number(process.env.SIM_TURNS ?? 654);
const COUNTRIES = (process.env.SIM_COUNTRIES ?? "US,UK,DE,JP,IE,CN,BR,DD").split(",");
/** "Lean" per the pacing constant's own framing: a stronghold has fallen when its Reg drops under this. */
const LEAN_REG = 60;
const f = (n: number, d = 2) => n.toFixed(d);

interface StateSnapshot {
  countryId: CountryId;
  stateId: string;
  parties: StatePartyOrg[];
  pool: StateRegistrationPool;
  governor: { partyId: string; sign: 1 | 2 | 3 } | null;
}

interface StateResult {
  stateId: string;
  moved: boolean;
  /** Largest single-party Reg drop over the run (pp). */
  biggestFall: number;
  fallParty: string;
  /** Largest single-party Reg climb over the run (pp). */
  biggestClimb: number;
  climbParty: string;
  /** Turn at which the biggest faller crossed LEAN_REG, if it started above it. */
  leanTurn: number | null;
  maxPerTurn: number;
  invariantBroken: string | null;
}

function replay(snap: StateSnapshot, turns: number): StateResult {
  let parties = snap.parties.map((p) => ({ ...p }));
  let pool = { ...snap.pool };
  const start = new Map(parties.map((p) => [p.partyId, p.registration ?? 0]));
  const orgOf = new Map(parties.map((p) => [p.partyId, p.organization ?? 0]));
  let leanTurn: number | null = null;
  let maxPerTurn = 0;
  let invariantBroken: string | null = null;
  let fallParty = "";
  let climbParty = "";

  for (let turn = 1; turn <= turns; turn++) {
    const planned = planStateRegDriftDecay({
      countryId: snap.countryId,
      stateId: snap.stateId,
      parties,
      pool,
      turn,
      now: new Date(),
      governor: snap.governor,
    });
    if (!planned) break;
    const next = parties.map((p) => ({ ...p }));
    for (const u of planned.partyUpdates) {
      const row = next.find((p) => p._id === u.rowId);
      if (!row) continue;
      maxPerTurn = Math.max(maxPerTurn, Math.abs(u.newReg - (row.registration ?? 0)));
      row.registration = u.newReg;
    }
    // Invariants checked every turn, not just at the end.
    const sourcedBelowOrg = planned.ledgerRows.find(
      (r) =>
        r.source === "drift" &&
        r.metric === "reg" &&
        r.delta < 0 &&
        r.value < (orgOf.get(r.partyId) ?? 0) - 1e-9
    );
    if (sourcedBelowOrg && !invariantBroken)
      invariantBroken = `t${turn}: ${sourcedBelowOrg.partyId} sourced below Org`;
    parties = next;
    pool = {
      ...pool,
      independent: planned.poolUpdate.newIndependent,
      unregistered: planned.poolUpdate.newUnregistered,
    };
    if ((pool.independent < -1e-9 || pool.unregistered < -1e-9) && !invariantBroken)
      invariantBroken = `t${turn}: negative pool bucket`;
    const total =
      parties.reduce((s, p) => s + (p.registration ?? 0), 0) + pool.independent + pool.unregistered;
    // Some seeds do not total 100 to begin with; the invariant is conservation.
    const startTotal =
      [...start.values()].reduce((s, v) => s + v, 0) +
      snap.pool.independent +
      snap.pool.unregistered;
    if (Math.abs(total - startTotal) > 1e-6 && !invariantBroken)
      invariantBroken = `t${turn}: pool sum drifted ${f(startTotal, 3)} -> ${f(total, 3)}`;

    if (leanTurn === null) {
      for (const p of parties) {
        const s = start.get(p.partyId) ?? 0;
        if (s >= LEAN_REG && (p.registration ?? 0) < LEAN_REG) leanTurn = turn;
      }
    }
  }

  let biggestFall = 0;
  let biggestClimb = 0;
  for (const p of parties) {
    const d = (p.registration ?? 0) - (start.get(p.partyId) ?? 0);
    if (-d > biggestFall) {
      biggestFall = -d;
      fallParty = p.partyId;
    }
    if (d > biggestClimb) {
      biggestClimb = d;
      climbParty = p.partyId;
    }
  }
  return {
    stateId: snap.stateId,
    moved: Math.max(biggestFall, biggestClimb) > 0.5,
    biggestFall,
    fallParty,
    biggestClimb,
    climbParty,
    leanTurn,
    maxPerTurn,
    invariantBroken,
  };
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const gs = await db
      .collection<{ _id: string; currentTurn: number }>("gameState")
      .findOne({ _id: "current" });
    const turn = gs?.currentTurn ?? 0;
    // Same tenure→band math the turn phase uses, so governor home-field in the
    // replay matches what production would apply this turn.
    const turnLengthMinutes = await loadTurnLengthMinutes(db);
    console.log(`Live turn ${turn}; replaying ${TURNS} turns for ${COUNTRIES.join(", ")}`);
    console.log(
      `Design target: STRONGHOLD_FALL_TIME_TURNS_TARGET = ${STRONGHOLD_FALL_TIME_TURNS_TARGET}\n`
    );

    const pools = (await db
      .collection<StateRegistrationPool>("stateRegistrationPool")
      .find({ countryId: { $in: COUNTRIES as CountryId[] } })
      .toArray()) as StateRegistrationPool[];
    const allParties = (await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ countryId: { $in: COUNTRIES as CountryId[] } })
      .toArray()) as StatePartyOrg[];
    const abbrs = new Map<string, string>();
    for (const p of await db
      .collection<{ countryId: string; sequentialId: number; abbreviation: string }>(
        "politicalParties"
      )
      .find({ countryId: { $in: COUNTRIES } })
      .toArray()) {
      abbrs.set(`${p.countryId}:${p.sequentialId}`, p.abbreviation);
    }
    const officials = (await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: { $in: COUNTRIES as CountryId[] },
        officeType: { $in: ["governor", "ministerPresident"] },
      })
      .toArray()) as ElectedOfficial[];

    // BEFORE arm: what the live code actually did over the last 240 turns.
    const before = await db
      .collection("orgRegLedger")
      .aggregate<{ _id: { c: string; st: string; p: string }; sum: number }>([
        { $match: { countryId: { $in: COUNTRIES }, metric: "reg", turn: { $gte: turn - 240 } } },
        {
          $group: {
            _id: { c: "$countryId", st: "$stateId", p: "$partyId" },
            sum: { $sum: "$delta" },
          },
        },
      ])
      .toArray();

    for (const countryId of COUNTRIES) {
      const cPools = pools.filter((p) => p.countryId === countryId);
      if (cPools.length === 0) {
        console.log(`=== ${countryId}: no registration pools, skipped ===\n`);
        continue;
      }
      const bAbs = before
        .filter((b) => b._id.c === countryId)
        .map((b) => Math.abs(b.sum))
        .sort((a, b) => a - b);
      const bMax = bAbs.at(-1) ?? 0;
      const bMed = bAbs[Math.floor(bAbs.length / 2)] ?? 0;

      const results: StateResult[] = [];
      for (const pool of cPools) {
        const parties = allParties.filter(
          (p) => p.countryId === countryId && p.stateId === pool.stateId
        );
        const office = resolveExecutiveOffice(countryId as CountryId, pool.stateId);
        const official = office
          ? officials
              .filter(
                (o) =>
                  o.countryId === countryId &&
                  (o.state ?? "").toUpperCase() === pool.stateId.toUpperCase() &&
                  o.officeType === office.officeType
              )
              .sort(
                (a, b) =>
                  new Date(b.electedAt ?? 0).getTime() - new Date(a.electedAt ?? 0).getTime()
              )[0]
          : undefined;
        const exec = regionalExecutiveFromOfficial(
          countryId as CountryId,
          pool.stateId,
          official,
          new Date(),
          turnLengthMinutes
        );
        results.push(
          replay(
            {
              countryId: countryId as CountryId,
              stateId: pool.stateId,
              parties,
              pool,
              governor: exec ? { partyId: exec.partyId, sign: exec.sign } : null,
            },
            TURNS
          )
        );
      }

      const moved = results.filter((r) => r.moved).length;
      const broken = results.filter((r) => r.invariantBroken);
      const leans = results.filter((r) => r.leanTurn !== null);
      const name = (st: string, p: string) => `${st} ${abbrs.get(`${countryId}:${p}`) ?? p}`;
      console.log(`=== ${countryId}: ${cPools.length} states ===`);
      console.log(
        `  BEFORE (live ledger, last 240 turns): |net Reg| median ${f(bMed, 3)} pp, max ${f(bMax, 3)} pp`
      );
      console.log(
        `  AFTER  (${TURNS}-turn replay): ${moved}/${results.length} states move > 0.5 pp; ` +
          `max per-turn move ${f(Math.max(...results.map((r) => r.maxPerTurn)), 3)} pp`
      );
      console.log(
        `  strongholds (started >= ${LEAN_REG}) reaching Lean: ${leans.length}` +
          (leans.length
            ? `; turns min/median/max ${Math.min(...leans.map((r) => r.leanTurn!))}/` +
              `${leans.map((r) => r.leanTurn!).sort((a, b) => a - b)[Math.floor(leans.length / 2)]}/` +
              `${Math.max(...leans.map((r) => r.leanTurn!))}`
            : "")
      );
      console.log(
        `  invariants: ${broken.length === 0 ? "OK" : broken.map((b) => `${b.stateId} ${b.invariantBroken}`).join("; ")}`
      );
      const top = [...results].sort((a, b) => b.biggestFall - a.biggestFall).slice(0, 6);
      console.log("  biggest incumbent falls:");
      for (const r of top) {
        if (r.biggestFall <= 0) continue;
        console.log(
          `    ${name(r.stateId, r.fallParty).padEnd(12)} -${f(r.biggestFall, 1)} pp` +
            `  (climb ${name(r.stateId, r.climbParty)} +${f(r.biggestClimb, 1)})` +
            (r.leanTurn !== null ? `  Lean at t${r.leanTurn}` : "")
        );
      }
      console.log();
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
