/**
 * Executive summary across a completed run.
 *
 * The per-checkpoint reports answer "what is the world like at turn N". This
 * answers the question they cannot: "what HAPPENED, across the whole run, and is
 * the result trustworthy". It reads every checkpoint at once, so the arc — a
 * frozen series, a slow corporate decline, a metric drifting toward a modern
 * value — is visible as a shape rather than as a number you have to hold in your
 * head across seven separate pages.
 *
 * Usage:
 *   npx tsx scripts/sim/executiveSummary.ts \
 *     --db=ahd_sim_grand53 --out=/tmp/exec.html \
 *     [--checkpoints=25,75,150,250,350,550,750,1000] \
 *     [--changelog=scripts/sim/runJournal.json]
 */
import { MongoClient } from "mongodb";
import { readFileSync, writeFileSync } from "node:fs";

const PLAYER = ["US", "UK", "RU", "DD"] as const;
const NAMES: Record<string, string> = {
  US: "United States",
  UK: "United Kingdom",
  RU: "Soviet Union",
  DD: "East Germany",
};
/** Validated dark-mode categorical slots 1-4 (see checkpointReport.ts). */
const COLORS: Record<string, string> = {
  US: "#3987e5",
  UK: "#d95926",
  RU: "#199e70",
  DD: "#c98500",
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

interface Checkpoint {
  turn: number;
  year: number | null;
  firms: number;
  avgIncome: number;
  lossPct: number;
  avgLiquid: number;
  margin: number;
  growth: number;
  crises: number;
  unionsLed: number;
  gdp: Record<string, number>;
  inflation: Record<string, number>;
  rate: Record<string, number>;
}

async function main(): Promise<void> {
  const uri = process.env.SIM_MONGODB_URI;
  if (!uri) throw new Error("SIM_MONGODB_URI is required (sandbox only).");
  const dbName = arg("db") ?? "ahd_sim_grand53";
  const outPath = arg("out") ?? "/tmp/exec.html";

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const maxTurn =
    (await db.collection("gameHealthSnapshots").find({}).sort({ turn: -1 }).limit(1).toArray())[0]
      ?.turn ?? 0;
  const requested = (arg("checkpoints") ?? "25,75,150,250,350,550,750,1000")
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n <= maxTurn);
  if (!requested.includes(maxTurn)) requested.push(maxTurn);

  const cps: Checkpoint[] = [];
  for (const target of requested) {
    const snap = (
      await db
        .collection("gameHealthSnapshots")
        .find({ turn: { $lte: target } })
        .sort({ turn: -1 })
        .limit(1)
        .toArray()
    )[0];
    if (!snap) continue;

    const corp = (
      await db
        .collection("corporationHistory")
        .aggregate<{ n: number; inc: number; neg: number; liq: number }>([
          { $match: { turn: snap.turn } },
          {
            $group: {
              _id: null,
              n: { $sum: 1 },
              inc: { $avg: "$income" },
              liq: { $avg: "$liquidCapital" },
              neg: { $sum: { $cond: [{ $lt: ["$income", 0] }, 1, 0] } },
            },
          },
        ])
        .toArray()
    )[0];

    const byCountry = (snap.economy?.byCountry ?? {}) as Record<string, Record<string, number>>;
    const pick = (k: string): Record<string, number> =>
      Object.fromEntries(PLAYER.map((c) => [c, byCountry[c]?.[k] ?? 0]));

    cps.push({
      turn: snap.turn as number,
      year: (snap.year as number) ?? null,
      firms: corp?.n ?? 0,
      avgIncome: corp?.inc ?? 0,
      lossPct: corp && corp.n > 0 ? (100 * corp.neg) / corp.n : 0,
      avgLiquid: corp?.liq ?? 0,
      margin: 0,
      growth: 0,
      crises: await db.collection("crises").countDocuments({ startTurn: { $lte: snap.turn } }),
      unionsLed: 0,
      gdp: pick("gdp"),
      inflation: pick("inflation"),
      rate: pick("interestRate"),
    });
  }

  // End-state figures that have no per-turn history.
  const sectorAgg = (
    await db
      .collection("corporateSectors")
      .aggregate<{ m: number; g: number }>([
        {
          $group: {
            _id: null,
            m: { $avg: "$effectiveProfitMargin" },
            g: { $avg: "$targetGrowthRate" },
          },
        },
      ])
      .toArray()
  )[0];
  const unionsLed = await db.collection("unions").countDocuments({ ownerId: { $ne: null } });
  const unionsTotal = await db.collection("unions").countDocuments();
  const strikes = await db
    .collection("unions")
    .countDocuments({ lastCalledStrikeTurn: { $ne: null } });

  const snaps = await db.collection("gameHealthSnapshots").find({}).sort({ turn: 1 }).toArray();
  const errors = snaps.reduce((n, s) => n + ((s.turnProcessing?.errorCount as number) ?? 0), 0);
  const warnings = snaps.reduce((n, s) => n + ((s.turnProcessing?.warningCount as number) ?? 0), 0);
  const cfg = (await db.collection("gameConfig").findOne({ _id: "default" as never })) ?? {};
  const guardTrips = await db
    .collection("adminLogs")
    .countDocuments({ action: "market_system_auto_reverted" });

  const changelogPath = arg("changelog");
  const changelog = changelogPath
    ? (JSON.parse(readFileSync(changelogPath, "utf8")) as Array<Record<string, string>>)
    : [];

  const first = cps[0];
  const last = cps[cps.length - 1];
  const payload = {
    dbName,
    cps,
    first,
    last,
    PLAYER,
    NAMES,
    COLORS,
    endState: {
      margin: sectorAgg?.m ?? 0,
      growth: sectorAgg?.g ?? 0,
      unionsLed,
      unionsTotal,
      strikes,
      errors,
      warnings,
      mode: String((cfg as Record<string, unknown>).marketSystemMode ?? "?"),
      guardArmed: (cfg as Record<string, unknown>).marketGuardEnabled === true,
      guardTrips,
    },
    changelog,
    verdict: buildVerdict(cps, errors, guardTrips, unionsLed, unionsTotal, strikes),
  };

  writeFileSync(outPath, render(payload));
  console.log(`Wrote ${outPath} — ${cps.length} checkpoints, turns ${first?.turn}-${last?.turn}.`);
  await client.close();
}

/**
 * The honest read. Each line states what was measured and what it means, and
 * anything unverified is named as unverified rather than quietly omitted.
 */
function buildVerdict(
  cps: Checkpoint[],
  errors: number,
  guardTrips: number,
  unionsLed: number,
  unionsTotal: number,
  strikes: number
): Array<{ status: "good" | "warn" | "bad"; title: string; detail: string }> {
  const out: Array<{ status: "good" | "warn" | "bad"; title: string; detail: string }> = [];
  const first = cps[0];
  const last = cps[cps.length - 1];
  if (!first || !last) return out;

  const firmDelta = first.firms > 0 ? (100 * (last.firms - first.firms)) / first.firms : 0;
  out.push({
    status: firmDelta < -25 ? "bad" : firmDelta < -5 ? "warn" : "good",
    title: `Corporate sector ${firmDelta >= 0 ? "held" : "shrank"}: ${first.firms} to ${last.firms} firms (${firmDelta.toFixed(1)}%)`,
    detail:
      "The prior 1000-turn run fell 432 to 88 with nothing flagged defunct, because growth cost was billed on nominal revenue but paid from realised revenue and no governor reached state-owned sectors.",
  });

  out.push({
    status: last.avgLiquid > first.avgLiquid ? "good" : "warn",
    title: `Average liquid capital ${last.avgLiquid > first.avgLiquid ? "rising" : "falling"}`,
    detail:
      "This, not accounting income, is what insolvency dissolution keys on. Rising cash with negative book income is a dividend/depreciation artefact, not distress.",
  });

  out.push({
    status: errors === 0 ? "good" : errors < 10 ? "warn" : "bad",
    title: `${errors} engine errors across ${last.turn} turns`,
    detail:
      "Phase throws are converted to warnings by the runtime, so a non-zero count here is the only signal that a phase died silently.",
  });

  out.push({
    status: guardTrips === 0 ? "good" : "warn",
    title: `Launch guard tripped ${guardTrips} time(s)`,
    detail:
      "The guard measures drawdown against what fundamentals justify, so an honest monetary repricing should not trip it. A trip means price decoupled from value.",
  });

  const clamped = PLAYER.filter((c) => (last.inflation[c] ?? 0) >= 14.9);
  if (clamped.length > 0) {
    out.push({
      status: "bad",
      title: `Inflation pinned at the 15% clamp: ${clamped.join(", ")}`,
      detail:
        "A series resting exactly on the model ceiling is being held, not settling — the underlying value wants to run higher.",
    });
  }

  out.push({
    status: strikes > 0 ? "good" : "warn",
    title: `${unionsLed}/${unionsTotal} unions led, ${strikes} strikes called`,
    detail:
      strikes === 0
        ? "Unions bargain but never strike. The lever exists and is still unproven in a long run."
        : "The full bargaining loop fired: leadership, demands, and strike action.",
  });

  return out;
}

function render(p: Record<string, unknown>): string {
  const json = JSON.stringify(p).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grand Sim 1953 — Executive Summary</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:34px;margin:0 0 4px;letter-spacing:-.025em}
h2{font-size:20px;margin:48px 0 14px;padding-bottom:8px;border-bottom:1px solid #21262d}
.sub{color:#8b949e;margin:0 0 24px;font-size:15px}
.hero{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin:24px 0 8px}
.h{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:18px}
.h .v{font-size:30px;font-weight:660;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.h .l{font-size:12px;color:#8b949e;margin-top:4px}
.h .d{font-size:11px;color:#6e7681;margin-top:6px}
.h.good{border-color:#2ea04366}.h.warn{border-color:#bb800966}.h.bad{border-color:#f8514966}
.v.good{color:#3fb950}.v.warn{color:#d29922}.v.bad{color:#f85149}
.card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:20px;margin:16px 0;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:640px}
th,td{text-align:right;padding:9px 10px;border-bottom:1px solid #21262d;white-space:nowrap;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left}
th{color:#8b949e;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.vd{display:flex;gap:12px;align-items:flex-start;background:#161b22;border:1px solid #21262d;border-left-width:4px;border-radius:10px;padding:14px 16px;margin:10px 0}
.vd.good{border-left-color:#3fb950}.vd.warn{border-left-color:#d29922}.vd.bad{border-left-color:#f85149}
.vd .ic{font-size:15px;line-height:1.5;flex:none}
.vd h3{margin:0 0 3px;font-size:15px}
.vd p{margin:0;color:#8b949e;font-size:13.5px}
.note{color:#8b949e;font-size:13px;border-left:2px solid #30363d;padding-left:12px;margin:14px 0}
svg.chart{width:100%;height:auto;display:block;min-width:600px}
.grid{stroke:#21262d;stroke-width:1}.ax{fill:#6e7681;font-size:11px}
.endlab{font-size:11px;font-weight:700}
.lg{display:inline-flex;align-items:center;font-size:12px;color:#8b949e;margin-right:16px}
.lg i{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:6px}
.badge{font-size:10px;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:5px;font-weight:700;margin-left:8px}
.b-worked{background:#2ea04322;color:#3fb950}.b-partial{background:#bb800922;color:#d29922}
.b-failed{background:#f8514922;color:#f85149}.b-pending{background:#6e768122;color:#8b949e}
code{background:#21262d;padding:1px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,monospace}
</style></head><body><div class="wrap" id="root"></div>
<script id="data" type="application/json">${json}</script>
<script>
const D = JSON.parse(document.getElementById("data").textContent);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const root = document.getElementById("root");
const ICON = { good: "\\u2713", warn: "\\u26a0", bad: "\\u2717" };

// Small multiple: one metric, player countries only, indexed where the note says so.
function spark(key, title, note, fmt, indexed) {
  const W = 900, H = 210, PAD = 52;
  const turns = D.cps.map((c) => c.turn);
  const series = D.PLAYER.map((c) => {
    const raw = D.cps.map((cp) => cp[key][c] ?? 0);
    const base = raw[0] || 1;
    return { c, ys: indexed ? raw.map((v) => (100 * v) / base) : raw };
  });
  const vals = series.flatMap((s) => s.ys);
  let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const t0 = turns[0], t1 = turns[turns.length - 1];
  const X = (t) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD - 46);
  const Y = (v) => H - PAD + 14 - ((v - lo) / (hi - lo)) * (H - PAD - 10);
  let g = "";
  for (let i = 0; i < 4; i++) {
    const v = lo + ((hi - lo) * i) / 3, y = Y(v);
    g += '<line x1="'+PAD+'" y1="'+y.toFixed(1)+'" x2="'+(W-46)+'" y2="'+y.toFixed(1)+'" class="grid"/>';
    g += '<text x="'+(PAD-8)+'" y="'+(y+4).toFixed(1)+'" class="ax" text-anchor="end">'+esc(fmt(v))+'</text>';
  }
  turns.forEach((t) => {
    g += '<text x="'+X(t).toFixed(1)+'" y="'+(H-18)+'" class="ax" text-anchor="middle">t'+t+'</text>';
  });
  for (const s of series) {
    const pts = turns.map((t, i) => X(t).toFixed(1)+","+Y(s.ys[i]).toFixed(1)).join(" ");
    g += '<polyline points="'+pts+'" fill="none" stroke="#161b22" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>';
    g += '<polyline points="'+pts+'" fill="none" stroke="'+D.COLORS[s.c]+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    const lx = turns[turns.length-1], ly = s.ys[s.ys.length-1];
    g += '<circle cx="'+X(lx).toFixed(1)+'" cy="'+Y(ly).toFixed(1)+'" r="3.5" fill="'+D.COLORS[s.c]+'" stroke="#161b22" stroke-width="2"/>';
    g += '<text x="'+(X(lx)+7).toFixed(1)+'" y="'+(Y(ly)+4).toFixed(1)+'" class="endlab" fill="'+D.COLORS[s.c]+'">'+esc(s.c)+'</text>';
  }
  return '<div class="card"><h3 style="margin:0 0 2px;font-size:15px">'+esc(title)+'</h3>'
    + '<div class="note" style="margin:6px 0 12px">'+esc(note)+'</div>'
    + '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img">'+g+'</svg></div>';
}

function render() {
  const e = D.endState, f = D.first, l = D.last;
  let h = "";
  h += '<h1>Grand Sim 1953 &mdash; Executive Summary</h1>';
  h += '<p class="sub">'+f.turn+' to '+l.turn+' turns'+(l.year?' &middot; '+f.year+' to '+l.year:'')+' &middot; <code>'+esc(D.dbName)+'</code> &middot; market tier <code>'+esc(e.mode)+'</code></p>';

  // Hero row: the five numbers that decide whether the run is trustworthy.
  const firmDelta = f.firms > 0 ? (100*(l.firms-f.firms))/f.firms : 0;
  h += '<div class="hero">';
  h += hero(e.errors===0?"good":"bad", e.errors, "engine errors", l.turn+" turns");
  h += hero(firmDelta<-25?"bad":firmDelta<-5?"warn":"good", l.firms, "firms at end", f.firms+" at start ("+firmDelta.toFixed(0)+"%)");
  h += hero(l.avgLiquid>f.avgLiquid?"good":"warn", (l.avgLiquid/1e6).toFixed(2)+"M", "avg liquid capital", "insolvency keys on this");
  h += hero(e.guardTrips===0?"good":"warn", e.guardTrips, "guard trips", e.guardArmed?"armed throughout":"disarmed");
  h += hero("", e.margin.toFixed(1), "avg effective margin", "growth target "+e.growth.toFixed(2));
  h += '</div>';

  h += '<h2>Verdict</h2>';
  for (const v of D.verdict) {
    h += '<div class="vd '+v.status+'"><div class="ic">'+ICON[v.status]+'</div><div><h3>'+esc(v.title)+'</h3><p>'+esc(v.detail)+'</p></div></div>';
  }

  h += '<h2>The arc</h2>';
  h += '<div class="note">Player countries only. Everything is measured against each nation\\'s own starting value, because seed GDP is denominated in LOCAL currency &mdash; comparing roubles to pounds as raw levels is meaningless.</div>';
  h += '<div style="margin:10px 0 4px">'+D.PLAYER.map((c)=>'<span class="lg"><i style="background:'+D.COLORS[c]+'"></i>'+esc(D.NAMES[c]||c)+'</span>').join("")+'</div>';
  h += spark("gdp", "GDP (indexed to first checkpoint = 100)", "Real output. A flat line is a frozen economy, not a stable one.", (v)=>v.toFixed(0), true);
  h += spark("inflation", "Inflation (%)", "The model clamps at 15. A series resting exactly on that line is being held.", (v)=>v.toFixed(1)+"%", false);
  h += spark("rate", "Policy rate (%)", "Above 10% in this era is a spiral rather than a stance.", (v)=>v.toFixed(1)+"%", false);

  h += '<h2>Checkpoint table</h2><div class="card"><table><thead><tr>'
    + '<th>Turn</th><th>Year</th><th>Firms</th><th>Avg income</th><th>Loss-making</th><th>Avg liquid</th><th>Crises</th>'
    + '</tr></thead><tbody>';
  for (const c of D.cps) {
    h += '<tr><td><b>t'+c.turn+'</b></td><td>'+(c.year??"")+'</td><td>'+c.firms+'</td>'
      + '<td>'+(c.avgIncome/1e3).toFixed(1)+'k</td><td>'+c.lossPct.toFixed(0)+'%</td>'
      + '<td>'+(c.avgLiquid/1e6).toFixed(2)+'M</td><td>'+c.crises+'</td></tr>';
  }
  h += '</tbody></table></div>';

  if (D.changelog && D.changelog.length) {
    h += '<h2>Interventions</h2><div class="note">Every code change, seed change and heal applied to reach this run, with its measured outcome. An intervention with no measured outcome stays <code>pending</code> rather than being promoted.</div>';
    for (const c of D.changelog) {
      const st = c.status || "pending";
      h += '<div class="vd '+(st==="worked"?"good":st==="failed"?"bad":"warn")+'"><div class="ic">'+(st==="worked"?ICON.good:st==="failed"?ICON.bad:ICON.warn)+'</div><div>'
        + '<h3>'+esc(c.title)+'<span class="badge b-'+st+'">'+esc(st)+'</span></h3>'
        + '<p>'+esc(c.evidence || c.detail || "")+'</p></div></div>';
    }
  }

  h += '<h2>Method</h2><div class="note">Generated by <code>scripts/sim/executiveSummary.ts</code> against the isolated sandbox. Corporate figures come from <code>corporationHistory</code> at each checkpoint turn, so they are as-of-turn rather than end-of-run. Production is never read or written.</div>';
  root.innerHTML = h;
}

function hero(cls, v, label, detail) {
  return '<div class="h '+cls+'"><div class="v '+cls+'">'+esc(v)+'</div><div class="l">'+esc(label)+'</div><div class="d">'+esc(detail)+'</div></div>';
}

render();
</script></body></html>`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
