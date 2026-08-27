/**
 * Extract a narrative-grade snapshot of a sandbox world for the chronicle report.
 *
 * Pulls the story-bearing facts, not just aggregates: who governs where, which
 * races were won and by how much, which seats changed hands since the founding,
 * what the economy did to each country, and the raw event timeline. Read-only.
 *
 * Usage:
 *   SIM_MONGODB_URI=mongodb://127.0.0.1:27018 \
 *     npx tsx scripts/sim/chronicleExtract.ts --db=ahd_sim_chronicle --out=/tmp/chronicle.json
 */
export {};

function arg(f: string): string | undefined {
  const p = `--${f}=`;
  return process.argv.find((v) => v.startsWith(p))?.slice(p.length);
}

const URI = process.env.SIM_MONGODB_URI;
const dbName = arg("db");
const out = arg("out");
if (!URI || !dbName) {
  console.error("Usage: SIM_MONGODB_URI=... tsx chronicleExtract.ts --db=<db> [--out=file]");
  process.exit(1);
}

async function main() {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(URI as string);
  await client.connect();
  const db = client.db(dbName as string);
  const C = (n: string) => db.collection(n);

  const gs: any = await C("gameState").findOne({ _id: "current" as never });
  const turn = gs?.currentTurn ?? 0;

  // ── Parties (id -> name) ────────────────────────────────────────────────
  const parties = await C("politicalParties")
    .find(
      {},
      {
        projection: {
          sequentialId: 1,
          countryId: 1,
          name: 1,
          abbreviation: 1,
          color: 1,
          politicalStrength: 1,
          treasury: 1,
          memberCount: 1,
        },
      }
    )
    .toArray();
  // ── Elections + tallies ─────────────────────────────────────────────────
  const elections = await C("elections").find({}).toArray();
  const tallies = await C("electionVoteTallies").find({}).toArray();
  const tallyBy = new Map(tallies.map((t: any) => [String(t.electionId), t]));

  function raceRow(e: any) {
    const t: any = tallyBy.get(String(e._id));
    let winnerParty: string | null = null,
      winnerName: string | null = null;
    let marginPct: number | null = null,
      sharePct: number | null = null,
      votes = 0;
    const byParty: Record<string, number> = {};
    if (t?.totalVotes) {
      for (const [cid, v] of Object.entries(t.totalVotes as Record<string, number>)) {
        const p = t.candidateParties?.[cid] ?? "?";
        byParty[p] = (byParty[p] ?? 0) + v;
        votes += v;
      }
      const ranked = Object.entries(t.totalVotes as Record<string, number>).sort(
        (a, b) => b[1] - a[1]
      );
      if (ranked.length && votes > 0) {
        winnerParty = t.candidateParties?.[ranked[0][0]] ?? null;
        winnerName = t.candidateNames?.[ranked[0][0]] ?? null;
        sharePct = (ranked[0][1] / votes) * 100;
        marginPct = sharePct - (ranked[1] ? (ranked[1][1] / votes) * 100 : 0);
      }
    }
    return {
      id: String(e._id),
      countryId: e.countryId,
      type: e.electionType,
      state: e.state ?? null,
      seatId: e.seatId ?? null,
      cycle: e.cycle ?? null,
      status: e.status,
      seats: e.totalSeats ?? 1,
      endTurn: e.endTurn ?? null,
      year: e.electionYear ?? null,
      winnerParty,
      winnerName,
      sharePct,
      marginPct,
      votes,
      byParty,
    };
  }
  const races = elections.map(raceRow);

  // Seat flips: same seatId, founding (cycle 0) vs the latest later cycle.
  const bySeat = new Map<string, any[]>();
  for (const r of races) {
    if (!r.seatId || !r.winnerParty) continue;
    (bySeat.get(r.seatId) ?? bySeat.set(r.seatId, []).get(r.seatId)!).push(r);
  }
  // Every consecutive-cycle party change for a seat, not just founding-vs-latest,
  // so a seat that flipped and flipped back still tells its story.
  const flips: any[] = [];
  for (const [seatId, rs] of bySeat) {
    const ordered = rs.slice().sort((a, b) => (a.cycle ?? 0) - (b.cycle ?? 0));
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1],
        next = ordered[i];
      if (prev.winnerParty && next.winnerParty && prev.winnerParty !== next.winnerParty) {
        flips.push({
          seatId,
          countryId: next.countryId,
          type: next.type,
          state: next.state,
          fromCycle: prev.cycle,
          toCycle: next.cycle,
          from: prev.winnerParty,
          to: next.winnerParty,
          marginPct: next.marginPct,
          winnerName: next.winnerName,
          endTurn: next.endTurn,
        });
      }
    }
  }

  // ── Who governs ─────────────────────────────────────────────────────────
  const officials = await C("electedOfficials")
    .find(
      {},
      {
        projection: { countryId: 1, officeType: 1, state: 1, party: 1, characterName: 1, nppId: 1 },
      }
    )
    .toArray();
  const chamber: Record<string, Record<string, Record<string, number>>> = {};
  for (const o of officials as any[]) {
    const c = String(o.countryId),
      off = String(o.officeType),
      p = String(o.party ?? "?");
    chamber[c] ??= {};
    chamber[c][off] ??= {};
    chamber[c][off][p] = (chamber[c][off][p] ?? 0) + 1;
  }
  // Directly-elected executives come from electedOfficials; parliamentary heads
  // of government are seated by government formation and only surface as a
  // `leader_change` event, so take the latest one per country.
  // `leader_change` entries below carry a `turn`; the electedOfficials branch
  // does not. Annotate so the union is declared rather than inferred from the
  // first branch alone (which made the push below a type error).
  const leaders: Array<{
    countryId: unknown;
    office: unknown;
    name: unknown;
    party: unknown;
    source: string;
    turn?: unknown;
  }> = (officials as any[])
    .filter((o) =>
      [
        "president",
        "primeMinister",
        "chancellor",
        "taoiseach",
        "premier",
        "generalSecretary",
        "uachtaran",
      ].includes(String(o.officeType))
    )
    .map((o) => ({
      countryId: o.countryId,
      office: o.officeType,
      name: o.characterName,
      party: o.party,
      source: "electedOfficials",
    }));
  const leaderChanges = await C("countryHistory")
    .find(
      { eventType: "leader_change" },
      { projection: { countryId: 1, turn: 1, title: 1, characterName: 1, officeType: 1 } }
    )
    .sort({ turn: 1 })
    .toArray();
  const latestLeader = new Map<string, any>();
  for (const ev of leaderChanges as any[]) latestLeader.set(String(ev.countryId), ev);
  for (const [cid, ev] of latestLeader) {
    if (leaders.some((l) => String(l.countryId) === cid)) continue;
    leaders.push({
      countryId: cid,
      office: ev.officeType,
      name: ev.characterName,
      party: null,
      source: "leader_change",
      turn: ev.turn,
    });
  }

  // ── Economy ─────────────────────────────────────────────────────────────
  const budgets = await C("federalBudget").find({}).toArray();
  const economy = (budgets as any[]).map((b) => ({
    countryId: b.countryId,
    currency: b.currencyCode,
    gdp: b.gdp ?? null,
    gdpGrowth: b.economicFactors?.gdpGrowth ?? null,
    inflation: b.economicFactors?.inflationRate ?? null,
    wageGrowth: b.economicFactors?.wageGrowth ?? null,
    debt: b.debt?.principal ?? null,
    debtToGdp: b.debtToGdpRatio ?? null,
    creditRating: b.creditRating ?? null,
    treasury: b.treasuryBalance ?? null,
    revenue: b.revenue?.total ?? null,
    spending: b.spending?.total ?? null,
    surplus: b.surplus ?? null,
    sovereignCrisis: b.sovereignCrisisState ?? null,
  }));

  // ── Corporations ────────────────────────────────────────────────────────
  // Market cap is not stored — it is sharePrice x totalShares.
  const corps = await C("corporations")
    .find(
      {},
      {
        projection: {
          name: 1,
          countryId: 1,
          sector: 1,
          liquidCapital: 1,
          isNationalized: 1,
          isPrivate: 1,
          sharePrice: 1,
          totalShares: 1,
          isPrimaryNationalCorporation: 1,
        },
      }
    )
    .toArray();
  const capOf = (c: any) =>
    typeof c.sharePrice === "number" && typeof c.totalShares === "number"
      ? c.sharePrice * c.totalShares
      : 0;
  const topCorps = (corps as any[])
    .filter((c) => !c.isPrimaryNationalCorporation && capOf(c) > 0)
    .sort((a, b) => capOf(b) - capOf(a))
    .slice(0, 25)
    .map((c) => ({
      name: c.name,
      countryId: c.countryId,
      sector: c.sector,
      marketCap: capOf(c),
      sharePrice: c.sharePrice,
      nationalized: c.isNationalized === true,
    }));

  // ── Markets ─────────────────────────────────────────────────────────────
  const fx = await C("exchangeRates")
    .find({})
    .toArray()
    .catch(() => []);
  const commodities = await C("commodityPrices")
    .find({})
    .toArray()
    .catch(() => []);

  // ── Timeline ────────────────────────────────────────────────────────────
  const events = await C("countryHistory")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          turn: 1,
          eventType: 1,
          title: 1,
          characterName: 1,
          officeType: 1,
          party: 1,
        },
      }
    )
    .sort({ turn: 1 })
    .limit(4000)
    .toArray();

  const npps = await C("npps").countDocuments({ retiredAt: null });
  const cgs = await C("countryGameStates")
    .find({}, { projection: { status: 1, enabledForPlayers: 1, economyPreview: 1 } })
    .toArray();

  const payload = {
    meta: {
      db: dbName,
      turn,
      year: gs?.currentYear,
      preset: gs?.preset,
      preIteration: gs?.preIteration ?? null,
      preIterationTurns: gs?.preIterationTurns ?? 0,
      extractedAt: new Date().toISOString(),
    },
    parties: parties.map((p: any) => ({
      countryId: p.countryId,
      sequentialId: p.sequentialId,
      name: p.name,
      abbr: p.abbreviation,
      color: p.color,
      strength: p.politicalStrength,
      treasury: p.treasury,
      members: p.memberCount,
    })),
    counts: {
      races: races.length,
      resolved: races.filter((r) => r.winnerParty).length,
      officials: officials.length,
      npps,
      corps: corps.length,
    },
    races,
    flips,
    chamber,
    leaders,
    economy,
    topCorps,
    fx: (fx as any[]).map((f) => ({ id: String(f._id), rate: f.rate ?? f.rateToAnchor ?? null })),
    commodities: (commodities as any[]).map((c) => ({ id: String(c._id), price: c.price ?? null })),
    events,
    countryGameStates: (cgs as any[]).map((c) => ({ id: String(c._id), status: c.status })),
  };

  const json = JSON.stringify(payload);
  if (out) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(out, json);
    console.log(
      `wrote ${out} (${(json.length / 1e6).toFixed(2)} MB) — turn ${turn}, ${races.length} races, ${events.length} events`
    );
  } else {
    console.log(json);
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
