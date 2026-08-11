/**
 * Founding-cycle (pre-iteration) election audit.
 *
 * Reads one or more sandbox worlds bootstrapped with
 * `runWorld.ts --pre-iteration --mode=elections-only` and scores the FIRST 48
 * TURNS — the synchronized cycle-0 founding races that seat every nation at
 * once — on the three things a founding cycle has to get right:
 *
 *   1. COVERAGE   — does every political country actually get a founding race,
 *                   and is every race labelled cycle 0? (A body that spawns on
 *                   its historical anchor instead skews its LARP year and its
 *                   whole downstream cycle numbering.)
 *   2. SUPPLY     — do the races get candidates? An empty or single-candidate
 *                   race is not an election, it is a coronation.
 *   3. BALANCE    — margin distribution, lead changes, share movement across
 *                   the general window, and how concentrated the resulting
 *                   chambers are (top-party seat share + effective number of
 *                   parties). A founding that always returns the same landslide
 *                   for the same seeded favourite is not a game.
 *
 * With `--compare=db1,db2,...` it additionally reports UNPREDICTABILITY: for
 * every seat contested in all the given worlds, how often the winning PARTY
 * differs across RNG seeds. That is the single number that says whether the
 * founding is a real election or a replay of the seed file.
 *
 * Read-only. Never writes to any world.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 \
 *     npx tsx scripts/sim/foundingAudit.ts --db=ahd_sim_fnd1953a
 *   SIM_MONGODB_URI=... npx tsx scripts/sim/foundingAudit.ts \
 *     --compare=ahd_sim_fnd1953a,ahd_sim_fnd1953b,ahd_sim_fnd1953c
 */
export {};

import type { Db } from "mongodb";

function arg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found?.slice(prefix.length);
}

const SIM_MONGODB_URI = process.env.SIM_MONGODB_URI;
const dbArg = arg("db");
const compareArg = arg("compare");
const jsonOut = arg("json");

if (!SIM_MONGODB_URI || (!dbArg && !compareArg)) {
  console.error(
    "Usage: SIM_MONGODB_URI=... npx tsx scripts/sim/foundingAudit.ts --db=<sandboxDb> " +
      "[--compare=db1,db2,...] [--json=<path>]"
  );
  process.exit(1);
}

interface RaceRow {
  electionId: string;
  countryId: string;
  electionType: string;
  state: string | null;
  seatId: string | null;
  cycle: number;
  status: string;
  startTurn: number | null;
  endTurn: number | null;
  totalSeats: number;
  candidates: number;
  /** Winner's final share minus runner-up's (percentage points). */
  marginPct: number | null;
  /** Distinct leaders across the general window minus one. */
  leadChanges: number;
  /** max(share) - min(share) for the eventual winner across the window. */
  winnerShareRangePct: number | null;
  winnerParty: string | null;
  /** Raw votes by party for this race — the system-neutral concentration input. */
  votesByParty: Record<string, number>;
  /** True when the eventual winner led at the FIRST tally snapshot and never lost it. */
  wireToWire: boolean | null;
  hasTally: boolean;
}

interface WorldAudit {
  dbName: string;
  turn: number;
  preIterationActive: boolean;
  races: RaceRow[];
  /** countryId -> seats actually held (summing seatsHeld, never counting rows). */
  heldByCountry: Map<string, number>;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const rest = pos - lo;
  return sorted[lo + 1] !== undefined
    ? sorted[lo] + rest * (sorted[lo + 1] - sorted[lo])
    : sorted[lo];
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`;
}

/** Herfindahl-inverse: 1/Σ(sᵢ²) over party seat shares. 1.0 = one-party sweep. */
function effectiveParties(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const hhi = counts.reduce((acc, c) => acc + (c / total) ** 2, 0);
  return 1 / hhi;
}

async function auditWorld(db: Db, dbName: string): Promise<WorldAudit> {
  const gameState = await db.collection("gameState").findOne<{
    currentTurn?: number;
    preIteration?: { active?: boolean };
  }>({ _id: "current" as never });

  const elections = await db
    .collection("elections")
    .find<{
      _id: unknown;
      countryId: string;
      electionType: string;
      state?: string;
      seatId?: string;
      cycle?: number;
      status: string;
      startTurn?: number;
      endTurn?: number;
      totalSeats?: number;
    }>({})
    .toArray();

  // Candidate counts per election (active + anyone who made it to the general).
  const candAgg = await db
    .collection("electionCandidates")
    .aggregate<{ _id: unknown; n: number }>([{ $group: { _id: "$electionId", n: { $sum: 1 } } }])
    .toArray();
  const candByElection = new Map(candAgg.map((r) => [String(r._id), r.n]));

  const tallies = await db
    .collection("electionVoteTallies")
    .find<{
      electionId: unknown;
      totalVotes?: Record<string, number>;
      candidateParties?: Record<string, string>;
      turnSnapshots?: { turn: number; sharesPct?: Record<string, number> }[];
    }>({})
    .toArray();
  const tallyByElection = new Map(tallies.map((t) => [String(t.electionId), t]));

  const races: RaceRow[] = elections.map((e) => {
    const id = String(e._id);
    const tally = tallyByElection.get(id);
    let marginPct: number | null = null;
    let leadChanges = 0;
    let winnerShareRangePct: number | null = null;
    let winnerParty: string | null = null;
    let wireToWire: boolean | null = null;
    const votesByParty: Record<string, number> = {};

    if (tally?.totalVotes) {
      for (const [cid, v] of Object.entries(tally.totalVotes)) {
        const p = tally.candidateParties?.[cid] ?? "?";
        votesByParty[p] = (votesByParty[p] ?? 0) + v;
      }
    }

    if (tally?.totalVotes) {
      const ranked = Object.entries(tally.totalVotes).sort((a, b) => b[1] - a[1]);
      if (ranked.length >= 1) {
        const total = ranked.reduce((a, [, v]) => a + v, 0);
        const winnerId = ranked[0][0];
        winnerParty = tally.candidateParties?.[winnerId] ?? null;
        if (total > 0) {
          const winShare = (ranked[0][1] / total) * 100;
          const runnerShare = ranked[1] ? (ranked[1][1] / total) * 100 : 0;
          marginPct = winShare - runnerShare;
        }
        const snaps = tally.turnSnapshots ?? [];
        let prevLeader: string | null = null;
        let minW = Infinity;
        let maxW = -Infinity;
        let ledEvery = snaps.length > 0;
        for (const s of snaps) {
          const lead =
            Object.entries(s.sharesPct ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
          if (lead !== winnerId) ledEvery = false;
        }
        wireToWire = snaps.length ? ledEvery : null;
        for (const s of snaps) {
          const shares = s.sharesPct ?? {};
          const leader = Object.entries(shares).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
          if (prevLeader !== null && leader !== null && leader !== prevLeader) leadChanges++;
          if (leader !== null) prevLeader = leader;
          const w = shares[winnerId];
          if (typeof w === "number") {
            minW = Math.min(minW, w);
            maxW = Math.max(maxW, w);
          }
        }
        if (minW !== Infinity) winnerShareRangePct = maxW - minW;
      }
    }

    return {
      electionId: id,
      countryId: e.countryId,
      electionType: e.electionType,
      state: e.state ?? null,
      seatId: e.seatId ?? null,
      cycle: e.cycle ?? -1,
      status: e.status,
      startTurn: typeof e.startTurn === "number" ? e.startTurn : null,
      endTurn: typeof e.endTurn === "number" ? e.endTurn : null,
      totalSeats: e.totalSeats ?? 1,
      candidates: candByElection.get(id) ?? 0,
      marginPct,
      leadChanges,
      winnerShareRangePct,
      winnerParty,
      votesByParty,
      wireToWire,
      hasTally: Boolean(tally),
    };
  });

  // Seat fill. Two traps make a hand-rolled version of this badly wrong, so it
  // lives in the tool rather than in whatever ad-hoc query someone writes next:
  //   1. `electedOfficials.seatsHeld` carries a BLOC of seats — one Polish
  //      deputy holds 54. Counting documents made a healthy 98.9%-filled world
  //      read as 4.4% filled.
  //   2. A list-tier (AMS/MMP) chamber only gets election records for its
  //      DIRECT-MANDATE tier. Germany's Bundestag records 251 Wahlkreis seats
  //      while the real 1953 chamber is 487; the national list tier has no
  //      Election document at all. Summing `elections.totalSeats` therefore
  //      undercounts the target and reports a phantom 114% over-seat (#3901).
  const officialSeats = await db
    .collection("electedOfficials")
    .aggregate<{ _id: string; seats: number }>([
      { $group: { _id: "$countryId", seats: { $sum: { $ifNull: ["$seatsHeld", 1] } } } },
    ])
    .toArray();
  const heldByCountry = new Map(officialSeats.map((r) => [String(r._id), r.seats]));

  return {
    dbName,
    turn: gameState?.currentTurn ?? 0,
    preIterationActive: Boolean(gameState?.preIteration?.active),
    races,
    heldByCountry,
  };
}

function reportWorld(audit: WorldAudit): void {
  const { races } = audit;
  const founding = races.filter((r) => r.cycle === 0);
  // A coverage gap is a race that RESOLVED inside the founding window without
  // being a founding race — a seat the founding was supposed to fill but that
  // spawned on its historical anchor instead. Keyed on endTurn, not startTurn:
  // a correctly handed-off cycle-1 race carries a canonical startTurn that can
  // predate the handoff (US house cycle 1 starts at turn 48 for an endTurn of
  // 144), so a startTurn test would flag the whole post-founding battery.
  const foundingEnd = founding.reduce((m, r) => Math.max(m, r.endTurn ?? 0), 0);
  const nonFounding = races.filter(
    (r) => r.cycle !== 0 && r.endTurn !== null && r.endTurn <= foundingEnd
  );

  console.log(
    `\n══ ${audit.dbName} — turn ${audit.turn} (preIteration ${audit.preIterationActive ? "ACTIVE" : "ended"})`
  );
  console.log(
    `   races=${races.length}  founding(cycle 0)=${founding.length}  ` +
      `founding window=turns 1-${foundingEnd}  in-window non-founding=${nonFounding.length}`
  );

  if (nonFounding.length) {
    const grouped = new Map<string, number>();
    for (const r of nonFounding) {
      const k = `${r.countryId}/${r.electionType}@cycle${r.cycle}`;
      grouped.set(k, (grouped.get(k) ?? 0) + 1);
    }
    console.log("   ⚠ COVERAGE GAP — races that did not spawn as founding:");
    for (const [k, n] of [...grouped].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${k}  ×${n}`);
    }
  }

  // ── Supply ────────────────────────────────────────────────────────────────
  const empty = founding.filter((r) => r.candidates === 0);
  const single = founding.filter((r) => r.candidates === 1);
  const contested = founding.filter((r) => r.candidates >= 2);
  console.log(
    `   SUPPLY: 0-candidate=${empty.length} (${pct(empty.length, founding.length)})  ` +
      `1-candidate=${single.length} (${pct(single.length, founding.length)})  ` +
      `contested=${contested.length} (${pct(contested.length, founding.length)})`
  );
  if (empty.length) {
    const byCountry = new Map<string, number>();
    for (const r of empty) byCountry.set(r.countryId, (byCountry.get(r.countryId) ?? 0) + 1);
    console.log(
      `      empty by country: ${[...byCountry]
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${c}:${n}`)
        .join("  ")}`
    );
  }
  if (single.length) {
    const byCountry = new Map<string, number>();
    for (const r of single) byCountry.set(r.countryId, (byCountry.get(r.countryId) ?? 0) + 1);
    console.log(
      `      uncontested by country: ${[...byCountry]
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${c}:${n}`)
        .join("  ")}`
    );
  }

  // ── Competitiveness ───────────────────────────────────────────────────────
  const withMargin = founding.filter((r) => r.marginPct !== null && r.candidates >= 2);
  const margins = withMargin.map((r) => r.marginPct as number).sort((a, b) => a - b);
  if (margins.length) {
    const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
    const blowouts = margins.filter((m) => m >= 40).length;
    const nailbiters = margins.filter((m) => m <= 5).length;
    console.log(
      `   MARGIN (n=${margins.length}): p10=${quantile(margins, 0.1).toFixed(1)}  ` +
        `median=${quantile(margins, 0.5).toFixed(1)}  mean=${mean.toFixed(1)}  ` +
        `p90=${quantile(margins, 0.9).toFixed(1)}  ` +
        `≤5pt=${pct(nailbiters, margins.length)}  ≥40pt=${pct(blowouts, margins.length)}`
    );
    const meanLead = withMargin.reduce((a, r) => a + r.leadChanges, 0) / withMargin.length;
    const drifts = withMargin
      .map((r) => r.winnerShareRangePct)
      .filter((d): d is number => d !== null);
    const meanDrift = drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : NaN;
    const everFlipped = withMargin.filter((r) => r.leadChanges > 0).length;
    console.log(
      `   DYNAMISM: meanLeadChanges=${meanLead.toFixed(2)}  ` +
        `racesThatEverFlipped=${pct(everFlipped, withMargin.length)}  ` +
        `meanWinnerShareSwing=${Number.isNaN(meanDrift) ? "n/a" : meanDrift.toFixed(1) + "pt"}`
    );
  } else {
    console.log("   MARGIN: no tallies yet (general window not reached?)");
  }

  const wtw = founding.filter((r) => r.wireToWire !== null);
  if (wtw.length) {
    console.log(
      `   WIRE-TO-WIRE: winner led every single tally snapshot in ` +
        `${pct(wtw.filter((r) => r.wireToWire).length, wtw.length)} of races ` +
        `(n=${wtw.length}) — high = the first poll already decided it`
    );
  }

  // ── Seat fill ─────────────────────────────────────────────────────────────
  // Chambers whose election records cover only the direct-mandate tier, with
  // the real configured chamber size to use instead (see #3901).
  const LIST_TIER_CHAMBERS: Record<string, number> = {
    // DE Bundestag, 1953: `countries.ts` lowerChamber.seats = 487; the founding
    // races record only the 251 Wahlkreis seats.
    "DE/bundestag": 487,
  };
  const configured = new Map<string, number>();
  for (const r of founding) {
    if (LIST_TIER_CHAMBERS[`${r.countryId}/${r.electionType}`] !== undefined) continue;
    configured.set(r.countryId, (configured.get(r.countryId) ?? 0) + r.totalSeats);
  }
  for (const [key, seats] of Object.entries(LIST_TIER_CHAMBERS)) {
    const cid = key.split("/")[0];
    if (founding.some((r) => `${r.countryId}/${r.electionType}` === key)) {
      configured.set(cid, (configured.get(cid) ?? 0) + seats);
    }
  }
  let totalCfg = 0;
  let totalHeld = 0;
  const offBand: string[] = [];
  for (const [cid, cfg] of [...configured].sort()) {
    const held = audit.heldByCountry.get(cid) ?? 0;
    totalCfg += cfg;
    totalHeld += held;
    const p = cfg ? (held / cfg) * 100 : 0;
    if (Math.abs(p - 100) > 10) offBand.push(`${cid} ${p.toFixed(0)}% (${held}/${cfg})`);
  }
  console.log(
    `   SEAT FILL: ${totalHeld.toLocaleString()}/${totalCfg.toLocaleString()} = ` +
      `${totalCfg ? ((totalHeld / totalCfg) * 100).toFixed(1) : "n/a"}%` +
      (offBand.length ? `  ⚠ off by >10%: ${offBand.join(", ")}` : "  (all countries within 10%)")
  );

  // ── Per-country roll-up ───────────────────────────────────────────────────
  // Concentration is measured on VOTES BY PARTY, not on winner-take-all seat
  // attribution: a PR list chamber resolves one election into many parties'
  // seats, so crediting every seat to the top candidate's party would report a
  // one-party sweep for every proportional country in the game.
  const countries = [...new Set(founding.map((r) => r.countryId))].sort();
  console.log("   PER COUNTRY  races  cand0  uncont  medMargin  ≥40pt  topPartyVote  effParties");
  for (const c of countries) {
    const rs = founding.filter((r) => r.countryId === c);
    const ms = rs
      .filter((r) => r.marginPct !== null && r.candidates >= 2)
      .map((r) => r.marginPct as number)
      .sort((a, b) => a - b);
    const partyVotes = new Map<string, number>();
    for (const r of rs) {
      for (const [p, v] of Object.entries(r.votesByParty)) {
        partyVotes.set(p, (partyVotes.get(p) ?? 0) + v);
      }
    }
    const voteCounts = [...partyVotes.values()];
    const totalVotes = voteCounts.reduce((a, b) => a + b, 0);
    const top = voteCounts.length ? Math.max(...voteCounts) : 0;
    console.log(
      `     ${c.padEnd(4)} ${String(rs.length).padStart(6)} ` +
        `${String(rs.filter((r) => r.candidates === 0).length).padStart(6)} ` +
        `${String(rs.filter((r) => r.candidates === 1).length).padStart(7)} ` +
        `${(ms.length ? quantile(ms, 0.5).toFixed(1) : "n/a").padStart(10)} ` +
        `${(ms.length ? pct(ms.filter((m) => m >= 40).length, ms.length) : "n/a").padStart(6)} ` +
        `${(totalVotes ? pct(top, totalVotes) : "n/a").padStart(13)} ` +
        `${(voteCounts.length ? effectiveParties(voteCounts).toFixed(2) : "n/a").padStart(11)}`
    );
  }
}

/** Cross-seed unpredictability: same seat, different worlds — does the winning party move? */
function reportCompare(audits: WorldAudit[]): void {
  console.log(`\n══ CROSS-SEED UNPREDICTABILITY (${audits.map((a) => a.dbName).join(" vs ")})`);
  const keyOf = (r: RaceRow) => r.seatId ?? `${r.countryId}|${r.electionType}|${r.state ?? ""}`;

  const perWorld = audits.map((a) => {
    const m = new Map<string, RaceRow>();
    for (const r of a.races) if (r.cycle === 0) m.set(keyOf(r), r);
    return m;
  });

  const shared = [...perWorld[0].keys()].filter((k) =>
    perWorld.every((m) => m.get(k)?.winnerParty)
  );
  if (!shared.length) {
    console.log("   no shared resolved seats across worlds — run them to turn 49 first");
    return;
  }

  let varied = 0;
  const byCountry = new Map<string, { n: number; varied: number }>();
  for (const k of shared) {
    const parties = perWorld.map((m) => m.get(k)!.winnerParty);
    const isVaried = new Set(parties).size > 1;
    if (isVaried) varied++;
    const c = perWorld[0].get(k)!.countryId;
    const acc = byCountry.get(c) ?? { n: 0, varied: 0 };
    acc.n++;
    if (isVaried) acc.varied++;
    byCountry.set(c, acc);
  }
  console.log(
    `   seats compared=${shared.length}  winning party DIFFERS across seeds in ` +
      `${varied} (${pct(varied, shared.length)})`
  );
  console.log("   per country:");
  for (const [c, acc] of [...byCountry].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `     ${c.padEnd(4)} ${String(acc.n).padStart(4)} seats  varied=${pct(acc.varied, acc.n)}`
    );
  }
}

async function main() {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(SIM_MONGODB_URI as string);
  await client.connect();
  try {
    const names = compareArg
      ? compareArg
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [dbArg!];
    const audits: WorldAudit[] = [];
    for (const name of names) {
      const audit = await auditWorld(client.db(name), name);
      audits.push(audit);
      reportWorld(audit);
    }
    if (audits.length > 1) reportCompare(audits);
    if (jsonOut) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(jsonOut, JSON.stringify(audits, null, 2));
      console.log(`\nwrote ${jsonOut}`);
    }
  } finally {
    await client.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("foundingAudit FAILED:", e);
    process.exit(1);
  });
