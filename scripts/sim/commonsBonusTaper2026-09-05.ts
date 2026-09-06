/**
 * Commons winner's-bonus taper: calibrating `k` (tickets #1276 / #1277).
 *
 * The FPTP winner's bonus boosts two party groups and squeezes the rest. Slot 1
 * is the region's leading party by votes; slot 2 is currently the best-ORGANIZED
 * other party. Organization is live state that players move several points per
 * turn, so slot 2 flips between turns on a sub-point difference and relocates
 * 9-20 seats each time it does. Measured on the live world: LON's CON/SDP org
 * gap was 0.27-1.07 points across the flips, and SCO turn 647 was an exact
 * 24.17 vs 24.17 tie broken by party id.
 *
 * Proposed rule: slot 2 by POOLED VOTES, and membership of the boosted bloc
 * TAPERS behind the runner-up instead of being all-or-nothing:
 *
 *   leader     w = 1
 *   runner-up  w = 1                       (v_R = runner-up pooled votes)
 *   others     w = min(1, (v_g / v_R)^k)
 *
 *   B         = sum_g w_g * v_g            bloc mass; replaces pairVotes
 *   sBloc     = B / poolVotes
 *   targetB   = poolVotes * sBloc^n / (sBloc^n + (1-sBloc)^n)
 *   if targetB <= B -> no boost            (existing BOOST-only guard)
 *   scaleUp   = targetB / B
 *   scaleDown = (poolVotes - targetB) / (poolVotes - B)
 *   s_g       = w_g*scaleUp + (1 - w_g)*scaleDown
 *
 * Total is conserved exactly (sum v_g*s_g == poolVotes), so largest remainder,
 * seat conservation and determinism are untouched. A two-party pool gives
 * B == poolVotes, so poolVotes - B == 0, the existing guard fires, and the
 * allocation is exactly proportional — the NWE case, preserved by construction.
 *
 * k -> infinity reproduces the hard pair (votes-based slot 2, no taper), so the
 * sweep contains the un-smoothed variant as a comparison arm.
 *
 * EVERY input is real. Vote distributions come from `electionVoteTallies` for
 * every resolved UK Commons race across all cycles, including each race's
 * per-turn `turnSnapshots.cumulativeVotes` — roughly 1,200 real distributions at
 * every stage of a count. The OBSERVED arm is not modelled at all: it is the
 * `seatsEstimate` the engine actually stored on each snapshot.
 *
 * The question is NOT "which k is most proportional" — it is "which k removes
 * the discontinuity without flattening the runner-up's earned advantage or
 * un-squeezing third parties". A k so low that the runner-up and the third
 * party tie has replaced the winner's bonus with plain PR.
 *
 *   npx tsx scripts/sim/commonsBonusTaper2026-09-05.ts
 *   SIM_K=2,3,4,5 npx tsx scripts/sim/commonsBonusTaper2026-09-05.ts
 */
import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  allocateSeats,
  getMultiSeatMinShare,
  UK_COMMONS_FPTP_EXPONENT,
} from "@/lib/turn/election/seatAllocation";
import { getUkCommonsSeats } from "@/lib/constants/states";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

/** Taper exponents under test. Infinity = hard pair, votes-based slot 2. */
const ARMS: number[] = (process.env.SIM_K ?? "2,3,4,5,6,8,10")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
  .concat([Infinity]);

const N = UK_COMMONS_FPTP_EXPONENT;
const MIN_SHARE = getMultiSeatMinShare("commons", { majoritarian: true });

interface Race {
  region: string;
  cycle: number;
  seats: number;
  parties: Record<string, string>;
  /** One entry per turn of the count, oldest first, plus the final total. */
  frames: { turn: number; votes: Record<string, number>; observed?: Record<string, number> }[];
}

const groupOf = (cid: string, parties: Record<string, string>) => {
  const p = parties[cid];
  return p && p !== "independent" ? `party:${p}` : `cand:${cid}`;
};

/** Eligible pool under the party-pooled minimum-share gate. */
function poolOf(votes: Record<string, number>, parties: Record<string, string>) {
  const grand = Object.values(votes).reduce((a, b) => a + b, 0);
  const byGroup = new Map<string, number>();
  for (const [cid, v] of Object.entries(votes)) {
    const g = groupOf(cid, parties);
    byGroup.set(g, (byGroup.get(g) ?? 0) + v);
  }
  const pool = Object.entries(votes).filter(
    ([cid]) => grand > 0 && (byGroup.get(groupOf(cid, parties)) ?? 0) / grand >= MIN_SHARE
  );
  return { pool, poolVotes: pool.reduce((s, [, v]) => s + v, 0) };
}

/** Largest remainder over effective weights. */
function allocate(
  pool: [string, number][],
  eff: Map<string, number>,
  poolVotes: number,
  totalSeats: number,
  allIds: string[]
): Record<string, number> {
  const seats: Record<string, number> = {};
  for (const cid of allIds) seats[cid] = 0;
  if (poolVotes <= 0) return seats;
  const allocs = pool.map(([cid]) => {
    const exact = (eff.get(cid)! / poolVotes) * totalSeats;
    return { cid, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let allocated = 0;
  for (const a of allocs) {
    seats[a.cid] = a.floor;
    allocated += a.floor;
  }
  const remaining = totalSeats - allocated;
  const sorted = [...allocs].sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < remaining && i < sorted.length; i++) seats[sorted[i].cid]++;
  return seats;
}

/**
 * The rule at taper `k`, run through the SHIPPED allocator. Calling production
 * rather than a local model means every number in the report is the behaviour
 * that actually ships; a divergence between the two could otherwise calibrate
 * `k` against code nobody runs.
 *
 * `k = Infinity` drives every non-principal's membership to zero, reproducing
 * the old all-or-nothing pair as the control arm.
 */
const COMMONS_SEATS_1953 = getUkCommonsSeats("1953-default");

function allocateTapered(
  votes: Record<string, number>,
  parties: Record<string, string>,
  totalSeats: number,
  k: number,
  region: string
): Record<string, number> {
  const ranked = Object.entries(votes)
    .map(([id, v]) => ({ id, votes: v, party: parties[id] }))
    .sort((a, b) => b.votes - a.votes);
  const totalVotesCast = ranked.reduce((s, r) => s + r.votes, 0);
  if (totalVotesCast <= 0) return Object.fromEntries(Object.keys(votes).map((id) => [id, 0]));
  return allocateSeats(
    "commons",
    region,
    totalSeats,
    ranked,
    totalVotesCast,
    undefined,
    { exponent: N, taper: k },
    undefined,
    // The live world is a 1953 preset; without this the modern 650-seat map
    // would override each region's real delegation.
    { ...COMMONS_SEATS_1953, [region]: totalSeats }
  ).seatsEstimate;
}

const byParty = (seats: Record<string, number>, parties: Record<string, string>) => {
  const m = new Map<string, number>();
  for (const [cid, s] of Object.entries(seats))
    m.set(parties[cid] ?? "?", (m.get(parties[cid] ?? "?") ?? 0) + s);
  return m;
};
const churn = (a: Map<string, number>, b: Map<string, number>) =>
  [...new Set([...a.keys(), ...b.keys()])].reduce(
    (acc, p) => acc + Math.abs((b.get(p) ?? 0) - (a.get(p) ?? 0)),
    0
  ) / 2;

function gallagher(votePct: Map<string, number>, seatPct: Map<string, number>) {
  let acc = 0;
  for (const p of new Set([...votePct.keys(), ...seatPct.keys()]))
    acc += Math.pow((seatPct.get(p) ?? 0) - (votePct.get(p) ?? 0), 2);
  return Math.sqrt(acc / 2);
}

async function loadRaces(db: Db): Promise<Race[]> {
  const els = await db
    .collection("elections")
    .find({
      countryId: "UK",
      electionType: { $in: ["commons", "snap_commons"] },
      status: "resolved",
    })
    .toArray();
  const races: Race[] = [];
  for (const el of els) {
    const tally = await db.collection("electionVoteTallies").findOne({ _id: el._id as never });
    if (!tally) continue;
    const votes = (tally.totalVotes ?? {}) as Record<string, number>;
    if (Object.values(votes).reduce((a, b) => a + b, 0) === 0) continue;
    const parties = (tally.candidateParties ?? {}) as Record<string, string>;
    const snaps = (tally.turnSnapshots ?? []) as {
      turn: number;
      cumulativeVotes?: Record<string, number>;
      seatsEstimate?: Record<string, number>;
    }[];
    const frames = snaps
      .filter((s) => s.cumulativeVotes && Object.values(s.cumulativeVotes).some((v) => v > 0))
      .map((s) => ({ turn: s.turn, votes: s.cumulativeVotes!, observed: s.seatsEstimate }));
    frames.push({
      turn: (el.endTurn as number) ?? Number.MAX_SAFE_INTEGER,
      votes,
      observed: (tally.seatsEstimate ?? undefined) as Record<string, number> | undefined,
    });
    races.push({
      region: el.state as string,
      cycle: (el.cycle as number) ?? 0,
      seats: (el.totalSeats as number) ?? 0,
      parties,
      frames,
    });
  }
  return races;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db() as unknown as Db;
  const races = await loadRaces(db);
  await client.close();

  const frameCount = races.reduce((s, r) => s + r.frames.length, 0);
  console.log(`# Commons bonus taper — calibrating k\n`);
  console.log(
    `Real inputs: ${races.length} resolved UK Commons races, ${frameCount} vote distributions ` +
      `(per-turn counts + finals). Power-law exponent n=${N}, gate ${(MIN_SHARE * 100).toFixed(0)}%.\n`
  );

  // ── A. OBSERVED: turn-to-turn seat churn the live engine actually produced.
  let obsChurn = 0;
  let obsPairs = 0;
  let obsWorst = { region: "", cycle: 0, turn: 0, churn: 0, voteMove: 0 };
  for (const r of races) {
    for (let i = 1; i < r.frames.length; i++) {
      const p = r.frames[i - 1];
      const c = r.frames[i];
      if (!p.observed || !c.observed) continue;
      const d = churn(byParty(p.observed, r.parties), byParty(c.observed, r.parties));
      // How far did the vote actually move between these two frames?
      const gp = Object.values(p.votes).reduce((a, b) => a + b, 0);
      const gc = Object.values(c.votes).reduce((a, b) => a + b, 0);
      const shares = new Map<string, number>();
      for (const [cid, v] of Object.entries(p.votes))
        shares.set(groupOf(cid, r.parties), (shares.get(groupOf(cid, r.parties)) ?? 0) + v / gp);
      let voteMove = 0;
      const sc = new Map<string, number>();
      for (const [cid, v] of Object.entries(c.votes))
        sc.set(groupOf(cid, r.parties), (sc.get(groupOf(cid, r.parties)) ?? 0) + v / gc);
      for (const key of new Set([...shares.keys(), ...sc.keys()]))
        voteMove = Math.max(voteMove, Math.abs((sc.get(key) ?? 0) - (shares.get(key) ?? 0)) * 100);
      obsChurn += d;
      obsPairs++;
      if (d > obsWorst.churn)
        obsWorst = { region: r.region, cycle: r.cycle, turn: c.turn, churn: d, voteMove };
    }
  }
  console.log(`## A. Observed churn under the CURRENT rule (measured, not modelled)\n`);
  console.log(
    `Mean seats relocated between consecutive turns of a count: **${(obsChurn / Math.max(1, obsPairs)).toFixed(2)}** over ${obsPairs} turn pairs.`
  );
  console.log(
    `Worst single turn: **${obsWorst.region} cycle ${obsWorst.cycle} turn ${obsWorst.turn} — ${obsWorst.churn} seats moved** ` +
      `on a largest party-share move of ${obsWorst.voteMove.toFixed(2)} points.\n`
  );

  // ── B. Per-arm metrics.
  console.log(`## B. Candidate tapers\n`);
  console.log(
    `| k | churn/turn | max cliff | cliff races | monotonicity breaks | 3rd+ seat% (votes 3rd+ %) | Gallagher |`
  );
  console.log(`|---|---|---|---|---|---|---|`);

  const detail: string[] = [];
  for (const k of ARMS) {
    let armChurn = 0;
    let pairs = 0;
    let maxCliff = 0;
    let cliffRaces = 0;
    let cliffTotal = 0;
    let mono = 0;
    let worstCliff = "";

    // National finals, for Gallagher + third-party squeeze.
    const natSeats = new Map<string, number>();
    const natVotes = new Map<string, number>();
    let thirdSeats = 0;
    let thirdVotes = 0;
    let natSeatTotal = 0;
    let natVoteTotal = 0;

    for (const r of races) {
      for (let i = 1; i < r.frames.length; i++) {
        const a = allocateTapered(r.frames[i - 1].votes, r.parties, r.seats, k, r.region);
        const b = allocateTapered(r.frames[i].votes, r.parties, r.seats, k, r.region);
        armChurn += churn(byParty(a, r.parties), byParty(b, r.parties));
        pairs++;
      }

      const finalFrame = r.frames[r.frames.length - 1];
      const base = allocateTapered(finalFrame.votes, r.parties, r.seats, k, r.region);

      // Cliff probe: nudge #2 and #3 to a dead heat, then hand #3 a single extra
      // vote. A rule with no discontinuity moves ~0 seats across that boundary.
      const { pool } = poolOf(finalFrame.votes, r.parties);
      const g = new Map<string, number>();
      for (const [cid, v] of pool) {
        const key = groupOf(cid, r.parties);
        g.set(key, (g.get(key) ?? 0) + v);
      }
      const ranked = [...g.entries()].sort((x, y) => y[1] - x[1]);
      if (ranked.length >= 3) {
        const mid = (ranked[1][1] + ranked[2][1]) / 2;
        const nudge = (winner: 1 | 2) => {
          const out: Record<string, number> = {};
          for (const [cid, v] of Object.entries(finalFrame.votes)) {
            const key = groupOf(cid, r.parties);
            if (key === ranked[1][0])
              out[cid] = (v * (mid + (winner === 1 ? 1 : 0))) / ranked[1][1];
            else if (key === ranked[2][0])
              out[cid] = (v * (mid + (winner === 2 ? 1 : 0))) / ranked[2][1];
            else out[cid] = v;
          }
          return out;
        };
        const c = churn(
          byParty(allocateTapered(nudge(1), r.parties, r.seats, k, r.region), r.parties),
          byParty(allocateTapered(nudge(2), r.parties, r.seats, k, r.region), r.parties)
        );
        cliffTotal += c;
        if (c > 0) cliffRaces++;
        if (c > maxCliff) {
          maxCliff = c;
          worstCliff = `${r.region} c${r.cycle}`;
        }
      }

      // Monotonicity: across the count, does any party ever gain vote share and
      // lose seats (or vice versa) under this rule?
      for (let i = 1; i < r.frames.length; i++) {
        const gp = Object.values(r.frames[i - 1].votes).reduce((a, b) => a + b, 0);
        const gc = Object.values(r.frames[i].votes).reduce((a, b) => a + b, 0);
        if (gp === 0 || gc === 0) continue;
        const sa = byParty(
          allocateTapered(r.frames[i - 1].votes, r.parties, r.seats, k, r.region),
          r.parties
        );
        const sb = byParty(
          allocateTapered(r.frames[i].votes, r.parties, r.seats, k, r.region),
          r.parties
        );
        const shareOf = (votes: Record<string, number>, tot: number) => {
          const m = new Map<string, number>();
          for (const [cid, v] of Object.entries(votes))
            m.set(r.parties[cid] ?? "?", (m.get(r.parties[cid] ?? "?") ?? 0) + v / tot);
          return m;
        };
        const va = shareOf(r.frames[i - 1].votes, gp);
        const vb = shareOf(r.frames[i].votes, gc);
        for (const p of new Set([...va.keys(), ...vb.keys()])) {
          const dv = (vb.get(p) ?? 0) - (va.get(p) ?? 0);
          const ds = (sb.get(p) ?? 0) - (sa.get(p) ?? 0);
          // Only count clear contradictions: a real share move against a real
          // seat move. Sub-0.1pp wobble is largest-remainder noise, not a break.
          if (Math.abs(dv) > 0.001 && ds !== 0 && Math.sign(dv) !== Math.sign(ds)) mono++;
        }
      }

      // Latest cycle only for the national picture.
      const latestCycle = Math.max(
        ...races.filter((x) => x.region === r.region).map((x) => x.cycle)
      );
      if (r.cycle === latestCycle) {
        const sp = byParty(base, r.parties);
        const gtot = Object.values(finalFrame.votes).reduce((a, b) => a + b, 0);
        const vp = new Map<string, number>();
        for (const [cid, v] of Object.entries(finalFrame.votes))
          vp.set(r.parties[cid] ?? "?", (vp.get(r.parties[cid] ?? "?") ?? 0) + v);
        const order = [...vp.entries()].sort((x, y) => y[1] - x[1]).map(([p]) => p);
        for (const [p, s] of sp) {
          natSeats.set(p, (natSeats.get(p) ?? 0) + s);
          natSeatTotal += s;
          if (order.indexOf(p) >= 2) thirdSeats += s;
        }
        for (const [p, v] of vp) {
          natVotes.set(p, (natVotes.get(p) ?? 0) + v);
          natVoteTotal += v;
          if (order.indexOf(p) >= 2) thirdVotes += v;
        }
        void gtot;
      }
    }

    const votePct = new Map([...natVotes].map(([p, v]) => [p, (v / natVoteTotal) * 100]));
    const seatPct = new Map([...natSeats].map(([p, s]) => [p, (s / natSeatTotal) * 100]));
    const label = Number.isFinite(k) ? String(k) : "∞ (hard pair)";
    console.log(
      `| ${label} | ${(armChurn / Math.max(1, pairs)).toFixed(2)} | ${maxCliff} (${worstCliff}) | ${cliffRaces} | ${mono} | ` +
        `${((thirdSeats / natSeatTotal) * 100).toFixed(1)}% (${((thirdVotes / natVoteTotal) * 100).toFixed(1)}%) | ` +
        `${gallagher(votePct, seatPct).toFixed(2)} |`
    );
    detail.push(
      `k=${label}: national ${[...natSeats.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([p, s]) => `p${p}:${s}`)
        .join(" ")} ` +
        `(p1 ${natSeats.get("1") ?? 0}, majority ${Math.floor(natSeatTotal / 2) + 1}) mean cliff ${(cliffTotal / Math.max(1, cliffRaces || 1)).toFixed(2)}`
    );
  }

  console.log(`\n## C. National outcome per arm (latest cycle)\n`);
  for (const d of detail) console.log(`- ${d}`);

  // ── D. Two-party fall-through must stay exactly proportional.
  console.log(`\n## D. Two-party fall-through (must be exactly proportional)\n`);
  let twoParty = 0;
  let twoPartyBreaks = 0;
  for (const r of races) {
    const f = r.frames[r.frames.length - 1];
    const { pool, poolVotes } = poolOf(f.votes, r.parties);
    const g = new Set(pool.map(([cid]) => groupOf(cid, r.parties)));
    if (g.size !== 2) continue;
    twoParty++;
    const eff = new Map(pool.map(([cid, v]) => [cid, v]));
    const proportional = allocate(pool, eff, poolVotes, r.seats, Object.keys(f.votes));
    for (const k of ARMS) {
      const got = allocateTapered(f.votes, r.parties, r.seats, k, r.region);
      if (churn(byParty(proportional, r.parties), byParty(got, r.parties)) !== 0) {
        twoPartyBreaks++;
        console.log(`  BREAK ${r.region} c${r.cycle} at k=${k}`);
      }
    }
  }
  console.log(
    `${twoParty} two-party races checked against every arm: **${twoPartyBreaks} deviations from proportional**.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
