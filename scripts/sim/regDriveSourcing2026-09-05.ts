/**
 * Registration Drive sourcing + decay pool lapse: the balance report.
 *
 * Two changes ship together and both move Reg, so they are measured together
 * off a live US snapshot, replayed with the real planners rather than a
 * reimplementation:
 *
 *   BEFORE  drive draws from the non-party pool only; decay redistributes
 *           100% of each turn's lapsed Reg to parties with Org >= 10, and
 *           reaches the pool only when NO party is eligible
 *   AFTER   drive draws pool first then sources the shortfall from parties
 *           holding Reg above their own Org target; decay lapses
 *           REG_DECAY_LAPSE_TO_POOL_SHARE (0.5) to the pool every turn
 *
 * Why it matters. Every US `stateRegistrationPool` row has read
 * `independent = unregistered = 0` since live turn ~155 (RU ~176, UK ~143),
 * because drift drew the pool down one-directionally while decay could never
 * refill it. The drive is pool-only, so it applied literally nothing for 450+
 * turns while all six US parties funded it at 25% of revenue. This is the same
 * failure that froze passive drift until `sourceFromSurplus` shipped
 * (2026-08-30); the drive never got the equivalent.
 *
 * Arms are run per state with Org held FIXED, which is what makes
 * "turns to reach the Org target" a meaningful measure. Real worlds move Org
 * too, so treat the turn counts as a floor, not a forecast.
 *
 *   npx tsx scripts/sim/regDriveSourcing2026-09-05.ts
 *   SIM_DRIVE_PP=0.02 npx tsx scripts/sim/regDriveSourcing2026-09-05.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import { computeDecayDeltas, planStateRegDriftDecay } from "@/lib/turn/partyOrg/regDriftDecay";
import {
  planRegistrationDriveSourcing,
  REG_DRIVE_MAX_BOOST_PER_STATE,
} from "@/lib/turn/partyOrg/registrationDrive";
import type { StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";

dotenv.config({ path: ".env.local" });

const GOP = "6";
const TURNS_PER_YEAR = 48;
const HORIZON = 4000;
/** Per-state drive boost, in pp/turn. Default: the engine cap. */
const DRIVE_PP = Number(process.env.SIM_DRIVE_PP ?? REG_DRIVE_MAX_BOOST_PER_STATE);

interface Snapshot {
  turn: number;
  orgs: StatePartyOrg[];
  pools: StateRegistrationPool[];
  bias: number;
  govByState: Map<string, string>;
}

async function load(): Promise<Snapshot> {
  const raw = process.env.MONGODB_URI_LIVE;
  if (!raw) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(raw + (raw.includes("?") ? "&" : "?") + "directConnection=true", {
    serverSelectionTimeoutMS: 20000,
  });
  await client.connect();
  try {
    const db = client.db();
    const gs = await db.collection("gameState").findOne({ _id: "current" as never });
    const orgs = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ countryId: "US" })
      .toArray();
    const pools = await db
      .collection<StateRegistrationPool>("stateRegistrationPool")
      .find({ countryId: "US" })
      .toArray();
    const govs = await db
      .collection("electedOfficials")
      .find({ countryId: "US", officeType: "governor" })
      .project({ state: 1, party: 1 })
      .toArray();
    const govByState = new Map<string, string>();
    for (const g of govs)
      if (g.party) govByState.set(String(g.state).toUpperCase(), String(g.party));
    const biasMap = (gs as { registrationAccessBiasByCountry?: Record<string, number> } | null)
      ?.registrationAccessBiasByCountry;
    return {
      turn: (gs as { currentTurn?: number } | null)?.currentTurn ?? 0,
      orgs,
      pools,
      bias: biasMap?.US ?? 0,
      govByState,
    };
  } finally {
    await client.close();
  }
}

type Arm = "before" | "after";

/**
 * Replay one state forward. `lapseShare` selects the decay arm; `drivePp`
 * selects whether a funded drive runs, and `arm` whether it may reach surplus.
 */
function replay(
  snap: Snapshot,
  stateId: string,
  arm: Arm,
  drivePp: number,
  lapseShare: number
): { turns: number | null; finalReg: number; target: number } {
  const parties = snap.orgs.filter((o) => o.stateId === stateId).map((o) => ({ ...o }));
  const poolRow = snap.pools.find((p) => p.stateId === stateId);
  if (!poolRow) return { turns: null, finalReg: 0, target: 0 };
  const pool = { ...poolRow };
  const buyer = parties.find((p) => String(p.partyId) === GOP);
  if (!buyer) return { turns: null, finalReg: 0, target: 0 };
  const target = Math.max(0, buyer.organization ?? 0);
  const govParty = snap.govByState.get(stateId.toUpperCase());

  for (let t = 1; t <= HORIZON; t++) {
    // --- Registration drive (runs before drift/decay, as the phases order it)
    if (drivePp > 0) {
      const views = parties.map((r) => ({
        rowId: String(r._id),
        partyId: String(r.partyId),
        orgPct: r.organization ?? 0,
        regPct: r.registration ?? 0,
      }));
      if (arm === "after") {
        const s = planRegistrationDriveSourcing(
          drivePp,
          pool.unregistered,
          pool.independent,
          views,
          GOP
        );
        if (s.applied > 0) {
          buyer.registration = (buyer.registration ?? 0) + s.applied;
          pool.unregistered -= s.pool.fromUnregistered;
          pool.independent -= s.pool.fromIndependent;
          for (const d of s.surplus) {
            const row = parties.find((p) => String(p._id) === d.rowId);
            if (row) row.registration = (row.registration ?? 0) + d.delta;
          }
        }
      } else {
        // BEFORE: pool-only. With an empty pool this applies nothing at all.
        const capacity = Math.max(0, pool.unregistered) + Math.max(0, pool.independent);
        const applied = Math.max(0, Math.min(drivePp, capacity));
        if (applied > 0) {
          buyer.registration = (buyer.registration ?? 0) + applied;
          const fromUnreg = Math.min(applied, Math.max(0, pool.unregistered));
          pool.unregistered -= fromUnreg;
          pool.independent -= applied - fromUnreg;
        }
      }
    }

    // --- Passive drift + decay (unchanged between arms except the lapse share)
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId,
      parties: parties as StatePartyOrg[],
      pool: pool as StateRegistrationPool,
      turn: snap.turn + t,
      now: new Date(),
      governor: govParty ? { partyId: govParty, sign: 1 } : null,
      registrationAccessBias: snap.bias,
      // BEFORE replays the world where decay never reached the pool while any
      // party was eligible to catch it — otherwise the pool-only drive would
      // feed on a trickle the old world never produced and the arms would not
      // be comparable.
      decayLapseToPoolShare: lapseShare,
    });
    if (planned) {
      for (const u of planned.partyUpdates) {
        const row = parties.find((p) => String(p._id) === String(u.rowId));
        if (row) row.registration = u.newReg;
      }
      pool.independent = planned.poolUpdate.newIndependent;
      pool.unregistered = planned.poolUpdate.newUnregistered;
    }

    if ((buyer.registration ?? 0) >= target - 0.01) {
      return { turns: t, finalReg: buyer.registration ?? 0, target };
    }
  }
  return { turns: null, finalReg: buyer.registration ?? 0, target };
}

/**
 * Worst-case party Reg erosion per country from the decay lapse alone (no
 * drive), replaying each state with the lapse off and on. The lapse is a global
 * constant, so a US-only report would understate the change's blast radius.
 */
async function reportCrossCountryLapse(): Promise<void> {
  const raw = process.env.MONGODB_URI_LIVE;
  if (!raw) return;
  const client = new MongoClient(raw + (raw.includes("?") ? "&" : "?") + "directConnection=true", {
    serverSelectionTimeoutMS: 20000,
  });
  await client.connect();
  try {
    const db = client.db();
    const pools = await db
      .collection<StateRegistrationPool>("stateRegistrationPool")
      .find({})
      .toArray();
    const orgs = await db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray();
    const gs = await db.collection("gameState").findOne({ _id: "current" as never });
    const biasBy =
      (gs as { registrationAccessBiasByCountry?: Record<string, number> } | null)
        ?.registrationAccessBiasByCountry ?? {};

    const byCountry = new Map<string, StateRegistrationPool[]>();
    for (const p of pools) {
      const list = byCountry.get(p.countryId) ?? [];
      list.push(p);
      byCountry.set(p.countryId, list);
    }

    console.log("\nDecay lapse is global — worst party Reg erosion per country over 2000 turns:");
    console.log("CC   states   worst drop   where");
    for (const [cc, cPools] of [...byCountry].sort()) {
      let worstDrop = 0;
      let worstLabel = "";
      for (const poolRow of cPools) {
        const base = orgs.filter((o) => o.countryId === cc && o.stateId === poolRow.stateId);
        if (base.length === 0) continue;
        const run = (lapse: number) => {
          const parties = base.map((p) => ({ ...p }));
          const pool = { ...poolRow };
          for (let t = 1; t <= 2000; t++) {
            const planned = planStateRegDriftDecay({
              countryId: cc as never,
              stateId: poolRow.stateId,
              parties,
              pool,
              turn: t,
              now: new Date(),
              registrationAccessBias: biasBy[cc.toUpperCase()] ?? 0,
              decayLapseToPoolShare: lapse,
            });
            if (!planned) break;
            for (const u of planned.partyUpdates) {
              const r = parties.find((p) => p._id === u.rowId);
              if (r) r.registration = u.newReg;
            }
            pool.independent = planned.poolUpdate.newIndependent;
            pool.unregistered = planned.poolUpdate.newUnregistered;
          }
          return parties;
        };
        const a = run(0);
        const b = run(0.5);
        for (const p of base) {
          const ra = a.find((x) => x._id === p._id)?.registration ?? 0;
          const rb = b.find((x) => x._id === p._id)?.registration ?? 0;
          if (ra - rb > worstDrop) {
            worstDrop = ra - rb;
            worstLabel = `${poolRow.stateId}/p${p.partyId} ${ra.toFixed(1)} -> ${rb.toFixed(1)}`;
          }
        }
      }
      console.log(
        `${cc.padEnd(4)} ${String(cPools.length).padStart(6)}   ${worstDrop.toFixed(2).padStart(6)} pp   ${worstLabel}`
      );
    }
    console.log(
      "A sole dominant party is its own only eligible catcher, so one-party worlds " +
        "(CN) are untouched; erosion needs a second organised party to redistribute to."
    );
  } finally {
    await client.close();
  }
}

function fmt(t: number | null): string {
  if (t === null) return `  >${HORIZON}`;
  return `${String(t).padStart(5)} (${(t / TURNS_PER_YEAR).toFixed(1)}y)`;
}

async function main(): Promise<void> {
  const snap = await load();
  console.log(
    `Live turn ${snap.turn} | US registrationAccessBias=${snap.bias} | drive ${DRIVE_PP} pp/state/turn\n`
  );

  // Sanity: how much pool capacity exists anywhere in the US right now?
  const poolTotal = snap.pools.reduce(
    (s, p) => s + (p.independent ?? 0) + (p.unregistered ?? 0),
    0
  );
  console.log(
    `US pool capacity across ${snap.pools.length} states: ${poolTotal.toFixed(3)} pp ` +
      `(this is why the pool-only drive applies nothing)\n`
  );

  const states = [...new Set(snap.pools.map((p) => p.stateId))]
    .filter((s) => snap.orgs.some((o) => o.stateId === s && String(o.partyId) === GOP))
    .sort();

  console.log("GOP turns to reach its Org target, by arm:\n");
  console.log("ST   BEFORE no drive  BEFORE funded   AFTER funded    speedup");
  const rows: Array<{
    st: string;
    base: number | null;
    before: number | null;
    after: number | null;
  }> = [];
  for (const st of states) {
    // base = today's shipped world with nobody funding a drive.
    const base = replay(snap, st, "before", 0, 0).turns;
    const before = replay(snap, st, "before", DRIVE_PP, 0).turns;
    const after = replay(snap, st, "after", DRIVE_PP, 0.5).turns;
    rows.push({ st, base, before, after });
  }
  rows.sort((a, b) => (b.after ?? 1e9) - (a.after ?? 1e9));
  for (const r of rows.slice(0, 12)) {
    const sp = r.before && r.after ? `${(r.before / r.after).toFixed(2)}x` : "-";
    console.log(`${r.st.padEnd(3)} ${fmt(r.base)}  ${fmt(r.before)}  ${fmt(r.after)}   ${sp}`);
  }

  const done = rows.filter((r) => r.after !== null);
  const slowestBefore = Math.max(...rows.map((r) => r.before ?? 0));
  const slowestAfter = Math.max(...done.map((r) => r.after!));
  console.log(
    `\nSlowest state: ${slowestBefore} turns (${(slowestBefore / TURNS_PER_YEAR).toFixed(1)} in-game yr) ` +
      `-> ${slowestAfter} turns (${(slowestAfter / TURNS_PER_YEAR).toFixed(1)} in-game yr)`
  );
  console.log(
    `Design target band for a stronghold shift is 150-300 turns ` +
      `(STRONGHOLD_FALL_TIME_TURNS_TARGET).`
  );

  // The decay lapse is GLOBAL, so the report cannot stop at the US. Worst-case
  // party erosion per country over 2000 turns (41.7 in-game years), measured by
  // replaying every state with the lapse off and on.
  await reportCrossCountryLapse();

  // Decay-split effect in isolation, on a representative state shape.
  console.log("\nDecay split, per state per turn (6 parties, US -50 rate 0.006):");
  const shape = [
    { rowId: "a", partyId: "1", orgPct: 36, regPct: 40 },
    { rowId: "b", partyId: "6", orgPct: 25, regPct: 8 },
  ];
  for (const share of [0, 0.5]) {
    const r = computeDecayDeltas(shape, 0.006, 10, 1.5, undefined, share);
    const toPool = r.poolDelta.independent + r.poolDelta.unregistered;
    const gop = r.partyDeltas.find((d) => d.partyId === "6");
    console.log(
      `  lapse ${share}: pool +${toPool.toFixed(5)} pp/turn, GOP net ${gop!.delta >= 0 ? "+" : ""}${gop!.delta.toFixed(5)} pp/turn`
    );
  }
}

void main();
