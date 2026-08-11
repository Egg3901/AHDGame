/**
 * Checkpoint report generator for the grand world sim.
 *
 * Pulls a checkpoint out of a sim database and emits a self-contained HTML
 * report: a changelog header (what was changed/healed since the last
 * checkpoint and whether it worked), auto-written narrative for the four
 * player countries, and interactive multi-series charts that can be toggled by
 * country group (player / Eastern bloc / market economies) or per country.
 *
 * The output is a single HTML file with the dataset inlined as JSON and the
 * charts drawn client-side in vanilla SVG — no external requests, so it
 * satisfies the ops-dashboard CSP and can be published as-is.
 *
 * Usage:
 *   npx tsx scripts/sim/checkpointReport.ts \
 *     --db=ahd_sim_grand1953 --turn=150 \
 *     --out=/tmp/cp150.html [--changelog=/path/to/changelog.json]
 *
 * `--turn` selects the checkpoint (defaults to the latest snapshot). The
 * changelog file is an optional JSON array of
 *   { title, detail, status: "worked" | "partial" | "failed" | "pending" }
 * entries rendered at the top of the report.
 */
import { MongoClient } from "mongodb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getWorldEntityPresetManifest } from "@/lib/world/worldEntityManifest";
import { readFileSync, writeFileSync } from "node:fs";

// ── Country grouping ────────────────────────────────────────────────────────
/** The four countries playable this iteration — always highlighted. */
const PLAYER: string[] = ["US", "UK", "RU", "DD"];
/** Planned economies of the Eastern bloc (DD and RU are also player countries). */
const BLOC: string[] = ["RU", "DD", "PL", "HU", "CS", "RO", "BG", "YU"];

const NAMES: Record<string, string> = {
  US: "United States",
  UK: "United Kingdom",
  RU: "Soviet Union",
  DD: "East Germany",
  DE: "West Germany",
  JP: "Japan",
  CN: "China",
  BR: "Brazil",
  IE: "Ireland",
  NG: "Nigeria",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  SE: "Sweden",
  TR: "Turkey",
  AT: "Austria",
  FI: "Finland",
  GR: "Greece",
  PL: "Poland",
  HU: "Hungary",
  CS: "Czechoslovakia",
  RO: "Romania",
  BG: "Bulgaria",
  YU: "Yugoslavia",
};

/**
 * Categorical palette — the dataviz reference theme's DARK steps in their FIXED
 * slot order, validated with the skill's `validate_palette.js` against this
 * report's card surface (#161b22):
 *
 *   ALL CHECKS PASS — worst adjacent CVD dE 8.4 (protan) / 24.4 (tritan),
 *   normal-vision floor 19.8, contrast >= 3:1 on every slot.
 *
 * The ORDER is load-bearing. Line charts are validated on the ADJACENT pairlist,
 * so taking slots out of sequence breaks it — an earlier attempt used slots
 * 1,8,4,3 and failed the normal-vision floor at dE 13.0. The player four take
 * slots 1-4 because they are the series this report exists to compare.
 *
 * Past eight series a categorical scale stops discriminating, so there is
 * deliberately NO generated-hue fallback (the previous version cycled four greys
 * across sixteen countries). Every non-player country draws in one recessive
 * neutral and is identified by its end label and the hover readout instead.
 */
const COLORS: Record<string, string> = {
  US: "#3987e5", // slot 1 blue
  UK: "#d95926", // slot 2 orange
  RU: "#199e70", // slot 3 aqua
  DD: "#c98500", // slot 4 yellow
};

/** Every country outside the player four. */
const CONTEXT_COLOR = "#8b949e";

function colorFor(countryId: string): string {
  return COLORS[countryId] ?? CONTEXT_COLOR;
}

/**
 * GDP, revenue, spending and market caps are stored per-country in LOCAL
 * CURRENCY by deliberate design — a Soviet ruble figure and a US dollar figure
 * are not the same unit, and 1953-era French francs or old Deutschmarks are a
 * different order of magnitude again. Any table that lines these numbers up
 * side by side must say which currency each row is actually in rather than
 * implying comparability. Falls back to the country code itself (rather than
 * "USD") when a country has no COUNTRY_CURRENCY_MAP entry, so a gap is visible
 * instead of silently mislabeled.
 */
function currencyFor(countryId: string): string {
  return (COUNTRY_CURRENCY_MAP as Record<string, string>)[countryId] ?? countryId;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

interface ChangelogEntry {
  title: string;
  detail: string;
  status?: "worked" | "partial" | "failed" | "pending";
}

interface CountrySeries {
  turn: number[];
  gdp: number[];
  gdpGrowth: number[];
  inflation: number[];
  interestRate: number[];
  corpRevenue: number[];
}

async function main(): Promise<void> {
  const uri = process.env.SIM_MONGODB_URI;
  if (!uri) throw new Error("SIM_MONGODB_URI is required (point at the sandbox, never prod).");
  const dbName = arg("db") ?? "ahd_sim_grand1953";
  const outPath = arg("out") ?? "/tmp/checkpoint.html";
  const changelogPath = arg("changelog");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // ── Time series ───────────────────────────────────────────────────────────
  const turnArg = arg("turn");
  const maxTurn = turnArg
    ? Number(turnArg)
    : ((
        await db.collection("gameHealthSnapshots").find({}).sort({ turn: -1 }).limit(1).toArray()
      )[0]?.turn ?? 0);

  const snaps = await db
    .collection("gameHealthSnapshots")
    .find({ turn: { $lte: maxTurn } })
    .sort({ turn: 1 })
    .toArray();
  if (snaps.length === 0) throw new Error(`No gameHealthSnapshots at or below turn ${maxTurn}.`);

  const series: Record<string, CountrySeries> = {};
  for (const snap of snaps) {
    const byCountry = (snap.economy?.byCountry ?? {}) as Record<string, Record<string, number>>;
    for (const [cid, cell] of Object.entries(byCountry)) {
      const s = (series[cid] ??= {
        turn: [],
        gdp: [],
        gdpGrowth: [],
        inflation: [],
        interestRate: [],
        corpRevenue: [],
      });
      s.turn.push(snap.turn as number);
      s.gdp.push(cell.gdp ?? 0);
      s.gdpGrowth.push(cell.gdpGrowth ?? 0);
      s.inflation.push(cell.inflation ?? 0);
      s.interestRate.push(cell.interestRate ?? 0);
      s.corpRevenue.push(cell.totalCorporationRevenue ?? 0);
    }
  }

  // Countries present in the economy feed, ordered: players first, then bloc,
  // then everyone else alphabetically. DD is frequently absent from the economy
  // feed (COUNTRY_CONFIGS marks it coming-soon) — surfaced as a gap, not hidden.
  const present = Object.keys(series);
  const ordered = [
    ...PLAYER.filter((c) => present.includes(c)),
    ...BLOC.filter((c) => present.includes(c) && !PLAYER.includes(c)),
    ...present.filter((c) => !PLAYER.includes(c) && !BLOC.includes(c)).sort(),
  ];
  const missingPlayers = PLAYER.filter((c) => !present.includes(c));

  // ── Market cap ────────────────────────────────────────────────────────────
  const mcapRows = await db
    .collection("marketCapHistory")
    .find({ turn: { $lte: maxTurn } })
    .sort({ turn: 1 })
    .toArray();
  const mcap = {
    turn: mcapRows.map((r) => r.turn as number),
    value: mcapRows.map((r) => ((r.globalMarketCap as number) ?? 0) / 1e9),
  };

  // ── Fiscal snapshot ───────────────────────────────────────────────────────
  const budgets = await db.collection("federalBudget").find({}).toArray();
  const fiscal = budgets
    .map((b) => {
      const rev = (b.revenue?.total as number) ?? 0;
      const spend = (b.spending?.total as number) ?? 0;
      const gdp = (b.gdp as number) ?? 0;
      const countryId = String(b.countryId ?? "");
      return {
        countryId,
        currency: currencyFor(countryId),
        gdp,
        revenue: rev,
        spending: spend,
        spendPctGdp: gdp > 0 ? (100 * spend) / gdp : 0,
        deficitPctGdp: gdp > 0 ? (100 * (spend - rev)) / gdp : 0,
        debtToGdp: (b.debtToGdpRatio as number) ?? 0,
        rating: String(b.creditRating ?? "-"),
        crisis: String(b.sovereignCrisisState ?? "-"),
      };
    })
    .filter((f) => f.countryId && f.gdp > 0)
    .sort((a, b) => {
      const ai = PLAYER.indexOf(a.countryId);
      const bi = PLAYER.indexOf(b.countryId);
      if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return b.gdp - a.gdp;
    });

  // ── Activity counters ─────────────────────────────────────────────────────
  const count = async (name: string, q: Record<string, unknown> = {}): Promise<number> => {
    try {
      return await db.collection(name).countDocuments(q);
    } catch {
      return 0;
    }
  };
  const activity = {
    actions: await count("actionAuditLog"),
    laws: await count("enactedLaws"),
    billsSigned: await count("bills", { status: "signed" }),
    billsFailed: await count("bills", { status: "failed" }),
    elections: await count("elections"),
    tallies: await count("electionVoteTallies"),
    officials: await count("electedOfficials"),
    candidates: await count("electionCandidates"),
    trades: await count("shareTradeHistory"),
    orders: await count("shareOrders"),
    corps: await count("corporations"),
    nppCorps: await count("corporations", { ceoType: "npp" }),
    sectors: await count("corporateSectors"),
    unions: await count("unions"),
    unionsLed: await count("unions", { ownerId: { $ne: null } }),
    bonds: await count("bonds"),
    npps: await count("npps"),
    parties: await count("politicalParties"),
    financialTx: await count("financialTxLog"),
  };

  // ── Disasters & crises: did they fire, and did they matter? ───────────────
  // Enabling them is not the same as them having an effect. Both spawners walk
  // `getEnabledCountryIdsFromDb`, which resolved to an EMPTY list while the
  // harness wrote `enabledForPlayers: false`, so a whole run could report every
  // phase completed while producing zero events. Count them, and size their
  // real impact so an event that is too strong or too weak is visible rather
  // than inferred.
  // Only crises that had started by this checkpoint.
  const crisisDocs = await db
    .collection("crises")
    .find({ startTurn: { $lte: maxTurn } })
    .toArray();
  const disasterDocs = await db
    .collection("disasters")
    .find({})
    .toArray()
    .catch(() => [] as Record<string, unknown>[]);

  // Crisis docs key on `name` + a `countryIds` ARRAY — there is no templateId or
  // countryId field, so grouping on those produced a single "unknown" bucket
  // covering every crisis.
  const byTemplate = new Map<
    string,
    { n: number; countries: Set<string>; resolved: number; active: number; totalTurns: number }
  >();
  for (const c of crisisDocs) {
    const key = String(c.name ?? c.autoSource ?? "unnamed");
    const e = byTemplate.get(key) ?? {
      n: 0,
      countries: new Set<string>(),
      resolved: 0,
      active: 0,
      totalTurns: 0,
    };
    e.n++;
    for (const cid of (c.countryIds as string[] | undefined) ?? []) e.countries.add(String(cid));
    if (c.resolvedAt || c.status === "resolved" || c.status === "ended") e.resolved++;
    else e.active++;
    e.totalTurns += (c.durationTurns as number) ?? 0;
    byTemplate.set(key, e);
  }

  // Impact proxy: approval and GDP-growth movement in the turns a crisis was
  // live, against the same country's median outside those turns. A template
  // whose live-turn delta is indistinguishable from background noise is too
  // weak; one that dwarfs every other driver is too strong.
  const crisisImpact = Array.from(byTemplate.entries())
    .map(([template, e]) => ({
      template,
      count: e.n,
      countries: Array.from(e.countries),
      resolved: e.resolved,
      active: e.active,
      avgDuration: e.n > 0 ? Math.round((e.totalTurns / e.n) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Margin variation is a health signal in its own right: if the whole world has
  // only a couple of distinct margins, no sector is responding to costs, wages or
  // competition and the column is decorative.
  const marginSpread = await db
    .collection("corporateSectors")
    .aggregate<{ _id: number; n: number }>([
      { $group: { _id: { $ifNull: ["$effectiveProfitMargin", "$profitMargin"] }, n: { $sum: 1 } } },
    ])
    .toArray();
  // Who actually holds power, over time. The economic series answer "how is the
  // world doing"; they cannot answer "who is governing it", which for the two
  // player democracies is the whole point of the run. parliamentSeatsHistory
  // carries one row per (country, officeType, party, turn), so a control
  // timeline is a group-and-pivot rather than a new snapshot.
  const CONTROL_COUNTRIES = ["US", "UK"];
  // electedOfficials.party holds politicalParties.sequentialId as a STRING, not
  // the ObjectId — so a raw join yields nothing and the timeline renders as
  // "1"/"2", which is unreadable. Map (countryId, sequentialId) -> abbreviation.
  const partyDocs = await db
    .collection("politicalParties")
    .find({}, { projection: { countryId: 1, sequentialId: 1, name: 1, abbreviation: 1 } })
    .toArray();
  const partyName = new Map<string, string>();
  for (const p of partyDocs) {
    const row = p as unknown as Record<string, unknown>;
    partyName.set(
      `${String(row.countryId)}|${String(row.sequentialId)}`,
      String(row.abbreviation || row.name || row.sequentialId)
    );
  }
  const label = (countryId: string, party: string): string =>
    partyName.get(`${countryId}|${party}`) ?? party;
  const seatRows = await db
    .collection("parliamentSeatsHistory")
    .find({ countryId: { $in: CONTROL_COUNTRIES } })
    .sort({ turn: 1 })
    .toArray();
  const controlByOffice = new Map<string, Map<number, Map<string, number>>>();
  for (const r of seatRows) {
    const row = r as unknown as Record<string, unknown>;
    const key = `${String(row.countryId)}|${String(row.officeType)}`;
    if (!controlByOffice.has(key)) controlByOffice.set(key, new Map());
    const byTurn = controlByOffice.get(key)!;
    const t = Number(row.turn);
    if (!byTurn.has(t)) byTurn.set(t, new Map());
    byTurn.get(t)!.set(String(row.party), Number(row.seats) || 0);
  }
  const controlBase = [...controlByOffice.entries()]
    .map(([key, byTurn]) => {
      const [countryId, officeType] = key.split("|");
      const points = [...byTurn.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([turn, parties]) => {
          const total = [...parties.values()].reduce((s, v) => s + v, 0);
          // Tie-break by party key, not just seat count. An exact tie for the
          // top spot (found in this world: UK commons opened on a seeded 150-150
          // Labour/Conservative dead heat) previously left the sort order to
          // Map iteration order, which is insertion order from however Mongo
          // happened to return that turn's rows — so an UNCHANGED tie could
          // report a different "leader" turn to turn, and the control-spell
          // merge below (which keys off that label) read a static tie as 60+
          // spurious alternations. Deterministic tie-break makes an unchanged
          // seat distribution always produce the same leader.
          const ranked = [...parties.entries()].sort(
            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
          );
          const [topPartyRaw, topSeats] = ranked[0] ?? ["—", 0];
          const topParty = label(countryId, topPartyRaw);
          return {
            turn,
            total,
            leader: topParty,
            leaderSeats: topSeats,
            // A plurality is not control. Naming the majority holder separately
            // keeps "largest party" and "governing majority" from being conflated.
            majority: total > 0 && topSeats > total / 2 ? topParty : null,
            parties: Object.fromEntries(
              ranked.slice(0, 6).map(([k, v]) => [label(countryId, k), v])
            ),
          };
        });
      // The renderer only ever shows control SPELLS plus the latest reading, so
      // shipping every turn's full party map is pure payload weight — at 350 turns
      // across six chambers it was a large share of a file that had already passed
      // the publish endpoint's 1MB body limit. Compress here; the client keeps
      // rendering exactly what it did.
      const spells: Array<{ from: number; to: number; who: string }> = [];
      for (const p of points) {
        const who = p.majority ?? `no majority (${p.leader})`;
        const prev = spells[spells.length - 1];
        if (prev && prev.who === who) prev.to = p.turn;
        else spells.push({ from: p.turn, to: p.turn, who });
      }
      // A SEPARATE grouping for counting actual hand-changes. `spells` (above)
      // intentionally splits every majority <-> hung transition, which is right
      // for the detailed history table but wrong for "how many times did
      // control change hands": a party going from an outright majority to a
      // bare plurality (or back) hasn't lost the chamber to the other side,
      // and counting it as an alternation overstates how competitive a chamber
      // really is. handSpells groups by the LEADING party only (majority or
      // not), so only an actual change of which party is on top counts.
      const handSpells: Array<{ from: number; to: number; who: string }> = [];
      for (const p of points) {
        const who = p.majority ?? p.leader;
        const prev = handSpells[handSpells.length - 1];
        if (prev && prev.who === who) prev.to = p.turn;
        else handSpells.push({ from: p.turn, to: p.turn, who });
      }
      const last = points[points.length - 1];
      // The reported chamber TOTAL is a sum of whatever parliamentSeatsHistory
      // rows exist for that turn, not a read of a fixed chamber-size constant —
      // so if the underlying seat accounting is unstable (a real bug found in
      // this world's US Senate: 96 -> 128 -> 77 -> 85 -> 97 across the run), the
      // instability is real data, not a display artifact. Surface the observed
      // range so a reader distrusts "N of total seats" appropriately instead of
      // taking a snapshot total at face value.
      const totals = points.map((p) => p.total);
      const totalRange = { min: Math.min(...totals), max: Math.max(...totals) };
      return {
        countryId,
        officeType,
        handSpells,
        spells,
        observed: points.length,
        firstTurn: points[0]?.turn ?? 0,
        totalRange,
        last: {
          turn: last.turn,
          total: last.total,
          leader: last.leader,
          leaderSeats: last.leaderSeats,
          majority: last.majority,
        },
      };
    })
    .filter((c) => c.spells.length > 0);

  // NOTE on the presidency: it might look like electedOfficials-derived data
  // can't cover it (that collection keeps only the CURRENT officeholder, one
  // doc, overwritten each term) — but parliamentSeatsHistory already snapshots
  // EVERY officeType found in electedOfficials once per turn, president and
  // vicePresident included (with seats pinned to 1). So controlBase above
  // already carries a genuine, accurate per-turn president timeline — it does
  // not need to be reconstructed from `elections` here. An earlier version of
  // this rebuilt it from resolved elections instead, which (a) duplicated the
  // existing entry and (b) was WRONG: it only starts at the first tracked
  // election's turn, so it missed the initial seeded officeholder and
  // undercounted this world's one real alternation (R at the turn-2 seed ->
  // D at turn 192, the first resolved election) as zero. Trust the snapshot
  // table; do not rebuild office timelines from a different source when one
  // already exists.

  // Race-level context for the alternation section: were the individual
  // contests actually close, or was the winning side's control a single
  // landslide? A chamber that never changes hands could be either — the
  // distinction is the whole diagnostic value of this section.
  interface RaceContext {
    races: number;
    medianMarginPct: number;
    dominantParty: string | null;
    dominantSharePct: number;
  }
  async function raceContext(countryId: string, electionType: string): Promise<RaceContext | null> {
    const elecIds = (
      await db
        .collection("elections")
        .find({ countryId, electionType, status: "resolved" }, { projection: { _id: 1 } })
        .toArray()
    ).map((e) => e._id);
    if (elecIds.length === 0) return null;
    const tallies = await db
      .collection("electionVoteTallies")
      .find({ electionId: { $in: elecIds } })
      .toArray();
    const margins: number[] = [];
    const wins = new Map<string, number>();
    for (const t of tallies) {
      const tv = (t.totalVotes ?? {}) as Record<string, number>;
      const parties = (t.candidateParties ?? {}) as Record<string, string>;
      const keys = Object.keys(tv);
      if (keys.length < 2) continue;
      const total = keys.reduce((s, k) => s + (tv[k] || 0), 0);
      if (total <= 0) continue;
      keys.sort((a, b) => (tv[b] || 0) - (tv[a] || 0));
      margins.push((100 * ((tv[keys[0]] || 0) - (tv[keys[1]] || 0))) / total);
      const winParty = parties[keys[0]];
      wins.set(winParty, (wins.get(winParty) ?? 0) + 1);
    }
    if (margins.length === 0) return null;
    margins.sort((a, b) => a - b);
    let domParty: string | null = null;
    let domCount = 0;
    for (const [p, n] of wins) {
      if (n > domCount) {
        domParty = p;
        domCount = n;
      }
    }
    return {
      races: margins.length,
      medianMarginPct: Math.round(margins[Math.floor(margins.length / 2)] * 10) / 10,
      dominantParty: domParty ? label(countryId, domParty) : null,
      dominantSharePct: Math.round((1000 * domCount) / margins.length) / 10,
    };
  }

  // Alternation stats + a grounded, generated diagnosis for any chamber that
  // never changed hands. This is deliberately built from the SAME spells the
  // "Who holds power" table already renders, per-officeType, so the two
  // sections can never disagree with each other.
  const control: Array<
    Omit<(typeof controlBase)[number], "handSpells"> & {
      alternations: number;
      avgSpellTurns: number;
      avgSpellYears: number;
      raceContext: RaceContext | null;
      diagnosis: string | null;
    }
  > = [];
  for (const c of controlBase) {
    // Hand-changes, not display spells: see handSpells' definition above for
    // why a majority<->hung wobble by the same party must not count here.
    const alternations = c.handSpells.length - 1;
    const observedTurns = c.last.turn - c.firstTurn + 1;
    const avgSpellTurns = c.handSpells.length > 0 ? observedTurns / c.handSpells.length : 0;
    const ctx = await raceContext(c.countryId, c.officeType);
    let diagnosis: string | null = null;
    if (alternations === 0) {
      const yrs = Math.round((observedTurns / TURNS_PER_YEAR) * 10) / 10;
      if (!ctx) {
        diagnosis = `No control change across ${observedTurns} observed turns (~${yrs} years) — no resolved-election data was found to diagnose why.`;
      } else if (ctx.races >= 4 && ctx.medianMarginPct < 15 && ctx.dominantSharePct > 55) {
        diagnosis =
          `No control change across ${observedTurns} observed turns (~${yrs} years). Individual races were ` +
          `close (median winning margin ${ctx.medianMarginPct.toFixed(1)}pt over ${ctx.races} contests), but ` +
          `${ctx.dominantParty} still won ${ctx.dominantSharePct.toFixed(0)}% of them, cycle after cycle — a ` +
          `persistent per-race tilt compounding every election, not one big landslide.`;
      } else {
        diagnosis =
          `No control change across ${observedTurns} observed turns (~${yrs} years). ${ctx.dominantParty} won ` +
          `${ctx.dominantSharePct.toFixed(0)}% of ${ctx.races} tracked races at a median margin of ` +
          `${ctx.medianMarginPct.toFixed(1)} points — a landslide, not a close call.`;
      }
    }
    // handSpells was only needed to compute alternations/avgSpellTurns above —
    // drop it before shipping so the payload doesn't carry two overlapping
    // spell lists for the same office.
    const { handSpells: _handSpells, ...rest } = c;
    control.push({
      ...rest,
      alternations,
      avgSpellTurns: Math.round(avgSpellTurns * 10) / 10,
      avgSpellYears: Math.round((avgSpellTurns / TURNS_PER_YEAR) * 10) / 10,
      raceContext: ctx,
      diagnosis,
    });
  }

  // Governors: sub-national executive control, counted per country per party.
  const govRows = await db
    .collection("electedOfficials")
    .aggregate<{ _id: { countryId: string; party: string }; n: number }>([
      { $match: { officeType: { $regex: /governor/i } } },
      {
        $group: {
          _id: {
            countryId: { $ifNull: ["$countryId", "US"] },
            party: { $ifNull: ["$party", "independent"] },
          },
          n: { $sum: { $ifNull: ["$seatsHeld", 1] } },
        },
      },
    ])
    .toArray();
  const governors = govRows
    .map((g) => ({
      countryId: g._id.countryId,
      party: label(g._id.countryId, g._id.party),
      n: g.n,
    }))
    .sort((a, b) => b.n - a.n);

  // The corporation table's margin is BOOK margin (income/revenue), which the
  // run-1 postmortem showed is misleading on its own: negative book income
  // beside rising cash is a dividend and depreciation artefact, not distress.
  // The operating margin the engine actually computes and persists per sector
  // is effectiveProfitMargin, so summarise that too and say which is which.
  const effRows = await db
    .collection("corporateSectors")
    .find({ effectiveProfitMargin: { $type: "number" } })
    .project<{ effectiveProfitMargin: number }>({ effectiveProfitMargin: 1 })
    .toArray();
  const effVals = effRows.map((r) => r.effectiveProfitMargin).filter((v) => Number.isFinite(v));
  const operating = effVals.length
    ? {
        n: effVals.length,
        min: Math.min(...effVals),
        max: Math.max(...effVals),
        mean: effVals.reduce((a, b) => a + b, 0) / effVals.length,
        negativeShare: (100 * effVals.filter((v) => v < 0).length) / effVals.length,
      }
    : null;
  const marginVariation = {
    distinctValues: marginSpread.length,
    breakdown: marginSpread.sort((a, b) => b.n - a.n).slice(0, 6),
    operating,
  };

  const events = {
    crises: crisisDocs.length,
    disasters: disasterDocs.length,
    crisisImpact,
    // Aid bills are the only crisis response an NPP can actually reach: the
    // decision-tree interaction engine is character-only (deriveCharacterRoles /
    // pmCharacterId), so in an NPP-only world it is inert by construction.
    aidBills: await count("bills", { legislationTypeId: { $regex: /aid|relief|emergency/i } }),
  };

  // ── Money supply per country ──────────────────────────────────────────────
  // Gated on moneySupplyEnabled. The inflation model reads moneySupplyGrowthPct
  // and degrades it to gdpGrowth when absent — which makes the money-supply term
  // exactly zero, so a missing monetary layer looks like a calm economy rather
  // than a disabled subsystem. Report M1/M2 and M2 growth per country so the
  // channel is visibly alive or visibly dead.
  //
  // Only the LATEST reading per country is ever rendered (a single table row,
  // no chart), so pulling every historical turn into the payload was pure
  // weight with no reader benefit: at this checkpoint it was 685KB of a
  // 978KB file — by far the single largest contributor, and enough on its own
  // to push the report over the publish endpoint's ~1MB limit. Aggregate to
  // the latest row per country in Mongo instead of inlining the whole history.
  const msLatestRows = await db
    .collection("moneySupplySnapshots")
    .aggregate<{ _id: string; turn: number; m1: number; m2: number; growth: number }>([
      { $match: { turn: { $lte: maxTurn } } },
      { $sort: { turn: -1 } },
      {
        $group: {
          _id: "$countryId",
          turn: { $first: "$turn" },
          m1: { $first: "$m1" },
          m2: { $first: "$m2" },
          growth: { $first: "$annualizedM2GrowthPct" },
        },
      },
    ])
    .toArray();
  const moneyByCountry: Record<
    string,
    { turn: number; m1: number; m2: number; growth: number; currency: string }
  > = {};
  for (const r of msLatestRows) {
    const cid = String(r._id ?? "");
    if (!cid) continue;
    moneyByCountry[cid] = {
      turn: (r.turn as number) ?? maxTurn,
      m1: (r.m1 as number) ?? 0,
      m2: (r.m2 as number) ?? 0,
      growth: (r.growth as number) ?? 0,
      currency: currencyFor(cid),
    };
  }
  const money = {
    enabled: msLatestRows.length > 0,
    countries: Object.keys(moneyByCountry).sort(),
    byCountry: moneyByCountry,
  };

  // ── Corporate movers (as of THIS checkpoint) ─────────────────────────────
  // Read corporationHistory at the target turn, NOT the live corporations
  // collection. The live collection only ever describes the END of the run, so
  // sourcing it here made every checkpoint in a series show identical figures —
  // which hid the single biggest finding of this run (395 firms at t75 down to
  // 88 by t1001, with nothing flagged defunct).
  const corpHistRows = await db.collection("corporationHistory").find({ turn: maxTurn }).toArray();
  const corpMeta = await db
    .collection("corporations")
    .find({}, { projection: { name: 1, countryId: 1, type: 1, ceoType: 1 } })
    .toArray();
  const metaById = new Map(corpMeta.map((c) => [String(c._id), c]));

  const liveCorps = corpHistRows.map((r) => {
    const meta = metaById.get(String(r.corporationId));
    const countryId = String(meta?.countryId ?? "");
    return {
      name: String(meta?.name ?? "(dissolved)"),
      countryId,
      currency: currencyFor(countryId),
      type: String(meta?.type ?? ""),
      mcap: (r.marketCap as number) ?? 0,
      // corporationHistory.revenue/income are PER-TURN flows; marketCap is a
      // stock. Printing them side by side made every firm look ~48x smaller
      // than it is — Metro News read as 0.03M revenue against an 8.6M market
      // cap, a price/sales of 287, and the whole table read as an economy of
      // microscopic companies that could never expand. Annualise the flows so
      // the two columns are on comparable scales (its sectors really turn over
      // 1.32M a year at a 46% margin).
      revenue: ((r.revenue as number) ?? 0) * TURNS_PER_YEAR,
      income: ((r.income as number) ?? 0) * TURNS_PER_YEAR,
      margin:
        (r.revenue as number) > 0 ? (100 * ((r.income as number) ?? 0)) / (r.revenue as number) : 0,
      rating: String(r.creditRating ?? "-"),
      nppRun: meta?.ceoType === "npp",
    };
  });

  const rank = (list: typeof liveCorps) => [...list].sort((a, b) => b.mcap - a.mcap);
  const corporate = {
    // Firm COUNT at this checkpoint — the headline series.
    total: corpHistRows.length,
    liveNow: corpMeta.length,
    byPlayerCountry: Object.fromEntries(
      PLAYER.map((cid) => [cid, rank(liveCorps.filter((c) => c.countryId === cid)).slice(0, 6)])
    ),
    elsewhere: rank(liveCorps.filter((c) => !PLAYER.includes(c.countryId))).slice(0, 8),
    // Firm count per country at this turn, so a collapse is attributable.
    countByCountry: Object.entries(
      liveCorps.reduce<Record<string, number>>((acc, c) => {
        if (c.countryId) acc[c.countryId] = (acc[c.countryId] ?? 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]),
  };

  // ── Engine health ─────────────────────────────────────────────────────────
  const last = snaps[snaps.length - 1];
  const health = {
    turn: last.turn as number,
    year: (last.year as number) ?? null,
    errors: snaps.reduce((n, s) => n + ((s.turnProcessing?.errorCount as number) ?? 0), 0),
    warnings: snaps.reduce((n, s) => n + ((s.turnProcessing?.warningCount as number) ?? 0), 0),
    phases: (last.turnProcessing?.phaseCount as number) ?? 0,
    medianTurnMs: median(
      snaps.map((s) => (s.turnProcessing?.durationMs as number) ?? 0).filter((v) => v > 0)
    ),
    issues: ((last.dataIntegrity?.issues ?? []) as Array<Record<string, string>>).map((i) => ({
      category: String(i.category),
      severity: String(i.severity),
      message: String(i.message ?? "").slice(0, 200),
    })),
    npps: (last.population?.totalNPPs as number) ?? 0,
  };

  // ── Market mode / guard ───────────────────────────────────────────────────
  const cfg = (await db.collection("gameConfig").findOne({ _id: "default" as never })) ?? {};
  const guardLog = await db
    .collection("adminLogs")
    .find({ action: "market_system_auto_reverted" })
    .toArray();
  const market = {
    mode: String((cfg as Record<string, unknown>).marketSystemMode ?? "?"),
    guardEnabled: (cfg as Record<string, unknown>).marketGuardEnabled === true,
    updatedBy: String((cfg as Record<string, unknown>).marketSystemModeUpdatedBy ?? "-"),
    trips: guardLog.length,
    tripDetail: guardLog.length ? String(guardLog[0].details ?? "").slice(0, 300) : null,
  };

  // ── Seed-audit inputs: income-band index + zero-growth-target coverage ────
  // gameState._id:"current" carries incomeBandIndexByCountry once the era system
  // is on; runSeedAudit's A2 check is the single highest-yield check this report
  // can run, so it must be WIRED, not merely defined.
  const gameStateDoc =
    (await db.collection("gameState").findOne({ _id: "current" as never })) ?? {};
  const bandIndex =
    ((gameStateDoc as Record<string, unknown>).incomeBandIndexByCountry as
      Record<string, number> | undefined) ?? {};
  const growthRows = await db
    .collection("corporateSectors")
    .aggregate<{ _id: string; zero: number; total: number }>([
      {
        $group: {
          _id: "$countryId",
          zero: { $sum: { $cond: [{ $eq: ["$targetGrowthRate", 0] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const zeroGrowthByCountry: Record<string, { zero: number; total: number }> = {};
  for (const r of growthRows) zeroGrowthByCountry[String(r._id)] = { zero: r.zero, total: r.total };

  // ── Seed-audit inputs, part 2: the world-manifest-derived expected country
  // set, per-collection coverage counts, and per-turn fiscal snapshot series.
  //
  // The manifest — not a hardcoded roster — is the source of truth for "which
  // countries should have a corporate economy, a legislature, a labour market".
  // A hardcoded list is exactly how nine countries with zero corporate sectors
  // went unnoticed for two full runs: whoever wrote the list didn't think to
  // include them, so absence of a row and absence from the check were the same
  // blind spot. getWorldEntityPresetManifest(preset) is the same manifest
  // seedCountryGameStates.ts uses to decide who gets a countryGameStates row,
  // so "full-autonomous" here means the same thing it means everywhere else in
  // the codebase.
  const presetId = String((gameStateDoc as Record<string, unknown>).preset ?? "");
  let expectedCountries: string[] = [];
  try {
    if (presetId) {
      const manifest = getWorldEntityPresetManifest(presetId);
      expectedCountries = manifest.entries
        .filter((e) => e.simulationTier === "full-autonomous" && e.countryId)
        .map((e) => e.countryId as string)
        .sort();
    }
  } catch {
    // Unknown/unset preset — the audit will note this as "not examined"
    // rather than silently checking an empty or wrong roster.
    expectedCountries = [];
  }

  // Per-(collection, countryId) row counts for the absence/coverage checks.
  // A $group with no match for a country produces NO row at all — which is
  // exactly the failure mode this exists to defend against, so every lookup
  // below must default a missing entry to 0 rather than skip it.
  const countsByCountry = async (collection: string): Promise<Record<string, number>> => {
    try {
      const rows = await db
        .collection(collection)
        .aggregate<{ _id: string; n: number }>([{ $group: { _id: "$countryId", n: { $sum: 1 } } }])
        .toArray();
      const out: Record<string, number> = {};
      for (const r of rows) if (r._id) out[String(r._id)] = r.n;
      return out;
    } catch {
      return {};
    }
  };
  // NOTE: "regional budgets" and "demographics" read from the STATE-level
  // collections (stateBudgets / stateDemographics), not the similarly-named
  // regionalBudgets / regionDemographics — those two are populated for only a
  // handful of countries (UK/RU/DE/JP/CN) by an unrelated subsystem and would
  // misreport as absence everywhere else. stateBudgets/stateDemographics are
  // the ones every country actually gets one row per state in.
  const COVERAGE_COLLECTIONS = [
    "corporateSectors",
    "corporations",
    "unions",
    "electedOfficials",
    "politicalParties",
    "elections",
    "enactedLaws",
    "moneySupplySnapshots",
    "stateBudgets",
    "stateDemographics",
  ] as const;
  const coverageCounts: Record<string, Record<string, number>> = {};
  for (const collection of COVERAGE_COLLECTIONS) {
    coverageCounts[collection] = await countsByCountry(collection);
  }

  // Per-country fiscal-year time series for the staleness/trajectory checks.
  // federalBudgetSnapshots carries one row per (country, fiscal year) — small
  // enough (dozens of rows/country over a long run) to inline in full rather
  // than aggregate away, since a trajectory check needs every point, not a
  // summary of them.
  const budgetSnapRows = await db
    .collection("federalBudgetSnapshots")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          turn: 1,
          "budget.gdp": 1,
          "budget.debtToGdpRatio": 1,
          "budget.spending.total": 1,
        },
      }
    )
    .sort({ turn: 1 })
    .toArray();
  const budgetSnapshotSeries: Record<
    string,
    { turn: number[]; gdp: number[]; debtToGdp: number[]; spendTotal: number[] }
  > = {};
  for (const r of budgetSnapRows) {
    const cid = String(r.countryId ?? "");
    if (!cid) continue;
    const b = (r.budget ?? {}) as Record<string, unknown>;
    const s = (budgetSnapshotSeries[cid] ??= { turn: [], gdp: [], debtToGdp: [], spendTotal: [] });
    s.turn.push(r.turn as number);
    s.gdp.push((b.gdp as number) ?? 0);
    s.debtToGdp.push((b.debtToGdpRatio as number) ?? 0);
    s.spendTotal.push(((b.spending as Record<string, unknown> | undefined)?.total as number) ?? 0);
  }

  const auditResult = runSeedAudit({
    players: PLAYER,
    series,
    fiscal,
    bandIndex,
    flags: cfg as Record<string, unknown>,
    zeroGrowthByCountry,
    presetId,
    expectedCountries,
    coverageCounts,
    budgetSnapshotSeries,
  });
  const auditFindings = auditResult.findings;
  const auditSelfCheck = auditResult.selfCheck;

  // ── Command economies: the economicFactors dial nobody was reading ────────
  // federalBudget.economicFactors carries marketizationLevel, shortageIndex,
  // monetaryOverhang, blackMarketPremium, governmentReformism and
  // internalRepression per bloc country, but only the LIVE (current) value —
  // federalBudgetSnapshots keeps one row per fiscal year per country (roughly
  // every ~48 turns), which is where the actual history lives. Small (~14
  // points/country), so inlined in full rather than strided.
  const COMMAND_FIELDS = [
    "marketizationLevel",
    "shortageIndex",
    "monetaryOverhang",
    "blackMarketPremium",
    "governmentReformism",
    "internalRepression",
  ] as const;
  const cmdRows = await db
    .collection("federalBudgetSnapshots")
    .find({ countryId: { $in: BLOC }, turn: { $lte: maxTurn } })
    .sort({ turn: 1 })
    .toArray();
  const commandByCountry: Record<
    string,
    { turn: number[] } & Record<(typeof COMMAND_FIELDS)[number], number[]>
  > = {};
  for (const r of cmdRows) {
    const cid = String(r.countryId ?? "");
    if (!cid) continue;
    const ef = ((r.budget as Record<string, unknown> | undefined)?.economicFactors ?? {}) as Record<
      string,
      number
    >;
    // Turn 1's seed snapshot predates the command-economy dials — only start a
    // country's series once a field is actually present, rather than padding
    // with a fabricated zero that would misread as "marketized at genesis".
    if (ef.marketizationLevel === undefined && ef.shortageIndex === undefined) continue;
    const c = (commandByCountry[cid] ??= {
      turn: [],
      marketizationLevel: [],
      shortageIndex: [],
      monetaryOverhang: [],
      blackMarketPremium: [],
      governmentReformism: [],
      internalRepression: [],
    });
    c.turn.push(r.turn as number);
    for (const f of COMMAND_FIELDS) c[f].push((ef[f] as number) ?? 0);
  }
  // A country whose marketizationLevel decays to 0 and never leaves it is not
  // "reformed" — run2 diagnosed this as a one-sided pull: the frozen party
  // charter (weight 0.6 x -5) outweighs the live Gosbank channel's +0.4 cap, so
  // the dial can structurally never clear zero once it gets there. Surface it
  // per-country so the reader does not mistake a stuck floor for a settled state.
  const marketizationStuck = Object.entries(commandByCountry)
    .filter(([, c]) => {
      const n = c.marketizationLevel.length;
      return n >= 3 && c.marketizationLevel.slice(-3).every((v) => v === 0);
    })
    .map(([cid]) => cid);
  const commandEconomy = {
    countries: Object.keys(commandByCountry).sort(),
    byCountry: commandByCountry,
    marketizationStuck,
  };

  // ── SCOTUS: docket cases decided vs pending, affirmed vs diverged ─────────
  // Small (dozens of rows across the run) — inline the full list rather than
  // aggregating it away, since the case-by-case detail is the point.
  const docketRows = await db
    .collection("docketCases")
    .find(
      {},
      { projection: { title: 1, axis: 1, status: 1, outcome: 1, decidedAtTurn: 1, countryId: 1 } }
    )
    .toArray();
  const scotus = {
    total: docketRows.length,
    decided: docketRows.filter((d) => d.status === "decided").length,
    pending: docketRows.filter((d) => d.status === "pending").length,
    affirmed: docketRows.filter((d) => d.outcome === "affirmed").length,
    diverged: docketRows.filter((d) => d.outcome === "diverged").length,
    cases: docketRows
      .map((d) => ({
        title: String(d.title ?? ""),
        countryId: String(d.countryId ?? ""),
        axis: String(d.axis ?? ""),
        status: String(d.status ?? ""),
        outcome: d.outcome ? String(d.outcome) : null,
        decidedAtTurn: (d.decidedAtTurn as number) ?? null,
      }))
      .sort((a, b) => (a.decidedAtTurn ?? 1e9) - (b.decidedAtTurn ?? 1e9)),
  };

  // ── Labour: unionization, wage demands, strikes ───────────────────────────
  // ADR-5 seeded every union at membershipPressure 20 (its organizing
  // threshold). A world-wide 0 is not "still organizing" — it is a live
  // discrepancy from that seed, and run2 traced the accompanying zero-strikes
  // reading to strikeCallCost exceeding dues income, not to labour peace.
  const unionRows = await db
    .collection("unions")
    .find(
      {},
      {
        projection: {
          countryId: 1,
          membershipPressure: 1,
          demandedWageLevel: 1,
          lastCalledStrikeTurn: 1,
          ownerId: 1,
          treasury: 1,
        },
      }
    )
    .toArray();
  const pressureVals = unionRows.map((u) => (u.membershipPressure as number) ?? 0);
  const wageVals = unionRows
    .map((u) => u.demandedWageLevel as number | null)
    .filter((v): v is number => typeof v === "number");
  const wageHistogram = histogramBins(wageVals, 8);
  const unionizationRows = await db
    .collection("corporateSectors")
    .aggregate<{ _id: number; n: number }>([
      { $group: { _id: { $ifNull: ["$unionization", 0] }, n: { $sum: 1 } } },
    ])
    .toArray();
  const totalSectorsForUnionization = unionizationRows.reduce((s, r) => s + r.n, 0);
  const labour = {
    unions: unionRows.length,
    led: unionRows.filter((u) => u.ownerId != null).length,
    strikes: unionRows.filter((u) => u.lastCalledStrikeTurn != null).length,
    wageDemandsSet: wageVals.length,
    pressureAllZero: pressureVals.length > 0 && pressureVals.every((v) => v === 0),
    wageHistogram,
    unionizationZeroShare:
      totalSectorsForUnionization > 0
        ? (100 * (unionizationRows.find((r) => r._id === 0)?.n ?? 0)) / totalSectorsForUnionization
        : 0,
    unionizationBreakdown: unionizationRows.sort((a, b) => b.n - a.n).slice(0, 8),
  };

  // ── Demography: age pyramid + median age, summed to country level ─────────
  // regionDemographics is one doc per SUB-national region (US states, RU
  // regions, ...) keyed by that region's own code, with a countryId field —
  // there is no separate country-level rollup, so summing every region for a
  // country is the only way to get a national pyramid. This is a CURRENT-STATE
  // read (no historized age series exists), so it describes the population as
  // of this checkpoint's turn, not its arc.
  const regionRows = await db
    .collection("regionDemographics")
    .find({}, { projection: { countryId: 1, ages: 1 } })
    .toArray();
  const demoByCountry: Record<string, { male: number[]; female: number[] }> = {};
  for (const r of regionRows) {
    const cid = String(r.countryId ?? "");
    if (!cid) continue;
    const ages = (r.ages ?? {}) as { male?: number[]; female?: number[] };
    const d = (demoByCountry[cid] ??= { male: [], female: [] });
    const addInto = (target: number[], src: number[] | undefined) => {
      if (!src) return;
      for (let i = 0; i < src.length; i++) target[i] = (target[i] ?? 0) + (src[i] ?? 0);
    };
    addInto(d.male, ages.male);
    addInto(d.female, ages.female);
  }
  const demography = {
    countries: Object.keys(demoByCountry).sort(),
    byCountry: Object.fromEntries(
      Object.entries(demoByCountry).map(([cid, d]) => {
        const total = [...d.male, ...d.female].reduce((s, v) => s + v, 0);
        const n = Math.max(d.male.length, d.female.length);
        let cum = 0;
        let medianAge = 0;
        for (let age = 0; age < n; age++) {
          cum += (d.male[age] ?? 0) + (d.female[age] ?? 0);
          if (cum >= total / 2) {
            medianAge = age;
            break;
          }
        }
        return [cid, { male: d.male, female: d.female, total, medianAge }];
      })
    ),
  };

  // ── Corporate additions: firm-count trend, sector composition, consolidation
  // corporationHistory is per-turn per-corp (236k+ rows over a long run) — a
  // firm-count TREND needs it sampled at a handful of turns, not every turn.
  const CORP_TREND_POINTS = 24;
  const corpTrendStride = Math.max(1, Math.ceil(maxTurn / CORP_TREND_POINTS));
  const corpTrendTurns: number[] = [];
  for (let t = corpTrendStride; t <= maxTurn; t += corpTrendStride) corpTrendTurns.push(t);
  if (corpTrendTurns[corpTrendTurns.length - 1] !== maxTurn) corpTrendTurns.push(maxTurn);
  const corpTrend = {
    turn: [] as number[],
    firms: [] as number[],
    avgLiquid: [] as number[],
    negativeShare: [] as number[],
  };
  for (const t of corpTrendTurns) {
    const agg = (
      await db
        .collection("corporationHistory")
        .aggregate<{ n: number; liq: number; neg: number }>([
          { $match: { turn: t } },
          {
            $group: {
              _id: null,
              n: { $sum: 1 },
              liq: { $avg: "$liquidCapital" },
              neg: { $sum: { $cond: [{ $lt: ["$income", 0] }, 1, 0] } },
            },
          },
        ])
        .toArray()
    )[0];
    if (!agg) continue;
    corpTrend.turn.push(t);
    corpTrend.firms.push(agg.n);
    corpTrend.avgLiquid.push(agg.liq ?? 0);
    corpTrend.negativeShare.push(agg.n > 0 ? (100 * agg.neg) / agg.n : 0);
  }
  const sectorCompRows = await db
    .collection("corporateSectors")
    .aggregate<{ _id: { c: string; s: string }; n: number; workers: number }>([
      { $match: { countryId: { $in: PLAYER } } },
      {
        $group: {
          _id: { c: "$countryId", s: "$sectorType" },
          n: { $sum: 1 },
          workers: { $sum: "$workers" },
        },
      },
    ])
    .toArray();
  const sectorComposition = sectorCompRows.map((r) => ({
    countryId: r._id.c,
    sectorType: r._id.s,
    n: r.n,
    workers: r.workers,
  }));
  // Margin distribution as an actual histogram, not just top-N distinct values.
  const marginHistogram = histogramBins(effVals, 10);
  // Consolidation: what share of each player country's TOTAL mcap the top 3
  // firms hold. High and rising is consolidation; the corp table alone cannot
  // show this because it only ever lists the top 6 by mcap, never the ratio.
  // Command-economy state enterprises are not exchange-traded, so their mcap
  // is structurally 0 — a "0% concentration" bar there would misread as
  // fragmentation rather than "this metric does not apply". Only include
  // countries with a non-zero total market cap.
  const consolidation = PLAYER.map((cid) => {
    const all = rank(liveCorps.filter((c) => c.countryId === cid));
    const total = all.reduce((s, c) => s + c.mcap, 0);
    const top3 = all.slice(0, 3).reduce((s, c) => s + c.mcap, 0);
    return {
      countryId: cid,
      firms: all.length,
      top3SharePct: total > 0 ? (100 * top3) / total : 0,
      total,
    };
  }).filter((c) => c.firms > 0 && c.total > 0);

  // ── Money supply per-country TREND (not just the latest reading) ─────────
  // moneySupplySnapshots has one row per (turn, country, bank) — sum across
  // banks per turn. Per the money-supply instrumentation-gap finding, M2 for
  // most countries is dominated by externalBroadMoney, a SEEDED CONSTANT — so
  // annualizedM2GrowthPct is not a real monetary signal there; it is exogenous
  // and frozen. Flag any country where that one field is >=95% of M2 so a
  // reader does not mistake the resulting flat/spiky growth line for policy.
  const msRows = await db
    .collection("moneySupplySnapshots")
    .aggregate<{
      _id: { c: string; t: number };
      m1: number;
      m2: number;
      growth: number;
      ext: number;
    }>([
      { $match: { countryId: { $in: [...PLAYER, ...BLOC] }, turn: { $lte: maxTurn } } },
      {
        $group: {
          _id: { c: "$countryId", t: "$turn" },
          m1: { $sum: "$m1" },
          m2: { $sum: "$m2" },
          growth: { $avg: "$annualizedM2GrowthPct" },
          ext: { $sum: "$externalBroadMoney" },
        },
      },
      { $sort: { "_id.t": 1 } },
    ])
    .toArray();
  const moneyTrendByCountry: Record<
    string,
    { turn: number[]; m1: number[]; m2: number[]; growth: number[] }
  > = {};
  const extShareByCountry: Record<string, number[]> = {};
  for (const r of msRows) {
    const cid = r._id.c;
    const t = (moneyTrendByCountry[cid] ??= { turn: [], m1: [], m2: [], growth: [] });
    t.turn.push(r._id.t);
    t.m1.push(r.m1 ?? 0);
    t.m2.push(r.m2 ?? 0);
    t.growth.push(r.growth ?? 0);
    (extShareByCountry[cid] ??= []).push(r.m2 > 0 ? (100 * (r.ext ?? 0)) / r.m2 : 0);
  }
  const MAX_MONEY_POINTS = 220;
  for (const t of Object.values(moneyTrendByCountry)) {
    const n = t.turn.length;
    if (n <= MAX_MONEY_POINTS) continue;
    const stride = Math.ceil(n / MAX_MONEY_POINTS);
    const keep = (arr: number[]): number[] => {
      const out = arr.filter((_, i) => i % stride === 0);
      if (arr.length && out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
      return out;
    };
    t.turn = keep(t.turn);
    t.m1 = keep(t.m1);
    t.m2 = keep(t.m2);
    t.growth = keep(t.growth);
  }
  const exogenousMoney = Object.entries(extShareByCountry)
    .map(([cid, shares]) => ({
      countryId: cid,
      avgSharePct: shares.reduce((s, v) => s + v, 0) / shares.length,
    }))
    .filter((c) => c.avgSharePct >= 95)
    .map((c) => c.countryId);
  // Six bloc countries carry no moneySupplySnapshots row at all — not a small
  // reading, an absent one. Worth naming the same way missingPlayers is: a
  // gap in instrumentation, not a calm monetary system.
  const missingMoneySupply = BLOC.filter((c) => !moneyTrendByCountry[c]);
  const moneyTrend = {
    countries: Object.keys(moneyTrendByCountry).sort(),
    byCountry: moneyTrendByCountry,
    exogenousMoney,
    missingMoneySupply,
  };

  // ── Political additions: winning-margin distribution, seat share over time,
  // bills introduced vs enacted ───────────────────────────────────────────
  const marginRows = await db
    .collection("electionVoteTallies")
    .aggregate<{ tv: Record<string, number> }>([
      { $match: {} },
      { $project: { tv: "$totalVotes" } },
    ])
    .toArray();
  const winMargins: number[] = [];
  for (const row of marginRows) {
    const tv = (row.tv ?? {}) as Record<string, number>;
    const keys = Object.keys(tv);
    if (keys.length < 2) continue;
    const total = keys.reduce((s, k) => s + (tv[k] || 0), 0);
    if (total <= 0) continue;
    keys.sort((a, b) => (tv[b] || 0) - (tv[a] || 0));
    winMargins.push((100 * ((tv[keys[0]] || 0) - (tv[keys[1]] || 0))) / total);
  }
  const marginHistogramPolitical = histogramBins(winMargins, 10, 0, 100);

  // Seat share over time for the three legislative chambers readers actually
  // track (single-holder offices like president/governor don't have a
  // meaningful "share" to stack). Sampled at a handful of checkpoints — a
  // continuous per-turn stack is more precision than a bar chart can show
  // anyway.
  const SEAT_SHARE_OFFICES = ["house", "senate", "commons"];
  const seatShareSeatRows = await db
    .collection("parliamentSeatsHistory")
    .find({ countryId: { $in: CONTROL_COUNTRIES }, officeType: { $in: SEAT_SHARE_OFFICES } })
    .sort({ turn: 1 })
    .toArray();
  const seatShareRaw = new Map<string, Map<number, Map<string, number>>>();
  for (const r of seatShareSeatRows) {
    const row = r as unknown as Record<string, unknown>;
    const key = `${String(row.countryId)}|${String(row.officeType)}`;
    if (!seatShareRaw.has(key)) seatShareRaw.set(key, new Map());
    const byTurn = seatShareRaw.get(key)!;
    const t = Number(row.turn);
    if (!byTurn.has(t)) byTurn.set(t, new Map());
    byTurn.get(t)!.set(String(row.party), Number(row.seats) || 0);
  }
  const SEAT_SHARE_CHECKPOINTS = 8;
  const seatShare = [...seatShareRaw.entries()].map(([key, byTurn]) => {
    const [countryId, officeType] = key.split("|");
    const turns = [...byTurn.keys()].sort((a, b) => a - b);
    const stride = Math.max(1, Math.ceil(turns.length / SEAT_SHARE_CHECKPOINTS));
    const sampled = turns.filter((_, i) => i % stride === 0);
    if (sampled[sampled.length - 1] !== turns[turns.length - 1])
      sampled.push(turns[turns.length - 1]);
    // Top 4 parties by their BEST-EVER seat share, plus an "other" bucket, so
    // the legend stays stable across checkpoints instead of reshuffling.
    const totals = new Map<string, number>();
    for (const t of sampled) {
      for (const [party, seats] of byTurn.get(t) ?? []) {
        totals.set(party, (totals.get(party) ?? 0) + seats);
      }
    }
    const topParties = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([p]) => p);
    const points = sampled.map((t) => {
      const parties = byTurn.get(t) ?? new Map();
      const total = [...parties.values()].reduce((s, v) => s + v, 0);
      const shares: Record<string, number> = {};
      let otherSeats = total;
      for (const p of topParties) {
        const seats = parties.get(p) ?? 0;
        shares[label(countryId, p)] = total > 0 ? (100 * seats) / total : 0;
        otherSeats -= seats;
      }
      return { turn: t, shares, otherPct: total > 0 ? (100 * otherSeats) / total : 0 };
    });
    return { countryId, officeType, parties: topParties.map((p) => label(countryId, p)), points };
  });

  // Bills introduced vs enacted, per country. `status` is the terminal state
  // (signed/failed/active) — there is no separate "introduced" count because
  // every bill row IS an introduction, so total = introduced.
  const billRows = await db
    .collection("bills")
    .aggregate<{ _id: { c: string; s: string }; n: number }>([
      { $group: { _id: { c: "$countryId", s: "$status" }, n: { $sum: 1 } } },
    ])
    .toArray();
  const billsByCountry = new Map<string, { signed: number; failed: number; active: number }>();
  for (const r of billRows) {
    const cid = String(r._id.c ?? "");
    if (!cid) continue;
    const e = billsByCountry.get(cid) ?? { signed: 0, failed: 0, active: 0 };
    if (r._id.s === "signed") e.signed += r.n;
    else if (r._id.s === "failed") e.failed += r.n;
    else if (r._id.s === "active") e.active += r.n;
    billsByCountry.set(cid, e);
  }
  const bills = [...billsByCountry.entries()]
    .map(([countryId, v]) => ({ countryId, ...v, total: v.signed + v.failed + v.active }))
    .sort((a, b) => b.total - a.total);

  // ── Crises by country (which nations actually absorbed them) ─────────────
  const crisisByCountryRows = await db
    .collection("crises")
    .aggregate<{ _id: string; n: number }>([
      { $unwind: "$countryIds" },
      { $group: { _id: "$countryIds", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  const crisesByCountry = crisisByCountryRows.map((r) => ({ countryId: String(r._id), n: r.n }));

  const changelog: ChangelogEntry[] = changelogPath
    ? (JSON.parse(readFileSync(changelogPath, "utf8")) as ChangelogEntry[])
    : [];

  // Narrative first: it reads the FULL series (it indexes specific points and
  // compares endpoints), so downsampling before this produced
  // "Cannot read properties of undefined" on a shortened array.
  const narrative = buildNarrative(series, fiscal, market, health);

  const clampedInflation = Object.entries(series)
    .filter(([, s]) => s.inflation.length > 0 && s.inflation[s.inflation.length - 1] >= 14.9)
    .map(([cid]) => cid);
  const verdict = buildVerdict({
    health,
    market,
    corpTrend,
    labour,
    moneyTrend,
    commandEconomy,
    auditFindings,
    clampedInflation,
  });

  // Downsample the inlined series so the payload stays bounded as the run grows.
  // Every snapshot turn was being inlined verbatim, so the file scaled linearly
  // with the run: 105KB at t25, 810KB at t250, and 1.18MB at t350 — past the
  // publish endpoint's body limit, which would have made the last three
  // checkpoints of a 1000-turn run unpublishable exactly when they matter most.
  // A chart a thousand pixels wide cannot show more than a few hundred points
  // anyway, so striding costs nothing visible. The LAST point is always kept:
  // the final turn is the one every number in the prose refers to.
  const MAX_SERIES_POINTS = 220;
  for (const s of Object.values(series)) {
    const n = s.turn.length;
    if (n <= MAX_SERIES_POINTS) continue;
    const stride = Math.ceil(n / MAX_SERIES_POINTS);
    const keep = (arr: number[]): number[] => {
      const out = arr.filter((_, i) => i % stride === 0);
      if (arr.length && out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
      return out;
    };
    s.turn = keep(s.turn);
    s.gdp = keep(s.gdp);
    s.gdpGrowth = keep(s.gdpGrowth);
    s.inflation = keep(s.inflation);
    s.interestRate = keep(s.interestRate);
    s.corpRevenue = keep(s.corpRevenue);
  }

  const payload = {
    dbName,
    maxTurn,
    ordered,
    missingPlayers,
    PLAYER,
    BLOC,
    NAMES,
    colors: Object.fromEntries(ordered.map((c) => [c, colorFor(c)])),
    series,
    mcap,
    fiscal,
    activity,
    health,
    market,
    events,
    money,
    corporate,
    marginVariation,
    control,
    governors,
    changelog,
    narrative,
    verdict,
    auditFindings,
    auditSelfCheck,
    commandEconomy,
    scotus,
    labour,
    demography,
    corpTrend,
    sectorComposition,
    marginHistogram,
    consolidation,
    moneyTrend,
    winMargins: marginHistogramPolitical,
    seatShare,
    bills,
    crisesByCountry,
  };

  writeFileSync(outPath, renderHtml(payload));
  console.log(
    `Wrote ${outPath} — turn ${maxTurn}, ${ordered.length} countries, ${snaps.length} snapshots.`
  );
  if (missingPlayers.length) {
    console.log(
      `NOTE: player countries missing from the economy feed: ${missingPlayers.join(", ")}`
    );
  }
  await client.close();
}

/**
 * Gate A of the checkpoint audit checklist — the checks whose fix is a judgement
 * call, so they have to be surfaced while a human is still available to answer.
 * See the `grand-sim-checkpoint-audit-checklist` doc in ops-knowledge.
 *
 * Every check here has actually caught something on this world. They are
 * deliberately narrow: a check that cannot point at a specific country and
 * number belongs in the report body, not in the audit.
 */
export interface AuditFinding {
  id: string;
  countryId: string;
  severity: "critical" | "high" | "medium";
  title: string;
  detail: string;
}

/**
 * What the audit actually looked at versus what it could not, per the
 * checklist's self-audit requirement — a green report must be distinguishable
 * from an unexamined one. `checked` names a check family that ran to
 * completion (even if it found nothing); `skipped` names one that could not
 * run, and why, scoped to the country or check it affects.
 */
export interface SeedAuditSelfCheck {
  checked: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export interface SeedAuditResult {
  findings: AuditFinding[];
  selfCheck: SeedAuditSelfCheck;
}

/** Per-country fiscal-year series backing the staleness/trajectory checks. */
interface BudgetSnapshotSeries {
  turn: number[];
  gdp: number[];
  debtToGdp: number[];
  spendTotal: number[];
}

/**
 * Entity classes every full-autonomous country is expected to have a
 * non-empty presence in. Absence of a row is invisible to any check that only
 * inspects existing rows — a $group/$match simply never produces a document
 * for a country with zero of something, which is exactly how nine countries
 * with no corporate sectors at all went unreported for two full runs (the
 * two that happened to have a single stray sector were merely reported as
 * "all sectors have a zero growth target"; the seven with none were reported
 * on not at all). "Regional budgets" and "demographics" read from the
 * STATE-level collections (stateBudgets / stateDemographics) rather than the
 * similarly named regionalBudgets / regionDemographics, which are populated
 * for only a handful of countries by an unrelated subsystem and would
 * misreport as universal absence.
 */
const COVERAGE_CLASSES: ReadonlyArray<{
  id: string;
  collection: string;
  label: string;
  severity: AuditFinding["severity"];
}> = [
  {
    id: "B1-sectors",
    collection: "corporateSectors",
    label: "corporate sectors",
    severity: "critical",
  },
  { id: "B2-corps", collection: "corporations", label: "corporations", severity: "critical" },
  { id: "B3-unions", collection: "unions", label: "unions", severity: "medium" },
  {
    id: "B4-officials",
    collection: "electedOfficials",
    label: "elected officials",
    severity: "high",
  },
  {
    id: "B5-parties",
    collection: "politicalParties",
    label: "political parties",
    severity: "high",
  },
  { id: "B6-elections", collection: "elections", label: "elections", severity: "medium" },
  { id: "B7-laws", collection: "enactedLaws", label: "enacted laws", severity: "medium" },
  {
    id: "B8-money",
    collection: "moneySupplySnapshots",
    label: "money-supply snapshots",
    severity: "critical",
  },
  {
    id: "B9-budgets",
    collection: "stateBudgets",
    label: "regional (state) budgets",
    severity: "high",
  },
  {
    id: "B10-demographics",
    collection: "stateDemographics",
    label: "demographics rows",
    severity: "high",
  },
];

/** Minimum fiscal-year snapshots before a staleness/trajectory read is trustworthy. */
const MIN_FISCAL_SNAPSHOTS = 4;
/** Trailing-window size for "has this stopped moving" checks. */
const STALE_WINDOW = 3;

/**
 * Modified (Iglewicz-Hoaglin) z-score in log space: robust to the small,
 * multiplicative, right-skewed samples cross-country economic ratios
 * actually produce (a dozen countries, one or two orders of magnitude apart
 * is normal; a raw mean/stdev z-score is dominated by whichever country is
 * biggest). Requires >= 5 values to have a meaningful median/MAD; returns {}
 * otherwise so the caller can report "not enough peers" instead of a bogus
 * score. Zero/negative inputs are the caller's job to exclude — they belong
 * to the absence check, not this one.
 */
function logModifiedZScores(valuesByCountry: Record<string, number>): Record<string, number> {
  const entries = Object.entries(valuesByCountry).filter(([, v]) => Number.isFinite(v) && v > 0);
  if (entries.length < 5) return {};
  const logs = entries.map(([, v]) => Math.log(v));
  const sortedLogs = [...logs].sort((a, b) => a - b);
  const med = sortedLogs[Math.floor(sortedLogs.length / 2)];
  const absDevs = logs.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = absDevs[Math.floor(absDevs.length / 2)] || 1e-9;
  const out: Record<string, number> = {};
  entries.forEach(([cid], i) => {
    out[cid] = (0.6745 * (logs[i] - med)) / mad;
  });
  return out;
}

export function runSeedAudit(input: {
  players: string[];
  series: Record<string, CountrySeries>;
  fiscal: Array<{
    countryId: string;
    spendPctGdp: number;
    deficitPctGdp: number;
    debtToGdp: number;
    rating: string;
    crisis: string;
  }>;
  bandIndex: Record<string, number>;
  flags: Record<string, unknown>;
  zeroGrowthByCountry: Record<string, { zero: number; total: number }>;
  /** World-manifest preset id (e.g. "1953-default"), for self-audit text only. */
  presetId?: string;
  /** Full-autonomous country ids, derived from the world manifest — never hardcode this. */
  expectedCountries?: string[];
  /** collection name -> countryId -> row count, for the B-family absence checks. */
  coverageCounts?: Record<string, Record<string, number>>;
  /** countryId -> per-fiscal-year series, for the C/D staleness/trajectory checks. */
  budgetSnapshotSeries?: Record<string, BudgetSnapshotSeries>;
}): SeedAuditResult {
  const out: AuditFinding[] = [];
  const checked: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const {
    players,
    series,
    fiscal,
    bandIndex,
    flags,
    zeroGrowthByCountry,
    presetId = "",
    expectedCountries = [],
    coverageCounts = {},
    budgetSnapshotSeries = {},
  } = input;

  // A1 — fiscal sanity.
  for (const f of fiscal) {
    if (f.spendPctGdp > 60 || (f.spendPctGdp > 0 && f.spendPctGdp < 10)) {
      out.push({
        id: "A1-spend",
        countryId: f.countryId,
        severity: f.spendPctGdp > 100 ? "critical" : "high",
        title: `Spending is ${f.spendPctGdp.toFixed(1)}% of GDP`,
        detail:
          "Outside the plausible 10-60% band, which points at a seed fault rather than a policy choice. " +
          "The usual cause is a mis-scaled cost input, not overspending.",
      });
    }
    if (f.deficitPctGdp > 15) {
      out.push({
        id: "A1-deficit",
        countryId: f.countryId,
        severity: f.deficitPctGdp > 50 ? "critical" : "high",
        title: `Deficit is ${f.deficitPctGdp.toFixed(1)}% of GDP`,
        detail: `Debt sits at ${(f.debtToGdp * 100).toFixed(0)}% of GDP with a ${f.rating} rating (state: ${f.crisis}).`,
      });
    }
  }

  // A2 — income-band index. The single highest-yield check.
  for (const [cid, idx] of Object.entries(bandIndex)) {
    if (!Number.isFinite(idx) || idx < 0.4 || idx > 2.5) {
      out.push({
        id: "A2-band",
        countryId: cid,
        severity: idx > 5 || idx < 0.2 ? "critical" : "high",
        title: `Income-band index is ${idx.toFixed(4)}, not ~1.0`,
        detail:
          "This multiplies the income term of every costModelV2 law. A value this far from 1 means the seeded " +
          "median income and the era INCOME_ANCHORS entry disagree on currency scale — usually an era-blind " +
          "*StateBaselines.ts carrying modern incomes.",
      });
    }
  }

  // A3 — inflation clamp and rate spirals.
  for (const [cid, s] of Object.entries(series)) {
    if (s.inflation.length === 0) continue;
    const infl = s.inflation[s.inflation.length - 1];
    const rate = s.interestRate[s.interestRate.length - 1];
    if (infl >= 14.9) {
      out.push({
        id: "A3-clamp",
        countryId: cid,
        severity: "critical",
        title: `Inflation is pinned at the ${infl.toFixed(2)}% ceiling`,
        detail:
          "A series resting exactly on MAX_INFLATION is being clamped, not settling — the underlying value " +
          "wants to run higher. Treat the clamp as a symptom and find what is driving it.",
      });
    }
    if (rate > 10) {
      out.push({
        id: "A3-rate",
        countryId: cid,
        severity: "high",
        title: `Policy rate reached ${rate.toFixed(2)}%`,
        detail:
          "Above 10% in a 1953 world is a tightening spiral rather than a stance. It also reprices equities, " +
          "because share prices discount sectorNPV by the prime rate.",
      });
    }
    // A4-adjacent — a byte-identical revenue series is always worth naming.
    if (s.corpRevenue.length > 3) {
      const first = s.corpRevenue[0];
      const last = s.corpRevenue[s.corpRevenue.length - 1];
      if (first > 0 && Math.abs(last / first - 1) < 0.00005) {
        out.push({
          id: "A4-frozen",
          countryId: cid,
          severity: "high",
          title: "Corporate revenue is byte-identical across the window",
          detail:
            "A frozen production base, not a slow one. Check corporateSectors.targetGrowthRate — command-economy " +
            "SOEs seeded at zero freeze the whole economy because every producing sector is an SOE.",
        });
      }
    }
  }

  // A4 — growth targets exist.
  for (const [cid, g] of Object.entries(zeroGrowthByCountry)) {
    if (g.total > 0 && g.zero === g.total) {
      out.push({
        id: "A4-target",
        countryId: cid,
        severity: "critical",
        title: `All ${g.total} sectors have a zero growth target`,
        detail:
          "Nothing in this economy can expand. Harmless in a market economy where NPP-founded private firms " +
          "carry growth; fatal in a command economy where every producing sector is state-owned.",
      });
    }
  }

  // A6 — player-country instrumentation.
  for (const cid of players) {
    if (!series[cid]) {
      out.push({
        id: "A6-instr",
        countryId: cid,
        severity: "high",
        title: "Player country produces no economy rows",
        detail:
          "COUNTRY_CONFIGS marks it coming-soon and the health snapshot only walks active countries, so this " +
          "nation is invisible to every economic chart and check below.",
      });
    }
  }

  // A7 — ladder-valued flags that silently disable whole subsystems.
  const labour = String(flags.labourSystemMode ?? "");
  if (labour !== "full") {
    out.push({
      id: "A7-labour",
      countryId: "WORLD",
      severity: "high",
      title: `labourSystemMode is "${labour || "unset"}", not "full"`,
      detail:
        "ownedUnionMembershipPressureByKey is only fetched at full, so union membership pressure never reaches " +
        "unionization or labor cost no matter who leads the union. The whole bargaining layer is inert below it.",
    });
  }
  const market = String(flags.marketSystemMode ?? "");
  if (market !== "clearing" && market !== "capital") {
    out.push({
      id: "A7-market",
      countryId: "WORLD",
      severity: "high",
      title: `marketSystemMode is "${market || "unset"}", below clearing`,
      detail:
        "Brand loyalty and quality-premium pricing both accrue and apply inside the clearing guard, so they " +
        "never fire below that tier even with their own flags on.",
    });
  }
  if (flags.demographicsDemandEnabled === true && flags.householdConsumptionEnabled === true) {
    out.push({
      id: "A7-demand",
      countryId: "WORLD",
      severity: "medium",
      title: "Both consumer-demand channels are enabled",
      detail:
        "householdConsumptionEnabled supersedes demographicsDemandEnabled and the type doc says not to enable " +
        "both. Nothing enforces it, so the world stacks a demographics uplift on a household basket at a size " +
        "neither model was calibrated for.",
    });
  }
  if (flags.commandEconomyEnabled !== true) {
    out.push({
      id: "A7-command",
      countryId: "WORLD",
      severity: "high",
      title: "commandEconomyEnabled is not set on gameConfig",
      detail:
        "isCommandEconomy() is fail-safe on this flag, so every planned economy falls through to the market path " +
        "and its administered prices, fixed currency and passive monobank never run. Note it must be set on " +
        "gameConfig, not gameState — every consumer reads gameConfig.",
    });
  }

  // B — absence/coverage. For every entity class, walk the world-manifest's
  // full-autonomous roster and flag any country with a ZERO row count. This
  // is deliberately the opposite shape of every check above: those inspect
  // rows that exist, so a country with none of something is invisible to
  // them by construction.
  if (expectedCountries.length === 0) {
    skipped.push({
      id: "B-coverage",
      reason:
        "No expectedCountries were supplied (empty or unrecognized world-manifest preset), so absence/coverage " +
        "checks did not run for any entity class. This is the exact failure mode the checks exist to catch, so an " +
        "empty roster here must be reported, not silently treated as a clean pass.",
    });
  } else {
    for (const cls of COVERAGE_CLASSES) {
      const counts = coverageCounts[cls.collection] ?? {};
      for (const cid of expectedCountries) {
        if ((counts[cid] ?? 0) === 0) {
          out.push({
            id: cls.id,
            countryId: cid,
            severity: cls.severity,
            title: `No ${cls.label} at all`,
            detail:
              `${cid} is full-autonomous in the ${presetId || "active"} world manifest but has zero ` +
              `${cls.label} rows. A check that only inspects existing rows cannot see this kind of gap — it has ` +
              "to test for absence directly, country by country.",
          });
        }
      }
    }
    checked.push(
      `Coverage: ${COVERAGE_CLASSES.length} entity classes (${COVERAGE_CLASSES.map((c) => c.label).join(", ")}) ` +
        `checked for zero-row absence across ${expectedCountries.length} full-autonomous countries from the ` +
        `${presetId || "active"} world manifest.`
    );
  }

  // C/D — staleness and trajectory, from the per-fiscal-year budget snapshot
  // series. Needs a minimum window before a "hasn't moved" or "only ever
  // moves one way" read is meaningful rather than noise from a short run.
  const seriesEntries = Object.entries(budgetSnapshotSeries);
  const usableSeries = seriesEntries.filter(([, s]) => s.turn.length >= MIN_FISCAL_SNAPSHOTS);
  for (const [cid, s] of seriesEntries) {
    if (s.turn.length < MIN_FISCAL_SNAPSHOTS) {
      skipped.push({
        id: "C-D-staleness-trajectory",
        reason:
          `Staleness/trajectory checks skipped for ${cid} — only ${s.turn.length} fiscal-year snapshot(s), ` +
          `below the minimum window of ${MIN_FISCAL_SNAPSHOTS}.`,
      });
    }
  }
  if (usableSeries.length === 0 && seriesEntries.length > 0) {
    skipped.push({
      id: "C-D-staleness-trajectory-all",
      reason:
        "No country had enough fiscal-year snapshots for a staleness or trajectory read — this checkpoint is too " +
        "early in the run for either check to be meaningful yet, not evidence the world is healthy.",
    });
  }
  for (const [cid, s] of usableSeries) {
    // C1 — a nominal figure that has stopped moving while GDP keeps changing
    // is a stuck computation, not a settled economy. Checked in NOMINAL
    // currency (spendTotal), not spend-as-%-of-GDP: a country whose spending
    // is frozen in nominal terms while GDP keeps growing has spendPctGdp
    // DRIFTING DOWN, not frozen — the nominal figure is the one that actually
    // exposes the stuck computation.
    const spendTrail = s.spendTotal.slice(-STALE_WINDOW);
    const gdpTrail = s.gdp.slice(-STALE_WINDOW);
    const spendFrozen =
      spendTrail.length === STALE_WINDOW &&
      spendTrail[0] > 0 &&
      spendTrail.every((v) => Math.abs(v - spendTrail[0]) < 1e-6 * Math.abs(spendTrail[0]));
    const gdpMoved =
      gdpTrail.length === STALE_WINDOW &&
      gdpTrail[0] > 0 &&
      Math.abs(gdpTrail[gdpTrail.length - 1] / gdpTrail[0] - 1) > 0.001;
    if (spendFrozen && gdpMoved) {
      const turns = s.turn.slice(-STALE_WINDOW);
      out.push({
        id: "C1-frozen-spend",
        countryId: cid,
        severity: "high",
        title: `Government spending is byte-identical across the last ${STALE_WINDOW} fiscal years`,
        detail:
          `Spending held at exactly ${spendTrail[0].toLocaleString()} at turns ${turns.join(", ")} while GDP moved ` +
          `${gdpTrail[0].toLocaleString()} -> ${gdpTrail[gdpTrail.length - 1].toLocaleString()} over the same ` +
          "window. A budget that never recomputes as the economy under it changes is a stuck computation, not a " +
          "restrained one.",
      });
    }

    // D2 — resting exactly on a known bound (0) rather than settling near it.
    // Checked before/instead of treating it as just another frozen value: a
    // debt ratio that DECAYS to zero and then never leaves is a floor clamp
    // stopping the ledger from ever recording a deficit again, not a fiscal
    // achievement — so it gets its own, more specific finding.
    const debtTrail = s.debtToGdp.slice(-STALE_WINDOW);
    if (
      debtTrail.length === STALE_WINDOW &&
      debtTrail.every((v) => v === 0) &&
      s.debtToGdp[0] !== 0
    ) {
      out.push({
        id: "D2-bound-zero",
        countryId: cid,
        severity: "critical",
        title: "Debt-to-GDP is pinned at exactly 0%, not merely low",
        detail:
          `Started this window at ${(s.debtToGdp[0] * 100).toFixed(1)}% and decayed to exactly 0 by turn ` +
          `${s.turn[s.turn.length - STALE_WINDOW]}, then never moved again across ${STALE_WINDOW} further fiscal ` +
          "years. Resting exactly on a bound (0, 100, a rate cap) rather than settling near it means the value is " +
          "being clamped, not computed — most likely a floor that stops debt from ever recording a fresh deficit " +
          "once it reaches zero.",
      });
    }

    // D1 — one-way ratchet: a value that moves in only one direction across
    // the ENTIRE observed window, not just the trailing one. Level checks
    // (A1) only see where a value ended up; this sees that it never once
    // reversed to get there, which is the more common defect shape in this
    // codebase. Small moves are excluded (>=5 points of GDP) so ordinary
    // near-flat noise doesn't get promoted to "ratchet".
    const debtStart = s.debtToGdp[0];
    const debtEnd = s.debtToGdp[s.debtToGdp.length - 1];
    if (Math.abs(debtEnd - debtStart) > 0.05) {
      let monoUp = true;
      let monoDown = true;
      for (let i = 1; i < s.debtToGdp.length; i++) {
        if (s.debtToGdp[i] < s.debtToGdp[i - 1] - 1e-9) monoUp = false;
        if (s.debtToGdp[i] > s.debtToGdp[i - 1] + 1e-9) monoDown = false;
      }
      if (monoUp && !monoDown) {
        out.push({
          id: "D1-ratchet-up",
          countryId: cid,
          severity: debtEnd > 3 ? "critical" : "high",
          title: `Debt-to-GDP rose every single fiscal year: ${(debtStart * 100).toFixed(0)}% -> ${(debtEnd * 100).toFixed(0)}%`,
          detail:
            `Across all ${s.turn.length} observed fiscal years it never once fell — a one-way ratchet, not a ` +
            "business cycle. A level check alone would only see the final number; only the full trajectory shows " +
            "it never reversed.",
        });
      } else if (monoDown && !monoUp && debtEnd > 0) {
        out.push({
          id: "D1-ratchet-down",
          countryId: cid,
          severity: "medium",
          title: `Debt-to-GDP fell every single fiscal year and has not yet reached 0: ${(debtStart * 100).toFixed(0)}% -> ${(debtEnd * 100).toFixed(0)}%`,
          detail:
            "Monotonic decline with no reversal across the whole window. Not yet critical — it has not pinned at " +
            "a bound — but on the same trajectory as the countries that already have (see D2) and worth watching " +
            "at the next checkpoint.",
        });
      }
    }
  }
  if (usableSeries.length > 0) {
    checked.push(
      `Staleness (frozen nominal spending) and trajectory (one-way ratchets, bound-pinning) checked across ` +
        `${usableSeries.length} countries with >= ${MIN_FISCAL_SNAPSHOTS} fiscal-year snapshots.`
    );
  }

  // E — cross-country outliers on a normalized metric. Corporate sectors per
  // state: normalizes away a country's raw size so a genuine shape anomaly
  // (Ireland's 57 sectors against Italy's 1, from the incident this audit
  // exists because of) is visible as a distribution outlier rather than
  // requiring a human to eyeball a table. Zero-row countries are excluded
  // here deliberately — they are the B-family's job, not this one's, so this
  // check never double-reports the same gap under two different ids.
  const sectorsPerState: Record<string, number> = {};
  for (const cid of expectedCountries) {
    const sectors = coverageCounts.corporateSectors?.[cid] ?? 0;
    const states = coverageCounts.stateBudgets?.[cid] ?? 0;
    if (sectors > 0 && states > 0) sectorsPerState[cid] = sectors / states;
  }
  const sectorZScores = logModifiedZScores(sectorsPerState);
  const peerCount = Object.keys(sectorsPerState).length;
  if (Object.keys(sectorZScores).length > 0) {
    for (const [cid, z] of Object.entries(sectorZScores)) {
      if (Math.abs(z) > 3.5) {
        out.push({
          id: "E1-sector-outlier",
          countryId: cid,
          severity: z < 0 ? "high" : "medium",
          title:
            `Corporate sectors per state (${sectorsPerState[cid].toFixed(2)}) is a ` +
            `${z < 0 ? "low" : "high"}-side outlier against its peers`,
          detail:
            `Modified z-score ${z.toFixed(2)} (Iglewicz-Hoaglin, log-space, |z|>3.5 flagged) against a ` +
            `${peerCount}-country peer set that excludes anyone already at zero. ` +
            `${z < 0 ? "Unusually thin coverage" : "Unusually dense coverage"} relative to every other country's ` +
            "own sectors-per-state ratio — worth a human look even though neither side is a hard rule violation " +
            "on its own.",
        });
      }
    }
    checked.push(
      `Cross-country outlier check: corporate sectors per state, modified z-score across ${peerCount} countries ` +
        "with a non-zero sector count and a non-zero state count."
    );
  } else if (expectedCountries.length > 0) {
    skipped.push({
      id: "E-outlier",
      reason:
        `Cross-country outlier check skipped — only ${peerCount} countries had both a non-zero corporate-sector ` +
        "count and a non-zero state count, below the minimum peer set of 5 needed for a stable median/MAD.",
    });
  }

  const rank = { critical: 0, high: 1, medium: 2 };
  return {
    findings: out.sort((a, b) => rank[a.severity] - rank[b.severity]),
    selfCheck: { checked, skipped },
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function pct(a: number, b: number): number {
  return a > 0 ? (b / a - 1) * 100 : 0;
}

/**
 * Fixed-width histogram bins over a raw value list — used for margin, wage and
 * winning-margin distributions. Returns bin edges + counts so the client draws
 * a bar chart from a handful of numbers instead of the whole raw array (which
 * for margins would be one row per corporate sector, and for votes one row
 * per race). Pass an explicit [lo, hi] to pin the domain (e.g. a 0-100%
 * margin scale); omitted, it uses the data's own min/max.
 */
function histogramBins(
  values: number[],
  bins: number,
  lo?: number,
  hi?: number
): { edges: number[]; counts: number[]; n: number } {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return { edges: [], counts: [], n: 0 };
  const min = lo ?? Math.min(...clean);
  const max = hi ?? Math.max(...clean);
  const span = max > min ? max - min : 1;
  const counts = new Array(bins).fill(0);
  for (const v of clean) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((v - min) / span) * bins)));
    counts[idx]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => min + (span * i) / bins);
  return { edges, counts, n: clean.length };
}

/** Auto-written prose for each player country plus a world-level paragraph. */
function buildNarrative(
  series: Record<string, CountrySeries>,
  fiscal: Array<{
    countryId: string;
    spendPctGdp: number;
    deficitPctGdp: number;
    debtToGdp: number;
    rating: string;
    crisis: string;
  }>,
  market: { mode: string; trips: number; guardEnabled: boolean },
  health: { errors: number; warnings: number; turn: number }
): Array<{ countryId: string; title: string; body: string }> {
  const out: Array<{ countryId: string; title: string; body: string }> = [];

  for (const cid of PLAYER) {
    const s = series[cid];
    if (!s || s.gdp.length < 2) {
      out.push({
        countryId: cid,
        title: NAMES[cid] ?? cid,
        body:
          `${NAMES[cid] ?? cid} produced no economy rows in this checkpoint. It is one of the four ` +
          `playable countries, so this is an instrumentation gap rather than a quiet economy: ` +
          `COUNTRY_CONFIGS still marks it coming-soon, and the health snapshot only walks countries ` +
          `whose status is active.`,
      });
      continue;
    }
    const n = s.gdp.length - 1;
    const gdpDelta = pct(s.gdp[0], s.gdp[n]);
    const revDelta = pct(s.corpRevenue[0], s.corpRevenue[n]);
    const infl0 = s.inflation[0];
    const infl1 = s.inflation[n];
    const rate1 = s.interestRate[n];
    const f = fiscal.find((x) => x.countryId === cid);

    const growthPhrase =
      gdpDelta > 1.5
        ? `expanded steadily, ${gdpDelta.toFixed(2)}% over the window`
        : gdpDelta > 0.05
          ? `grew slowly, ${gdpDelta.toFixed(2)}%`
          : gdpDelta < -0.05
            ? `contracted ${Math.abs(gdpDelta).toFixed(2)}%`
            : `did not move at all`;

    const revPhrase =
      Math.abs(revDelta) < 0.005
        ? `Corporate revenue was byte-identical from first turn to last — a frozen production base, not a slow one`
        : `Corporate revenue moved ${revDelta >= 0 ? "up" : "down"} ${Math.abs(revDelta).toFixed(2)}%`;

    const inflPhrase =
      infl1 >= 14.9
        ? `Inflation is pinned at the 15% model ceiling, which means the underlying series wants to run higher and is being clamped`
        : Math.abs(infl1 - infl0) < 0.02
          ? `Inflation held flat at ${infl1.toFixed(2)}% (administered prices)`
          : `Inflation moved ${infl0.toFixed(2)}% → ${infl1.toFixed(2)}%`;

    let fiscalPhrase = "";
    if (f) {
      const stress =
        f.deficitPctGdp > 50
          ? `a runaway deficit of ${f.deficitPctGdp.toFixed(0)}% of GDP`
          : f.deficitPctGdp > 8
            ? `a wide deficit of ${f.deficitPctGdp.toFixed(1)}% of GDP`
            : f.deficitPctGdp > 0
              ? `a manageable deficit of ${f.deficitPctGdp.toFixed(1)}% of GDP`
              : `a surplus of ${Math.abs(f.deficitPctGdp).toFixed(1)}% of GDP`;
      fiscalPhrase =
        ` The treasury carries ${stress}, spending ${f.spendPctGdp.toFixed(1)}% of GDP against ` +
        `debt at ${(f.debtToGdp * 100).toFixed(0)}% and a ${f.rating} rating` +
        (f.crisis && f.crisis !== "normal" && f.crisis !== "-"
          ? ` (sovereign state: ${f.crisis})`
          : "") +
        `.`;
    }

    out.push({
      countryId: cid,
      title: NAMES[cid] ?? cid,
      body:
        `Output ${growthPhrase}, with the policy rate ending at ${rate1.toFixed(2)}%. ` +
        `${revPhrase}. ${inflPhrase}.${fiscalPhrase}`,
    });
  }

  out.push({
    countryId: "WORLD",
    title: "The world",
    body:
      `Through turn ${health.turn} the engine logged ${health.errors} errors and ${health.warnings} warnings. ` +
      `The market ran in ${market.mode} mode with the launch guard ${market.guardEnabled ? "armed" : "disarmed"}` +
      (market.trips > 0
        ? `, having tripped ${market.trips} time${market.trips === 1 ? "" : "s"} — so the capital tier was not exercised for the full window.`
        : ` and never tripped, so the capital tier held for the whole window.`),
  });

  return out;
}

export interface VerdictLine {
  status: "good" | "warn" | "bad";
  title: string;
  detail: string;
}

/**
 * The "is this trustworthy" line, condensed to the handful of readings that
 * decide it — rendered ABOVE every chart. Each line states what was measured
 * and what it means; nothing here is a chart waiting to be read, it is the
 * conclusion the charts below back up.
 */
function buildVerdict(input: {
  health: { errors: number; warnings: number; turn: number };
  market: { trips: number; guardEnabled: boolean };
  corpTrend: { turn: number[]; firms: number[] };
  labour: {
    unions: number;
    led: number;
    strikes: number;
    pressureAllZero: boolean;
    unionizationZeroShare: number;
  };
  moneyTrend: { exogenousMoney: string[]; missingMoneySupply: string[] };
  commandEconomy: { marketizationStuck: string[] };
  auditFindings: AuditFinding[];
  clampedInflation: string[];
}): VerdictLine[] {
  const out: VerdictLine[] = [];
  const {
    health,
    market,
    corpTrend,
    labour,
    moneyTrend,
    commandEconomy,
    auditFindings,
    clampedInflation,
  } = input;

  const critical = auditFindings.filter((f) => f.severity === "critical").length;
  const high = auditFindings.filter((f) => f.severity === "high").length;
  out.push({
    status: critical > 0 ? "bad" : high > 0 ? "warn" : "good",
    title:
      auditFindings.length === 0
        ? "Seed audit: no findings"
        : `Seed audit: ${critical} critical, ${high} high, ${auditFindings.length - critical - high} medium finding(s)`,
    detail:
      auditFindings.length === 0
        ? "Fiscal ratios, income-band index, inflation clamps, growth targets and feature-flag wiring all read as expected."
        : "See the findings list immediately below — each names the affected country and the specific field.",
  });

  out.push({
    status: health.errors === 0 ? "good" : health.errors < 10 ? "warn" : "bad",
    title: `${health.errors} engine error(s), ${health.warnings} warning(s) across ${health.turn} turns`,
    detail:
      "Phase throws are converted to warnings by the runtime, so a non-zero error count is the only signal a phase died silently.",
  });

  out.push({
    status: market.trips === 0 ? "good" : "warn",
    title: `Launch guard tripped ${market.trips} time(s)`,
    detail: market.guardEnabled
      ? "Guard is armed. A trip means price decoupled from fundamentals; zero trips means the capital tier held for the whole window."
      : "Guard is DISARMED — trips cannot fire even if price decouples from fundamentals.",
  });

  if (corpTrend.firms.length >= 2) {
    const f0 = corpTrend.firms[0];
    const f1 = corpTrend.firms[corpTrend.firms.length - 1];
    const delta = f0 > 0 ? (100 * (f1 - f0)) / f0 : 0;
    out.push({
      status: delta < -25 ? "bad" : delta < -5 ? "warn" : "good",
      title: `Corporate sector ${delta >= 0 ? "held" : "shrank"}: ${f0} → ${f1} firms (${delta.toFixed(1)}%)`,
      detail:
        "A prior run fell 432 to 88 with nothing flagged defunct, because growth cost was billed on nominal revenue but paid from realised revenue.",
    });
  }

  if (clampedInflation.length > 0) {
    out.push({
      status: "bad",
      title: `Inflation pinned at the 15% clamp: ${clampedInflation.join(", ")}`,
      detail:
        "A series resting exactly on the model ceiling is being held, not settling — the underlying value wants to run higher.",
    });
  }

  out.push({
    status: labour.strikes > 0 ? "good" : "warn",
    title: `${labour.led}/${labour.unions} unions led, ${labour.strikes} strikes called`,
    detail: labour.pressureAllZero
      ? "Every union's membershipPressure reads exactly 0, against an ADR-5 seed of 20 — a live discrepancy from the seeded starting point, not organic labour peace. Strikes were traced (run2) to strikeCallCost exceeding dues income, structurally unreachable rather than merely unchosen."
      : "Membership pressure shows real variation across unions.",
  });

  if (moneyTrend.exogenousMoney.length > 0) {
    out.push({
      status: "warn",
      title: `M2 is exogenous/frozen for ${moneyTrend.exogenousMoney.length} countries`,
      detail: `${moneyTrend.exogenousMoney.join(", ")}: externalBroadMoney (a seeded constant) is ≥95% of M2, so its growth reading is not a real monetary signal there.`,
    });
  }
  if (moneyTrend.missingMoneySupply.length > 0) {
    out.push({
      status: "warn",
      title: `No money-supply instrumentation for ${moneyTrend.missingMoneySupply.length} bloc countries`,
      detail: `${moneyTrend.missingMoneySupply.join(", ")} carry zero moneySupplySnapshots rows — an absent monetary channel, not a calm one.`,
    });
  }

  if (commandEconomy.marketizationStuck.length > 0) {
    out.push({
      status: "warn",
      title: `marketizationLevel stuck at 0 for ${commandEconomy.marketizationStuck.length} bloc countries`,
      detail: `${commandEconomy.marketizationStuck.join(", ")}: diagnosed (run2) as a one-sided pull — the frozen party charter (weight 0.6 × -5) outweighs the live Gosbank channel's +0.4 cap, so the dial cannot structurally clear zero once it arrives there. Sitting near 0 can be a legitimate hardline stance; never being ABLE to leave it is the bug.`,
    });
  }

  return out;
}

function renderHtml(p: Record<string, unknown>): string {
  const json = JSON.stringify(p).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grand Sim 1953 — Checkpoint (turn ${p.maxTurn})</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1140px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}
h2{font-size:20px;margin:44px 0 14px;padding-bottom:8px;border-bottom:1px solid #21262d}
h3{font-size:15px;margin:0 0 4px}
.sub{color:#8b949e;margin:0 0 14px}
.card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:18px;margin:16px 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
.tile{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:14px}
.tile.good{border-color:#238636aa}.tile.bad{border-color:#f8514966}.tile.warn{border-color:#d2992266}
.tv{font-size:23px;font-weight:650;letter-spacing:-.02em}
.tl{font-size:12px;color:#8b949e;margin-top:2px}.ts{font-size:11px;color:#6e7681;margin-top:3px}
.ctrl{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;align-items:center}
.grp{background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;font-weight:600}
.grp:hover{background:#30363d}
.chip{border:1px solid #30363d;border-radius:999px;padding:4px 11px;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;user-select:none;background:#0d1117;color:#6e7681}
.chip.on{color:#e6edf3;background:#161b22}
.chip i{width:9px;height:9px;border-radius:50%;display:inline-block;opacity:.35}
.chip.on i{opacity:1}
.chip.player{border-color:#4f8cff66}
.scroll{overflow-x:auto}
svg.chart{width:100%;min-width:640px;height:auto;display:block}
.grid{stroke:#21262d;stroke-width:1}.ax{fill:#6e7681;font-size:11px}
.endlab{font-size:11px;font-weight:700;letter-spacing:.02em}
.crosshair{stroke:#6e7681;stroke-width:1;stroke-dasharray:3 3;pointer-events:none}
.hit{cursor:crosshair}
.tip{position:fixed;pointer-events:none;z-index:50;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:8px 10px;font-size:12px;color:#e6edf3;box-shadow:0 6px 20px #0009;opacity:0;transition:opacity .08s}
.tip.on{opacity:1}
.tip .t{color:#8b949e;font-size:11px;margin-bottom:4px}
.tip .r{display:flex;align-items:center;gap:6px;white-space:nowrap;line-height:1.5}
.tip .r i{width:8px;height:8px;border-radius:2px;flex:none}
.tip .r b{margin-left:auto;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:680px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #21262d;white-space:nowrap}
th{color:#8b949e;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
tr.player td{background:#4f8cff0d}
.pos{color:#3fb950;font-weight:600}.neg{color:#f85149;font-weight:600}
.badge{font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:5px;font-weight:700}
.b-worked{background:#23863622;color:#3fb950}.b-partial{background:#d2992222;color:#e3b341}
.b-failed{background:#f8514922;color:#ff7b72}.b-pending{background:#6e768122;color:#8b949e}
.log{border-left:3px solid #30363d;padding:10px 0 10px 14px;margin:10px 0}
.log.worked{border-left-color:#3fb950}.log.partial{border-left-color:#e3b341}
.log.failed{border-left-color:#f85149}.log.pending{border-left-color:#6e7681}
.log p{margin:5px 0 0;color:#8b949e;font-size:13.5px}
.narr{background:#161b22;border:1px solid #21262d;border-left:4px solid #4f8cff;border-radius:10px;padding:14px 16px;margin:10px 0}
.narr.world{border-left-color:#8b949e}
.narr p{margin:4px 0 0;color:#c9d1d9;font-size:14px}
code{background:#21262d;padding:1px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,monospace}
.note{color:#8b949e;font-size:13px;border-left:2px solid #30363d;padding-left:12px;margin:12px 0}
.warnbox{background:#d2992212;border:1px solid #d2992244;border-radius:9px;padding:12px 14px;margin:14px 0;font-size:13.5px;color:#e3b341}
.vd{display:flex;gap:12px;align-items:flex-start;background:#161b22;border:1px solid #21262d;border-left-width:4px;border-radius:10px;padding:12px 16px;margin:9px 0}
.vd.good{border-left-color:#3fb950}.vd.warn{border-left-color:#e3b341}.vd.bad{border-left-color:#f85149}
.vd .ic{font-size:15px;line-height:1.5;flex:none}
.vd h3{margin:0 0 3px;font-size:14.5px}
.vd p{margin:0;color:#8b949e;font-size:13px}
.finding{display:flex;gap:12px;align-items:flex-start;background:#161b22;border:1px solid #21262d;border-left-width:4px;border-radius:10px;padding:12px 16px;margin:9px 0}
.finding.critical{border-left-color:#f85149}.finding.high{border-left-color:#e3b341}.finding.medium{border-left-color:#8b949e}
.finding h3{margin:0 0 3px;font-size:14.5px}
.finding p{margin:0;color:#8b949e;font-size:13px}
.sev{font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:5px;font-weight:700;margin-left:8px}
.sev-critical{background:#f8514922;color:#ff7b72}.sev-high{background:#d2992222;color:#e3b341}.sev-medium{background:#6e768122;color:#8b949e}
.lg2{display:inline-flex;align-items:center;font-size:12px;color:#8b949e;margin-right:14px;margin-bottom:6px}
.lg2 i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:6px}
.cards2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
</style></head><body><div class="wrap" id="root"></div>
<script id="data" type="application/json">${json}</script>
<script>
const D = JSON.parse(document.getElementById("data").textContent);
const $ = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
// esc() alone is insufficient inside a double-quoted HTML ATTRIBUTE value: it
// does not escape '"', so a JSON blob serialised into data-series/data-meta
// (both quote-heavy) closes the attribute at its first embedded quote and the
// HTML parser then reads the rest of the JSON as a run of bogus bare
// attributes — found on this pass affecting every existing line chart, not
// just the new ones (attachHover's try/catch silently swallowed the failure,
// so the crosshair readout has been non-functional since the first version).
// The visible polylines are unaffected (they are separate markup, not sourced
// from this attribute), which is why the charts still looked fine.
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const root = document.getElementById("root");

// Which countries are currently plotted. Starts on the player countries so the
// default view answers "how are the four playable nations doing".
let active = new Set(D.PLAYER.filter((c) => D.ordered.includes(c)));

function fmtB(v){ return (Math.abs(v)>=1000? (v/1000).toFixed(1)+"k" : v.toFixed(0)); }

// Adaptive magnitude formatter for raw money amounts (GDP, revenue, spending,
// market caps, M1/M2). Money in this world is stored per-country in LOCAL
// CURRENCY by design (a Soviet ruble and a US dollar are not the same unit,
// and pre-revaluation French francs or Ostmarks are a different order of
// magnitude again), so every call site MUST print the currency code next to
// the number rather than implying comparability with a bare "$"-style figure.
// Picking the suffix from the value's own magnitude (instead of a fixed /1e9)
// keeps a small country's GDP from rendering as "0.0B" and a large one from
// overflowing whatever fixed scale a sibling row happened to pick.
function fmtMoney(v){
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v/1e12).toFixed(2)+"T";
  if (abs >= 1e9) return (v/1e9).toFixed(2)+"B";
  if (abs >= 1e6) return (v/1e6).toFixed(2)+"M";
  if (abs >= 1e3) return (v/1e3).toFixed(1)+"K";
  return v.toFixed(0);
}

/**
 * Core multi-line renderer, generalised over any set of {key,color,xs,ys}
 * lines — not just D.series/D.ordered. chart() below (the existing
 * country-economy chart) and the new command-economy / money-supply /
 * corporate-trend charts all delegate here so the axis, hover and
 * player-weight logic can never drift apart between them.
 */
function drawMultiLine(lines, opts) {
  const W = 900, H = opts.height || 300, PAD = opts.pad || 54;
  if (!lines.length) return '<svg class="chart" viewBox="0 0 '+W+' '+H+'"><text x="'+(W/2)+'" y="'+(H/2)+'" class="ax" text-anchor="middle">'+esc(opts.emptyText||"No data")+'</text></svg>';

  const vals = [], turns = [];
  for (const L of lines) { L.ys.forEach((v) => vals.push(v)); L.xs.forEach((t) => turns.push(t)); }

  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (opts.zeroFloor && lo > 0) lo = 0;
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const t0 = Math.min.apply(null, turns), t1 = Math.max.apply(null, turns);
  const X = (t) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD - 18);
  const Y = (v) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD - 22);

  let g = "";
  for (let i = 0; i < 5; i++) {
    const v = lo + ((hi - lo) * i) / 4, y = Y(v);
    g += '<line x1="'+PAD+'" y1="'+y.toFixed(1)+'" x2="'+(W-18)+'" y2="'+y.toFixed(1)+'" class="grid"/>';
    g += '<text x="'+(PAD-8)+'" y="'+(y+4).toFixed(1)+'" class="ax" text-anchor="end">'+esc((opts.fmt||fmtB)(v))+'</text>';
  }
  const step = Math.max(1, Math.round((t1 - t0) / 8));
  for (let t = t0; t <= t1; t += step) {
    g += '<text x="'+X(t).toFixed(1)+'" y="'+(H-PAD+20)+'" class="ax" text-anchor="middle">t'+t+'</text>';
  }
  // Context series first so the emphasised ("heavy") lines sit on top.
  const ordered2 = [...lines].sort((a, b) => (a.heavy ? 1 : 0) - (b.heavy ? 1 : 0));
  for (const L of ordered2) {
    const col = L.color || "#8b949e";
    const pts = L.xs.map((t, i) => X(t).toFixed(1)+","+Y(L.ys[i]).toFixed(1)).join(" ");
    if (L.heavy) {
      g += '<polyline points="'+pts+'" fill="none" stroke="#161b22" stroke-width="5.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    g += '<polyline points="'+pts+'" fill="none" stroke="'+col+'" stroke-width="'+(L.heavy?2:1.25)+'" stroke-opacity="'+(L.heavy?1:0.55)+'" stroke-linejoin="round" stroke-linecap="round"/>';
    const lx = L.xs[L.xs.length-1], ly = L.ys[L.ys.length-1];
    g += '<circle cx="'+X(lx).toFixed(1)+'" cy="'+Y(ly).toFixed(1)+'" r="'+(L.heavy?4:2.4)+'" fill="'+col+'" stroke="#161b22" stroke-width="2"/>';
    if (L.heavy || opts.alwaysLabel) {
      g += '<text x="'+(X(lx)+8).toFixed(1)+'" y="'+(Y(ly)+4).toFixed(1)+'" class="endlab" fill="'+col+'">'+esc(L.key)+'</text>';
    }
  }

  // Hover layer: a crosshair plus a readout of every series at the nearest turn.
  const xsAll = lines[0].xs;
  const cols = xsAll.map((t) => X(t));
  g += '<line class="crosshair" x1="0" y1="20" x2="0" y2="'+(H-PAD)+'" opacity="0"/>';
  g += '<rect class="hit" x="'+PAD+'" y="14" width="'+(W-PAD-18)+'" height="'+(H-PAD-14)+'" fill="transparent"/>';

  const seriesJson = escAttr(JSON.stringify(lines.map((L) => ({ c: L.key, col: L.color, ys: L.ys }))));
  const metaJson = escAttr(JSON.stringify({ xs: xsAll, cols, pad: PAD, w: W, fmtKey: opts.fmtKey || "num" }));
  return (
    '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" data-series="'+seriesJson+'" data-meta="'+metaJson+'">'
    + g + '</svg>'
  );
}

/** Draw one multi-series line chart over the active countries (D.series). */
function chart(metric, opts) {
  const cs = D.ordered.filter((c) => active.has(c) && D.series[c]);
  const lines = cs.map((c) => {
    const s = D.series[c];
    const norm = opts.index === true;
    const base = norm ? (s[metric][0] || 1) : 1;
    const ys = s[metric].map((v) => (norm ? (100 * v) / base : v));
    return { key: c, color: D.colors[c] || "#8b949e", xs: s.turn, ys, heavy: D.PLAYER.indexOf(c) >= 0 };
  }).sort((a, b) => (a.heavy?1:0) - (b.heavy?1:0));
  return drawMultiLine(lines, { ...opts, emptyText: "No countries selected" });
}

/**
 * Generic small-multiple line chart over an arbitrary {KEY: {turn, [field]: []}}
 * map — used for command-economy dials and money-supply trends, where the keys
 * are country codes but the series live outside D.series. Player countries
 * still draw heavy; everyone else shares the recessive neutral.
 */
function seriesChart(byKey, field, opts) {
  const keys = Object.keys(byKey).filter((k) => (byKey[k][field] || []).length > 0);
  const lines = keys.map((k) => ({
    key: k,
    color: D.colors[k] || "#8b949e",
    xs: byKey[k].turn,
    ys: byKey[k][field],
    heavy: D.PLAYER.indexOf(k) >= 0,
  })).sort((a, b) => (a.heavy?1:0) - (b.heavy?1:0));
  return drawMultiLine(lines, opts);
}

/** Simple vertical bar chart from [{label, value}], optionally colour-keyed. */
function barChart(items, opts) {
  const W = 900, H = opts.height || 260, PAD = 54, RIGHT = 18;
  if (!items.length) return '<svg class="chart" viewBox="0 0 '+W+' '+H+'"><text x="'+(W/2)+'" y="'+(H/2)+'" class="ax" text-anchor="middle">No data</text></svg>';
  const vals = items.map((it) => it.value);
  let hi = Math.max(0, Math.max.apply(null, vals)); if (hi <= 0) hi = 1;
  const bw = (W - PAD - RIGHT) / items.length;
  const Y = (v) => H - PAD - (v / hi) * (H - PAD - 20);
  let g = "";
  for (let i = 0; i < 5; i++) {
    const v = (hi * i) / 4, y = Y(v);
    g += '<line x1="'+PAD+'" y1="'+y.toFixed(1)+'" x2="'+(W-RIGHT)+'" y2="'+y.toFixed(1)+'" class="grid"/>';
    g += '<text x="'+(PAD-8)+'" y="'+(y+4).toFixed(1)+'" class="ax" text-anchor="end">'+esc((opts.fmt||fmtB)(v))+'</text>';
  }
  items.forEach((it, i) => {
    const x = PAD + i * bw, y = Y(it.value), h = H - PAD - y;
    const col = it.color || opts.color || "#3987e5";
    g += '<rect x="'+(x+bw*0.14).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+(bw*0.72).toFixed(1)+'" height="'+Math.max(0,h).toFixed(1)+'" fill="'+col+'" rx="2"/>';
    if (items.length <= 30) {
      g += '<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-PAD+18)+'" class="ax" text-anchor="middle" transform="rotate(0)">'+esc(it.label)+'</text>';
    }
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img">'+g+'</svg>';
}

/** Stacked vertical bar chart from [{label, segments:[{value,color,name}]}]. */
function stackedBarChart(items, opts) {
  const W = 900, H = opts.height || 260, PAD = 54, RIGHT = 18;
  if (!items.length) return '<svg class="chart" viewBox="0 0 '+W+' '+H+'"><text x="'+(W/2)+'" y="'+(H/2)+'" class="ax" text-anchor="middle">No data</text></svg>';
  const totals = items.map((it) => it.segments.reduce((s, seg) => s + seg.value, 0));
  let hi = Math.max.apply(null, totals, 0); if (hi <= 0) hi = 1;
  const bw = (W - PAD - RIGHT) / items.length;
  const Y = (v) => H - PAD - (v / hi) * (H - PAD - 20);
  let g = "";
  for (let i = 0; i < 5; i++) {
    const v = (hi * i) / 4, y = Y(v);
    g += '<line x1="'+PAD+'" y1="'+y.toFixed(1)+'" x2="'+(W-RIGHT)+'" y2="'+y.toFixed(1)+'" class="grid"/>';
    g += '<text x="'+(PAD-8)+'" y="'+(y+4).toFixed(1)+'" class="ax" text-anchor="end">'+esc((opts.fmt||fmtB)(v))+'</text>';
  }
  items.forEach((it, i) => {
    const x = PAD + i * bw;
    let cum = 0;
    for (const seg of it.segments) {
      const y0 = Y(cum), y1 = Y(cum + seg.value);
      g += '<rect x="'+(x+bw*0.14).toFixed(1)+'" y="'+y1.toFixed(1)+'" width="'+(bw*0.72).toFixed(1)+'" height="'+Math.max(0,y0-y1).toFixed(1)+'" fill="'+seg.color+'"/>';
      cum += seg.value;
    }
    g += '<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-PAD+18)+'" class="ax" text-anchor="middle">'+esc(it.label)+'</text>';
  });
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img">'+g+'</svg>';
}

/** Histogram bar chart from the server-precomputed {edges, counts} shape. */
function histChart(hist, opts) {
  if (!hist || !hist.counts || !hist.counts.length) return '<svg class="chart" viewBox="0 0 900 220"><text x="450" y="110" class="ax" text-anchor="middle">No data</text></svg>';
  const items = hist.counts.map((n, i) => ({
    label: (opts.edgeFmt||((v)=>v.toFixed(0)))(hist.edges[i]),
    value: n,
  }));
  return barChart(items, { height: opts.height || 220, fmt: (v)=>v.toFixed(0), color: opts.color });
}

/** Back-to-back horizontal age pyramid for one country. */
function pyramidChart(male, female, opts) {
  const W = 900, H = 320, PAD = 40, MID = W/2, BARH = 3;
  const n = Math.max(male.length, female.length);
  let hi = 0;
  for (let i=0;i<n;i++) { hi = Math.max(hi, male[i]||0, female[i]||0); }
  if (hi <= 0) hi = 1;
  const usable = (W/2) - PAD - 10;
  const availH = H - 30;
  const step = availH / n;
  let g = "";
  for (let i=0;i<n;i+=10) {
    const y = H - 20 - i*step;
    g += '<text x="'+(MID)+'" y="'+(y+3).toFixed(1)+'" class="ax" text-anchor="middle">'+i+'</text>';
  }
  for (let i=0;i<n;i++) {
    const y = H - 20 - i*step - BARH/2;
    const mw = ((male[i]||0)/hi)*usable, fw = ((female[i]||0)/hi)*usable;
    g += '<rect x="'+(MID-18-mw).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+mw.toFixed(1)+'" height="'+BARH+'" fill="#3987e5" opacity="0.85"/>';
    g += '<rect x="'+(MID+18).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+fw.toFixed(1)+'" height="'+BARH+'" fill="#d95926" opacity="0.85"/>';
  }
  g += '<text x="'+(MID-18-usable/2).toFixed(1)+'" y="16" class="ax" text-anchor="middle" fill="#3987e5">MALE</text>';
  g += '<text x="'+(MID+18+usable/2).toFixed(1)+'" y="16" class="ax" text-anchor="middle" fill="#d95926">FEMALE</text>';
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img">'+g+'</svg>';
}

/** Stacked bar chart of party seat share at sampled checkpoints over time. */
function seatShareChart(entry) {
  const PARTY_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
  const items = entry.points.map((p) => {
    const segments = entry.parties.map((party, i) => ({
      value: p.shares[party] || 0,
      color: PARTY_COLORS[i] || "#8b949e",
      name: party,
    }));
    segments.push({ value: p.otherPct, color: "#8b949e", name: "other" });
    return { label: "t"+p.turn, segments };
  });
  const legend = entry.parties.map((p, i) =>
    '<span class="lg2"><i style="background:'+(PARTY_COLORS[i]||"#8b949e")+'"></i>'+esc(p)+'</span>'
  ).join("") + '<span class="lg2"><i style="background:#8b949e"></i>other</span>';
  return '<div>'+legend+'</div>' + stackedBarChart(items, { fmt: (v)=>v.toFixed(0)+"%", height: 240 });
}

function chartBlock(id, title, metric, opts) {
  return '<div class="card"><h3>'+esc(title)+'</h3><div class="note" style="margin:6px 0 10px">'+esc(opts.note||"")+'</div><div class="scroll" id="'+id+'">'+chart(metric, opts)+'</div></div>';
}

const CHARTS = [
  { id: "c-gdp", title: "GDP (indexed, first observed turn = 100)", metric: "gdp", opts: { index: true, fmtKey: "idx", note: "Indexing removes the currency-scale differences — each nation is measured against its own starting output.", fmt: (v)=>v.toFixed(1) } },
  { id: "c-rev", title: "Corporate revenue (indexed)", metric: "corpRevenue", opts: { index: true, fmtKey: "idx", note: "A flat line is a finding, not a gap - a frozen production base. Planned economies whose state enterprises carry a zero growth target show up as perfectly horizontal.", fmt: (v)=>v.toFixed(1) } },
  { id: "c-infl", title: "Inflation (%)", metric: "inflation", opts: { fmtKey: "pct", note: "The model clamps inflation at 15%. A series resting exactly on that line is being HELD, not settling. A series resting exactly on that line is being held, not settling.", fmt: (v)=>v.toFixed(1)+"%" } },
  { id: "c-rate", title: "Policy rate (%)", metric: "interestRate", opts: { fmtKey: "pct", note: "A rate above 10% in 1953 is a spiral, not a stance. Share prices discount sectorNPV by the prime rate, so a tightening cycle reprices equities even while output grows.", fmt: (v)=>v.toFixed(1)+"%" } },
];

function redraw() {
  for (const c of CHARTS) {
    const el = document.getElementById(c.id);
    if (el) el.innerHTML = chart(c.metric, c.opts);
  }
  document.querySelectorAll(".chip").forEach((ch) => {
    ch.classList.toggle("on", active.has(ch.dataset.c));
  });
  // Charts were re-rendered, so the old listeners are gone with the old nodes.
  if (typeof attachHover === "function") attachHover();
}

function controls() {
  const chips = D.ordered.map((c) => {
    const isP = D.PLAYER.indexOf(c) >= 0;
    return '<span class="chip'+(isP?" player":"")+'" data-c="'+c+'"><i style="background:'+(D.colors[c]||"#8b949e")+'"></i>'+esc(D.NAMES[c]||c)+'</span>';
  }).join("");
  return '<div class="ctrl">'
    + '<button class="grp" data-g="player">Player countries</button>'
    + '<button class="grp" data-g="bloc">Eastern bloc</button>'
    + '<button class="grp" data-g="market">Market economies</button>'
    + '<button class="grp" data-g="all">All</button>'
    + '<button class="grp" data-g="none">None</button>'
    + '</div><div class="ctrl">'+chips+'</div>';
}

function render() {
  const h = D.health, m = D.market, a = D.activity;
  let html = "";
  html += '<h1>Grand Sim 1953 — Checkpoint '+h.turn+'</h1>';
  html += '<p class="sub">Database <code>'+esc(D.dbName)+'</code>'+(h.year?' · in-game year '+h.year:'')+' · '+D.ordered.length+' instrumented economies</p>';

  if (D.missingPlayers && D.missingPlayers.length) {
    html += '<div class="warnbox"><b>Instrumentation gap:</b> player '+(D.missingPlayers.length===1?"country":"countries")+' '
      + D.missingPlayers.map((c)=>esc(D.NAMES[c]||c)).join(", ")
      + ' produced no economy rows. COUNTRY_CONFIGS still marks '+(D.missingPlayers.length===1?"it":"them")
      + ' <code>coming-soon</code>, and the health snapshot only walks countries whose status is <code>active</code>.</div>';
  }

  // ── Verdict: data up front. What happened and is it trustworthy — before
  // any chart, so the reader never has to scroll to find out. ──────────────
  const VICON = { good: "✓", warn: "⚠", bad: "✗" };
  if (D.verdict && D.verdict.length) {
    html += '<h2>Verdict</h2>';
    for (const v of D.verdict) {
      html += '<div class="vd '+v.status+'"><div class="ic">'+VICON[v.status]+'</div><div><h3>'+esc(v.title)+'</h3><p>'+esc(v.detail)+'</p></div></div>';
    }
  }

  // Seed-audit findings: the judgement-call items, named with country + field.
  if (D.auditFindings && D.auditFindings.length) {
    html += '<h3 style="margin:22px 0 8px;font-size:16px">Findings</h3>';
    for (const f of D.auditFindings) {
      html += '<div class="finding '+f.severity+'"><div><h3>'+esc(D.NAMES[f.countryId]||f.countryId)+' — '+esc(f.title)+' <span class="sev sev-'+f.severity+'">'+esc(f.severity)+'</span></h3><p>'+esc(f.detail)+'</p></div></div>';
    }
  }

  // Seed-audit self-check: what the audit actually looked at vs what it could
  // not, so a reader can tell "verified healthy" apart from "not examined".
  if (D.auditSelfCheck && ((D.auditSelfCheck.checked && D.auditSelfCheck.checked.length) || (D.auditSelfCheck.skipped && D.auditSelfCheck.skipped.length))) {
    html += '<h3 style="margin:22px 0 8px;font-size:16px">Seed-audit coverage</h3>';
    if (D.auditSelfCheck.checked && D.auditSelfCheck.checked.length) {
      html += '<div class="note"><b>Checked:</b><ul>'+D.auditSelfCheck.checked.map((c)=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>';
    }
    if (D.auditSelfCheck.skipped && D.auditSelfCheck.skipped.length) {
      html += '<div class="note"><b>Not examined:</b><ul>'+D.auditSelfCheck.skipped.map((s)=>'<li>'+esc(s.reason)+'</li>').join('')+'</ul></div>';
    }
  }

  // Changelog
  if (D.changelog && D.changelog.length) {
    html += '<h2>What changed since the last checkpoint</h2>';
    for (const e of D.changelog) {
      const st = e.status || "pending";
      html += '<div class="log '+st+'"><h3>'+esc(e.title)+' <span class="badge b-'+st+'">'+esc(st)+'</span></h3><p>'+esc(e.detail)+'</p></div>';
    }
  }

  // Headline tiles
  html += '<div class="tiles">'
    + tile(h.errors===0?"good":"bad", h.errors, "engine errors", h.phases+" phases/turn")
    + tile("", (h.medianTurnMs/1000).toFixed(1)+"s", "median turn", h.turn+" turns processed")
    + tile(m.trips===0?"good":"bad", m.mode, "market mode", m.guardEnabled?"guard armed":"guard disarmed")
    + tile(m.trips===0?"good":"bad", m.trips, "guard trips", m.trips?("reverted by "+esc(m.updatedBy)):"capital tier held")
    + tile("", a.npps.toLocaleString(), "NPPs acting", a.parties+" parties")
    + tile("", a.nppCorps.toLocaleString()+" / "+a.corps.toLocaleString(), "NPP-founded corps", a.sectors+" sectors")
    + tile(a.unionsLed===0?"warn":"", a.unionsLed+" / "+a.unions, "unions with a leader", a.unionsLed===0?"no NPP union agency":"")
    + tile("", a.laws.toLocaleString(), "laws enacted", a.billsSigned+" signed · "+a.billsFailed+" failed")
    + '</div>';

  // Narrative
  html += '<h2>What happened</h2>';
  for (const n of D.narrative) {
    html += '<div class="narr'+(n.countryId==="WORLD"?" world":"")+'"><h3>'+esc(n.title)+'</h3><p>'+esc(n.body)+'</p></div>';
  }

  // Interactive charts
  html += '<h2>Economies</h2>';
  html += '<div class="note">Toggle any country or group. Player countries draw with a heavier stroke.</div>';
  html += controls();
  for (const c of CHARTS) html += chartBlock(c.id, c.title, c.metric, c.opts);

  // Market cap
  if (D.mcap && D.mcap.turn.length) {
    html += '<h2>Market capitalisation</h2><div class="card"><div class="scroll">'+mcapChart()+'</div></div>';
  }

  // Money supply — per player country, so a dead monetary layer is visible.
  if (D.money && D.money.enabled) {
    html += '<h2>Money supply</h2><div class="note">M1/M2 per country, in each country’s own local currency (see the Currency column) — a Soviet M2 figure and a US M2 figure are not the same unit and must not be read as comparable. The inflation model reads money-supply growth and silently degrades it to GDP growth when the snapshots are absent, so a flat or missing series here means the monetary channel is contributing nothing.</div>';
    html += '<div class="card scroll"><table><thead><tr><th>Nation</th><th>Currency</th><th>M1</th><th>M2</th><th>M2 growth (annualised)</th><th>as of</th></tr></thead><tbody>';
    for (const cid of D.money.countries) {
      const m = D.money.byCountry[cid];
      if (!m) continue;
      const isP = D.PLAYER.indexOf(cid) >= 0;
      html += '<tr' + (isP ? ' class="player"' : '') + '><td><b>' + esc(D.NAMES[cid] || cid) + '</b></td>'
        + '<td>' + esc(m.currency || cid) + '</td>'
        + '<td>' + fmtMoney(m.m1) + '</td>'
        + '<td>' + fmtMoney(m.m2) + '</td>'
        + '<td>' + (m.growth || 0).toFixed(2) + '%</td>'
        + '<td>t' + m.turn + '</td></tr>';
    }
    html += '</tbody></table></div>';

    // Per-country trend, not just the latest reading — player + bloc, since
    // command-economy monetary overhang is the whole point of this run.
    if (D.moneyTrend && D.moneyTrend.countries.length) {
      html += '<div class="note" style="margin-top:16px">M1/M2 <b>trend</b> for player + bloc countries. Per the money-supply instrumentation audit, M2 for several countries is dominated by <code>externalBroadMoney</code> — a SEEDED CONSTANT — so a flat or oddly-spiky growth line there is exogenous, not a real policy signal (flagged below where it applies).</div>';
      if (D.moneyTrend.exogenousMoney && D.moneyTrend.exogenousMoney.length) {
        html += '<div class="warnbox"><b>Exogenous/frozen M2:</b> ' + D.moneyTrend.exogenousMoney.map((c)=>esc(D.NAMES[c]||c)).join(', ') + ' — externalBroadMoney is ≥95% of M2 on average across the run.</div>';
      }
      if (D.moneyTrend.missingMoneySupply && D.moneyTrend.missingMoneySupply.length) {
        html += '<div class="warnbox"><b>No instrumentation at all:</b> ' + D.moneyTrend.missingMoneySupply.map((c)=>esc(D.NAMES[c]||c)).join(', ') + ' carry zero moneySupplySnapshots rows.</div>';
      }
      html += '<div class="card"><h3>M2 (local currency, trend)</h3><div class="scroll">' + seriesChart(D.moneyTrend.byCountry, "m2", { fmt: fmtMoney, fmtKey: "money" }) + '</div></div>';
      html += '<div class="card"><h3>M2 growth, annualised (%)</h3><div class="scroll">' + seriesChart(D.moneyTrend.byCountry, "growth", { fmt: (v)=>v.toFixed(1)+"%", fmtKey: "pct", zeroFloor: true }) + '</div></div>';
    }
  } else {
    html += '<div class="warnbox"><b>Money supply is not being recorded.</b> moneySupplyEnabled is off or the snapshot phase is not running, so the monetary transmission channel contributes nothing to inflation.</div>';
  }

  // Command economies — economicFactors dials that had no visual at all.
  if (D.commandEconomy && D.commandEconomy.countries.length) {
    html += '<h2>Command economies</h2><div class="note">federalBudget.economicFactors carries six dials per bloc country, sourced here from federalBudgetSnapshots (one row per fiscal year, ~48 turns apart) so the ARC is visible, not just the latest reading.</div>';
    if (D.commandEconomy.marketizationStuck.length) {
      html += '<div class="warnbox"><b>marketizationLevel stuck at 0:</b> ' + D.commandEconomy.marketizationStuck.map((c)=>esc(D.NAMES[c]||c)).join(', ') + '. Diagnosed as a one-sided pull (run2): the frozen party charter (weight 0.6 × -5) outweighs the live Gosbank channel’s +0.4 cap, so the dial cannot structurally clear zero once it arrives there. A hardline stance sitting at 0 is legitimate; never being ABLE to leave it is the bug.</div>';
    }
    const CE_CHARTS = [
      { field: "marketizationLevel", title: "Marketization level", fmt: (v)=>v.toFixed(1) },
      { field: "shortageIndex", title: "Shortage index", fmt: (v)=>v.toFixed(1) },
      { field: "monetaryOverhang", title: "Monetary overhang", fmt: (v)=>v.toFixed(1) },
      { field: "blackMarketPremium", title: "Black-market premium", fmt: (v)=>(v*100).toFixed(1)+"%" },
      { field: "governmentReformism", title: "Government reformism (-1 hardline to +1 reform)", fmt: (v)=>v.toFixed(2) },
      { field: "internalRepression", title: "Internal repression (0-1)", fmt: (v)=>v.toFixed(2) },
    ];
    const ceLegend = D.commandEconomy.countries.map((c) =>
      '<span class="lg2"><i style="background:'+(D.colors[c]||"#8b949e")+'"></i>'+esc(D.NAMES[c]||c)+'</span>'
    ).join("");
    html += '<div style="margin:10px 0 4px">' + ceLegend + '</div>';
    for (const cc of CE_CHARTS) {
      html += '<div class="card"><h3>' + esc(cc.title) + '</h3><div class="scroll">' + seriesChart(D.commandEconomy.byCountry, cc.field, { fmt: cc.fmt, height: 240 }) + '</div></div>';
    }
  }

  // Disasters & crises — enabled is not the same as firing.
  html += '<h2>Disasters &amp; crises</h2>';
  if (D.events && (D.events.crises > 0 || D.events.disasters > 0)) {
    html += '<div class="note">' + D.events.crises + ' crises and ' + D.events.disasters + ' disasters have fired. NPPs can reach the legislative aid path (' + D.events.aidBills + ' aid-shaped bills); the crisis decision-tree engine is character-only and inert in an NPP world.</div>';
    if (D.crisesByCountry && D.crisesByCountry.length) {
      html += '<div class="card scroll">' + barChart(D.crisesByCountry.slice(0,20).map((c)=>({label:c.countryId, value:c.n, color: D.colors[c.countryId] || "#8b949e"})), { fmt: (v)=>v.toFixed(0) }) + '</div>';
    }
    if (D.events.crisisImpact && D.events.crisisImpact.length) {
      html += '<div class="card scroll"><table><thead><tr><th>Template</th><th>Fired</th><th>Resolved</th><th>Countries</th></tr></thead><tbody>';
      for (const c of D.events.crisisImpact) {
        html += '<tr><td>' + esc(c.template) + '</td><td>' + c.count + '</td><td>' + c.resolved + '</td><td>' + c.countries.map((x)=>esc(x)).join(", ") + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
  } else {
    html += '<div class="warnbox"><b>Zero crises and zero disasters.</b> Both spawners iterate a country list; an empty list produces no events while every phase still reports completed. Check that the list is resolved by simulated status, not player enablement.</div>';
  }

  // Corporate movers — player countries first, then notable elsewhere.
  if (D.corporate) {
    html += '<div class="note"><b>Firm counts in planned economies are not comparable to market ones.</b> The Soviet Union and East Germany group their state enterprises into a handful of corporation records holding many sectors each \u2014 the USSR runs 136 producing sectors behind 9 corporations \u2014 so a low firm count there is the seeding model, not a collapse. Compare sector counts and revenue, not company counts, across the two blocs.</div>';
        if (D.marginVariation && D.marginVariation.operating) {
      const o = D.marginVariation.operating;
      html += '<div class="note"><b>Margins:</b> the margin column in the table below is <b>book</b> margin (income \u00f7 revenue), which reads low or negative whenever dividends and depreciation run ahead of booked income \u2014 on its own that is not a distress signal. The engine also persists an <b>operating</b> margin (effectiveProfitMargin): across ' + o.n + ' sectors it runs ' + o.min.toFixed(1) + '% to ' + o.max.toFixed(1) + '%, mean ' + o.mean.toFixed(1) + '%, with ' + o.negativeShare.toFixed(1) + '% negative, over ' + D.marginVariation.distinctValues + ' distinct values \u2014 a world with only a handful is a frozen column rather than a healthy spread.</div>';
    }
    html += '<h2>Corporations</h2><div class="note">' + D.corporate.total + ' firms trading at this checkpoint (' + D.corporate.liveNow + ' rows survive in the live collection at end of run). Ranked by market cap within each player country.</div>';
    if (D.corporate.countByCountry && D.corporate.countByCountry.length) {
      html += '<div class="note"><b>Firms by nation:</b> ' + D.corporate.countByCountry.map((r)=>esc(D.NAMES[r[0]]||r[0])+' '+r[1]).join(' \u00b7 ') + '</div>';
    }
    for (const cid of D.PLAYER) {
      const list = D.corporate.byPlayerCountry[cid] || [];
      if (!list.length) continue;
      const curr = (list[0] && list[0].currency) || cid;
      html += '<div class="card"><h3>' + esc(D.NAMES[cid] || cid) + ' <span style="color:#8b949e;font-weight:400;font-size:12px">(figures in ' + esc(curr) + ')</span></h3><div class="scroll"><table><thead><tr><th>Company</th><th>Sector</th><th>Market cap</th><th>Revenue (annualised)</th><th>Margin</th><th>Rating</th></tr></thead><tbody>';
      for (const c of list) {
        html += '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.type) + '</td>'
          + '<td>' + fmtMoney(c.mcap) + '</td>'
          + '<td>' + fmtMoney(c.revenue) + '</td>'
          + '<td>' + (c.margin || 0).toFixed(1) + '%</td>'
          + '<td>' + esc(c.rating) + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }
    if (D.corporate.elsewhere && D.corporate.elsewhere.length) {
      html += '<div class="card"><h3>Notable elsewhere</h3><div class="note" style="margin:4px 0 10px">Spans multiple nations in their own local currencies — see the Currency column before comparing market caps across rows.</div><div class="scroll"><table><thead><tr><th>Company</th><th>Nation</th><th>Currency</th><th>Sector</th><th>Market cap</th><th>Revenue (annualised)</th></tr></thead><tbody>';
      for (const c of D.corporate.elsewhere) {
        html += '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(D.NAMES[c.countryId] || c.countryId) + '</td><td>' + esc(c.currency || c.countryId) + '</td><td>' + esc(c.type) + '</td><td>' + fmtMoney(c.mcap) + '</td><td>' + fmtMoney(c.revenue) + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }

    // Firm-count trend — the arc, not just this checkpoint's snapshot. A prior
    // run fell 432 to 88 with nothing flagged defunct; this is the chart that
    // would have shown it happening in real time instead of at the postmortem.
    if (D.corpTrend && D.corpTrend.turn.length) {
      html += '<div class="cards2">';
      html += '<div class="card"><h3>Firms trading, over time</h3><div class="scroll">' + drawMultiLine([{ key: "firms", color: "#3987e5", xs: D.corpTrend.turn, ys: D.corpTrend.firms, heavy: true }], { fmt: (v)=>v.toFixed(0), alwaysLabel: false }) + '</div></div>';
      html += '<div class="card"><h3>Loss-making firms (%)</h3><div class="scroll">' + drawMultiLine([{ key: "loss %", color: "#f85149", xs: D.corpTrend.turn, ys: D.corpTrend.negativeShare, heavy: true }], { fmt: (v)=>v.toFixed(0)+"%", zeroFloor: true }) + '</div></div>';
      html += '</div>';
    }

    // Margin distribution as an actual histogram — how many distinct values
    // exist across the whole world, not just the top-6 table already shown.
    if (D.marginHistogram && D.marginHistogram.n) {
      html += '<div class="card"><h3>Operating margin distribution (effectiveProfitMargin, ' + D.marginHistogram.n + ' sectors)</h3><div class="scroll">' + histChart(D.marginHistogram, { edgeFmt: (v)=>v.toFixed(0)+"%", color: "#199e70" }) + '</div></div>';
    }

    // Consolidation — what share of each player country's total mcap its top
    // 3 firms hold. The company table only ever shows the top 6 by mcap; it
    // cannot show whether that top slice IS most of the economy.
    if (D.consolidation && D.consolidation.length) {
      html += '<div class="card"><h3>Consolidation — top-3 firms’ share of total market cap</h3><div class="note" style="margin:4px 0 10px">High and rising means a handful of firms dominate that nation’s corporate sector. Command economies are excluded here — their state enterprises are not exchange-traded, so market cap is structurally 0 rather than fragmented.</div><div class="scroll">' + barChart(D.consolidation.map((c)=>({label:c.countryId, value:c.top3SharePct, color: D.colors[c.countryId]||"#8b949e"})), { fmt: (v)=>v.toFixed(0)+"%" }) + '</div></div>';
    }

    // Sector composition by country (player countries) — workforce per sector,
    // stacked so the shape of each economy is visible at a glance.
    if (D.sectorComposition && D.sectorComposition.length) {
      const SECTOR_PALETTE = ["#3987e5","#d95926","#199e70","#c98500","#8b949e","#6e40c9","#bf3989","#2f81f7"];
      const byCountry = {};
      for (const r of D.sectorComposition) (byCountry[r.countryId] ??= []).push(r);
      const sectorNames = [...new Set(D.sectorComposition.map((r)=>r.sectorType))];
      const items = D.PLAYER.filter((c)=>byCountry[c]).map((cid) => {
        const rows = byCountry[cid].sort((a,b)=>b.workers-a.workers);
        return { label: cid, segments: rows.map((r) => ({ value: r.workers, color: SECTOR_PALETTE[sectorNames.indexOf(r.sectorType) % SECTOR_PALETTE.length], name: r.sectorType })) };
      });
      html += '<div class="card"><h3>Sector composition by workforce (player countries)</h3><div class="note" style="margin:4px 0 10px">Stacked by workers per sector — hover colours are not consistent across countries at this scale; see the per-country tables above for exact sector names.</div><div class="scroll">' + stackedBarChart(items, { fmt: (v)=>v.toFixed(0) }) + '</div></div>';
    }
  }

  // Fiscal table
  if (D.control && D.control.length) {
    html += '<h2>Who holds power</h2><div class="note">Seat control over time for the player democracies, from the per-turn seat snapshot (this covers every office type recorded for the US and UK — including the single-holder presidency and vice-presidency, snapshotted the same way as a chamber). <b>Largest party</b> and <b>majority</b> are shown separately on purpose: a plurality is not control, and a chamber with no majority row is a hung one, which is a finding rather than missing data.</div>';

    // Alternation summary — the question the owner actually cares about
    // ("does power alternate") compressed into one row per chamber, so it
    // does not require reading every spells table to answer.
    html += '<h3 style="margin:18px 0 8px;font-size:16px">Power alternation</h3>';
    html += '<div class="card scroll"><table><thead><tr><th>Chamber</th><th>Control changes</th><th>Avg spell length</th><th>Observed window</th><th>Verdict</th></tr></thead><tbody>';
    for (const c of D.control) {
      const never = c.alternations === 0;
      html += '<tr><td><b>' + esc(D.NAMES[c.countryId] ?? c.countryId) + '</b> — ' + esc(c.officeType) + '</td>'
        + '<td' + (never ? ' class="neg"' : '') + '>' + c.alternations + '</td>'
        + '<td>' + c.avgSpellTurns + ' turns (~' + c.avgSpellYears + ' yr)</td>'
        + '<td>t' + c.firstTurn + '–t' + c.last.turn + '</td>'
        + '<td' + (never ? ' class="neg"' : ' class="pos"') + '>' + (never ? 'Never alternated' : 'Alternated') + '</td></tr>';
    }
    html += '</tbody></table></div>';

    // Seat share over time — the visual the alternation TABLE cannot give:
    // whether a "majority" was a landslide or a bare 51%, and how it drifted
    // between the sampled checkpoints.
    if (D.seatShare && D.seatShare.length) {
      html += '<h3 style="margin:22px 0 8px;font-size:16px">Party seat share over time</h3>';
      html += '<div class="note">Sampled at a handful of checkpoints across the observed window (a per-turn stack is more precision than a bar chart can show). Top 4 parties by best-ever share, plus an "other" bucket.</div>';
      for (const s of D.seatShare) {
        html += '<div class="card"><h3>' + esc(D.NAMES[s.countryId] || s.countryId) + ' — ' + esc(s.officeType) + '</h3><div class="scroll">' + seatShareChart(s) + '</div></div>';
      }
    }

    // Winning-margin distribution — were the underlying races actually close,
    // independent of whether the chamber ever changed hands.
    if (D.winMargins && D.winMargins.n) {
      html += '<h3 style="margin:22px 0 8px;font-size:16px">Winning-margin distribution</h3>';
      html += '<div class="note">' + D.winMargins.n + ' resolved US/UK races, binned by winning margin (percentage points between 1st and 2nd place). Mass near 0 means genuinely competitive races; mass near 100 means landslides regardless of how often control changed hands.</div>';
      html += '<div class="card scroll">' + histChart(D.winMargins, { edgeFmt: (v)=>v.toFixed(0)+"pt", color: "#3987e5" }) + '</div>';
    }

    for (const c of D.control) {
      const spells = c.spells;
      html += '<h3 style="margin:22px 0 8px;font-size:16px">' + esc(D.NAMES[c.countryId] ?? c.countryId) + ' — ' + esc(c.officeType) + '</h3>';
      if (c.totalRange && c.totalRange.min !== c.totalRange.max) {
        html += '<div class="warnbox"><b>Seat total is not stable across this history:</b> the reported chamber size ranged from ' + c.totalRange.min + ' to ' + c.totalRange.max + ' seats across the observed turns. Treat "N of total seats" below as a snapshot at the time, not a fixed chamber roster — the underlying seat accounting has a gap.</div>';
      }
      html += '<div class="card scroll"><table><thead><tr><th>from turn</th><th>to turn</th><th>controlling party</th><th>turns</th></tr></thead><tbody>';
      for (const sp of spells.slice(-14)) {
        const held = sp.to - sp.from + 1;
        const hung = sp.who.indexOf('no majority') === 0;
        html += '<tr><td>' + sp.from + '</td><td>' + sp.to + '</td><td' + (hung ? ' style="color:#e3b341"' : '') + '>' + esc(sp.who) + '</td><td>' + held + '</td></tr>';
      }
      html += '</tbody></table></div>';
      const L = c.last;
      html += '<div class="note">' + c.observed + ' turns observed (t' + c.firstTurn + '–t' + L.turn + '), ' + spells.length + ' control spell(s), ' + c.alternations + ' change(s) of control, average spell ' + c.avgSpellTurns + ' turns (~' + c.avgSpellYears + ' yr). Latest: ' + esc(L.majority ?? ('no majority; largest is ' + L.leader)) + ' with ' + L.leaderSeats + ' of ' + L.total + ' seats.</div>';
      if (c.diagnosis) {
        html += '<div class="warnbox"><b>Diagnosis:</b> ' + esc(c.diagnosis) + '</div>';
      }
    }
  }
  if (D.governors && D.governors.length) {
    html += '<h2>Governorships</h2><div class="card scroll"><table><thead><tr><th>country</th><th>party</th><th>governorships</th></tr></thead><tbody>';
    for (const g of D.governors.slice(0, 18)) {
      html += '<tr><td>' + esc(g.countryId) + '</td><td>' + esc(g.party) + '</td><td>' + g.n + '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  // Bills introduced vs enacted — one bill row IS an introduction, so total
  // is introduced and signed is enacted; failed and active fill the gap.
  if (D.bills && D.bills.length) {
    html += '<h2>Bills introduced vs. enacted</h2><div class="note">Every legislature in the world, ranked by total bills introduced. A country with many introduced and few signed is not necessarily gridlocked — check the failed/active split before reading it that way.</div>';
    const legend = '<span class="lg2"><i style="background:#3fb950"></i>signed</span><span class="lg2"><i style="background:#f85149"></i>failed</span><span class="lg2"><i style="background:#e3b341"></i>active</span>';
    const billItems = D.bills.slice(0, 20).map((b) => ({
      label: b.countryId,
      segments: [
        { value: b.signed, color: "#3fb950" },
        { value: b.failed, color: "#f85149" },
        { value: b.active, color: "#e3b341" },
      ],
    }));
    html += '<div class="card scroll">' + legend + stackedBarChart(billItems, { fmt: (v)=>v.toFixed(0) }) + '</div>';
  }

  html += '<h2>Fiscal position</h2><div class="note"><b>GDP is in each nation’s own local currency</b> (Currency column) — it is stored that way by design and a raw figure is NOT comparable across countries (a US dollar GDP and a Soviet ruble GDP are different units, and older Western European currencies pre-revaluation are a different order of magnitude again). Compare the ratio columns (Spend/GDP, Deficit/GDP, Debt/GDP) across nations instead — those are unit-free.</div>';
  html += '<div class="card scroll"><table><thead><tr>'
    + '<th>Nation</th><th>Currency</th><th>GDP</th><th>Spend / GDP</th><th>Deficit / GDP</th><th>Debt / GDP</th><th>Rating</th><th>State</th>'
    + '</tr></thead><tbody>';
  for (const f of D.fiscal) {
    const isP = D.PLAYER.indexOf(f.countryId) >= 0;
    html += '<tr'+(isP?' class="player"':'')+'><td><b>'+esc(D.NAMES[f.countryId]||f.countryId)+'</b></td>'
      + '<td>'+esc(f.currency||f.countryId)+'</td>'
      + '<td>'+fmtMoney(f.gdp)+'</td>'
      + '<td>'+f.spendPctGdp.toFixed(1)+'%</td>'
      + '<td class="'+(f.deficitPctGdp>0?"neg":"pos")+'">'+f.deficitPctGdp.toFixed(1)+'%</td>'
      + '<td>'+(f.debtToGdp*100).toFixed(0)+'%</td>'
      + '<td>'+esc(f.rating)+'</td><td>'+esc(f.crisis)+'</td></tr>';
  }
  html += '</tbody></table></div>';

  // Demography — age pyramids, current-state only (no historized age series
  // exists, so this describes the population as of THIS checkpoint's turn).
  if (D.demography && D.demography.countries.length) {
    html += '<h2>Demography</h2><div class="note">Age pyramids summed from every sub-national region to the country level. This is a CURRENT-STATE read only — no per-turn age history is recorded, so it describes the population as of this checkpoint, not its arc across the run.</div>';
    html += '<div class="cards2">';
    for (const cid of D.PLAYER) {
      const dm = D.demography.byCountry[cid];
      if (!dm) continue;
      html += '<div class="card"><h3>' + esc(D.NAMES[cid]||cid) + ' <span style="color:#8b949e;font-weight:400;font-size:12px">median age ' + dm.medianAge + ', total ' + fmtMoney(dm.total) + '</span></h3><div class="scroll">' + pyramidChart(dm.male, dm.female) + '</div></div>';
    }
    html += '</div>';
    const missingDemo = D.PLAYER.filter((c)=>!D.demography.byCountry[c]);
    if (missingDemo.length) {
      html += '<div class="warnbox"><b>No regionDemographics rows for:</b> ' + missingDemo.map((c)=>esc(D.NAMES[c]||c)).join(', ') + '.</div>';
    }
  }

  // Labour — unionization, wage demands, strikes. membershipPressure reads
  // exactly 0 for every union in the world against an ADR-5 seed of 20; that
  // is reported as a finding above (Verdict), not repeated as a neutral chart.
  if (D.labour) {
    html += '<h2>Labour</h2><div class="note">' + D.labour.led + '/' + D.labour.unions + ' unions have a leader, ' + D.labour.wageDemandsSet + '/' + D.labour.unions + ' have set a wage demand, ' + D.labour.strikes + ' strikes called across the run.</div>';
    if (D.labour.pressureAllZero) {
      html += '<div class="warnbox"><b>membershipPressure is exactly 0 for all ' + D.labour.unions + ' unions</b> — against an ADR-5 seed of 20 (the organizing threshold). This is a live discrepancy from the seeded starting point, not organic labour peace.</div>';
    }
    if (D.labour.unionizationZeroShare >= 90) {
      html += '<div class="warnbox"><b>corporateSectors.unionization is exactly 0 for ' + D.labour.unionizationZeroShare.toFixed(1) + '% of sectors.</b> A field this flat is a finding, not a healthy calm — the bargaining lever exists structurally but is not being written to.</div>';
    }
    html += '<div class="cards2">';
    html += '<div class="card"><h3>Wage demands set (' + D.labour.wageHistogram.n + ' unions)</h3><div class="scroll">' + histChart(D.labour.wageHistogram, { edgeFmt: (v)=>v.toFixed(2), color: "#c98500" }) + '</div></div>';
    html += '<div class="card"><h3>Sector unionization — distinct values</h3><div class="note" style="margin:4px 0 10px">' + D.labour.unionizationBreakdown.length + ' distinct value(s) across all sectors.</div><div class="scroll">' + barChart(D.labour.unionizationBreakdown.map((r)=>({label:String(r._id), value:r.n, color:"#3987e5"})), { fmt: (v)=>v.toFixed(0) }) + '</div></div>';
    html += '</div>';
  }

  // SCOTUS — cases decided vs pending, affirmed vs diverged.
  if (D.scotus && D.scotus.total) {
    html += '<h2>Supreme Court</h2><div class="note">' + D.scotus.total + ' docketed cases: ' + D.scotus.decided + ' decided (' + D.scotus.affirmed + ' affirmed, ' + D.scotus.diverged + ' diverged from the historical majority direction), ' + D.scotus.pending + ' still pending.</div>';
    html += '<div class="card scroll">' + barChart([
      { label: "affirmed", value: D.scotus.affirmed, color: "#3fb950" },
      { label: "diverged", value: D.scotus.diverged, color: "#f85149" },
      { label: "pending", value: D.scotus.pending, color: "#8b949e" },
    ], { fmt: (v)=>v.toFixed(0), height: 200 }) + '</div>';
    html += '<div class="card scroll"><table><thead><tr><th>Case</th><th>Axis</th><th>Status</th><th>Outcome</th><th>Decided at</th></tr></thead><tbody>';
    for (const c of D.scotus.cases) {
      html += '<tr><td><b>' + esc(c.title) + '</b></td><td>' + esc(c.axis) + '</td><td>' + esc(c.status) + '</td><td' + (c.outcome==="diverged"?' style="color:#f85149"':c.outcome==="affirmed"?' style="color:#3fb950"':'') + '>' + esc(c.outcome||'—') + '</td><td>' + (c.decidedAtTurn!=null?'t'+c.decidedAtTurn:'—') + '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  // Integrity
  if (h.issues && h.issues.length) {
    html += '<h2>Engine-reported integrity issues</h2>';
    for (const i of h.issues) {
      html += '<div class="log '+(i.severity==="error"?"failed":"partial")+'"><h3>'+esc(i.category)+' <span class="badge b-'+(i.severity==="error"?"failed":"partial")+'">'+esc(i.severity)+'</span></h3><p>'+esc(i.message)+'</p></div>';
    }
  }

  html += '<h2>Method</h2><div class="note">Generated by <code>scripts/sim/checkpointReport.ts</code> against the isolated sandbox database <code>'+esc(D.dbName)+'</code>. Production is never read or written. Charts are drawn client-side from the inlined dataset, so every series is the raw snapshot value.</div>';

  root.innerHTML = html;

  document.querySelectorAll(".chip").forEach((ch) => {
    ch.addEventListener("click", () => {
      const c = ch.dataset.c;
      if (active.has(c)) active.delete(c); else active.add(c);
      redraw();
    });
  });
  document.querySelectorAll(".grp").forEach((b) => {
    b.addEventListener("click", () => {
      const g = b.dataset.g;
      if (g === "all") active = new Set(D.ordered);
      else if (g === "none") active = new Set();
      else if (g === "player") active = new Set(D.PLAYER.filter((c)=>D.ordered.includes(c)));
      else if (g === "bloc") active = new Set(D.BLOC.filter((c)=>D.ordered.includes(c)));
      else active = new Set(D.ordered.filter((c)=>D.BLOC.indexOf(c)<0));
      redraw();
    });
  });
  redraw();
}

function mcapChart() {
  const W=900,H=280,PAD=54, xs=D.mcap.turn, ys=D.mcap.value;
  let lo=0, hi=Math.max.apply(null,ys); if(hi===lo)hi=lo+1; hi*=1.08;
  const t0=xs[0], t1=xs[xs.length-1];
  const X=(t)=>PAD+((t-t0)/Math.max(1,t1-t0))*(W-PAD-18);
  const Y=(v)=>H-PAD-((v-lo)/(hi-lo))*(H-PAD-22);
  let g="";
  for(let i=0;i<5;i++){const v=lo+((hi-lo)*i)/4,y=Y(v);
    g+='<line x1="'+PAD+'" y1="'+y.toFixed(1)+'" x2="'+(W-18)+'" y2="'+y.toFixed(1)+'" class="grid"/>';
    g+='<text x="'+(PAD-8)+'" y="'+(y+4).toFixed(1)+'" class="ax" text-anchor="end">$'+v.toFixed(1)+'B</text>';}
  const step=Math.max(1,Math.round((t1-t0)/8));
  for(let t=t0;t<=t1;t+=step) g+='<text x="'+X(t).toFixed(1)+'" y="'+(H-PAD+20)+'" class="ax" text-anchor="middle">t'+t+'</text>';
  g+='<polyline points="'+xs.map((t,i)=>X(t).toFixed(1)+","+Y(ys[i]).toFixed(1)).join(" ")+'" fill="none" stroke="#e5484d" stroke-width="2.4" stroke-linejoin="round"/>';
  return '<svg class="chart" viewBox="0 0 '+W+' '+H+'">'+g+'</svg>';
}

function tile(cls, v, label, sub) {
  return '<div class="tile '+cls+'"><div class="tv">'+esc(v)+'</div><div class="tl">'+esc(label)+'</div><div class="ts">'+esc(sub||"")+'</div></div>';
}

// ── Hover layer ────────────────────────────────────────────────────────────
// Crosshair + nearest-turn readout for every plotted series. Attached after each
// (re)draw because redraw() replaces the SVG nodes wholesale.
const tip = $('<div class="tip"></div>');
document.body.appendChild(tip);

function fmtVal(v, key) {
  if (key === "pct") return v.toFixed(2) + "%";
  if (key === "idx") return v.toFixed(1);
  return Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(1);
}

function attachHover() {
  document.querySelectorAll("svg.chart[data-series]").forEach((svg) => {
    let series, meta;
    try {
      series = JSON.parse(svg.getAttribute("data-series"));
      meta = JSON.parse(svg.getAttribute("data-meta"));
    } catch { return; }
    const hit = svg.querySelector(".hit");
    const cross = svg.querySelector(".crosshair");
    if (!hit || !cross || !series.length) return;

    hit.addEventListener("mousemove", (ev) => {
      const box = svg.getBoundingClientRect();
      // viewBox units, not CSS pixels — the SVG scales responsively.
      const vx = ((ev.clientX - box.left) / box.width) * meta.w;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < meta.cols.length; i++) {
        const d = Math.abs(meta.cols[i] - vx);
        if (d < bestD) { bestD = d; best = i; }
      }
      cross.setAttribute("x1", meta.cols[best]);
      cross.setAttribute("x2", meta.cols[best]);
      cross.setAttribute("opacity", "1");

      const rows = series
        .map((sd) => ({ c: sd.c, v: sd.ys[best] }))
        .filter((r) => r.v != null)
        .sort((a, b) => b.v - a.v)
        .slice(0, 10);
      tip.innerHTML =
        '<div class="t">turn ' + meta.xs[best] + '</div>' +
        rows.map((r) =>
          '<div class="r"><i style="background:' + (D.colors[r.c] || "#8b949e") + '"></i>' +
          esc(D.NAMES[r.c] || r.c) + '<b>' + fmtVal(r.v, meta.fmtKey) + '</b></div>'
        ).join("");
      tip.classList.add("on");
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = ev.clientX + 14, top = ev.clientY - th / 2;
      if (left + tw > window.innerWidth - 8) left = ev.clientX - tw - 14;
      tip.style.left = Math.max(8, left) + "px";
      tip.style.top = Math.max(8, Math.min(window.innerHeight - th - 8, top)) + "px";
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("opacity", "0");
      tip.classList.remove("on");
    });
  });
}

render();
attachHover();
</script></body></html>`;
}

// Guarded so unit tests can import runSeedAudit (and other pure helpers)
// without main() trying to connect to Mongo as a side effect of the import.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
