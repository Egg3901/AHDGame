/**
 * Backfill stateMetrics values that read 0 from the region's stateBaseline.
 *
 * Context (#0962 gap audit): a long-running 1991 game (turn 1101) has metrics that the
 * current seed authors — e.g. crimeRate, preventableMortality — stored as 0, because the
 * game predates those values in the seed path. The stateBaselines ARE populated (era-correct
 * per country), so we restore each zeroed metric to its baseline (its resting/target value,
 * which the metric decays toward anyway) — internally consistent and era-appropriate.
 *
 * Safety:
 *   - DRY RUN by default; `--apply` to mutate. `--live` targets MONGODB_URI_LIVE.
 *   - Only backfills a (country, metric) that is SYSTEMATICALLY zero: value 0/missing in
 *     >=50% of that country's regions whose baseline is nonzero. This skips sporadic
 *     gameplay-driven zeros (a metric a policy genuinely crashed in a few regions).
 *   - Only backfills UNIVERSAL metrics — ones present (nonzero) in stateMetrics for >=3
 *     countries. The live stateBaselines are polluted with cross-country bespoke metrics
 *     (US baselines carry nonzero irishLanguageStrength / wohnungsBauRate / gniStarGap, …),
 *     so this gate keeps us from injecting one country's metrics into another.
 *   - Never touches mirror-owned (debtToGdp/budgetBalance/schuldenbremseHeadroom) or
 *     drift-owned (independenceDesire) metrics.
 *   - Idempotent: re-running finds nothing once applied.
 */
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const args = new Set(process.argv.slice(2));
const useLive = args.has("--live");
const apply = args.has("--apply");
const SYSTEMATIC_FRACTION = 0.5;
const EXCLUDE = new Set([
  "debtToGdp",
  "budgetBalance",
  "schuldenbremseHeadroom", // mirror-controlled (fiscalMirror)
  "independenceDesire", // drift-owned (devolution)
]);

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

const client = new MongoClient(uri, { directConnection: true });
try {
  await client.connect();
  const db = client.db("a-house-divided");

  const states = await db
    .collection("states")
    .find({}, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const countryOf = new Map(states.map((s) => [String(s._id), s.countryId]));

  const baselines = new Map(
    (await db.collection("stateBaselines").find({}).toArray()).map((b) => [String(b._id), b])
  );
  const metricsDocs = await db.collection("stateMetrics").find({}).toArray();

  const val = (obj, cat, mid) => {
    const m = obj?.[cat]?.[mid];
    return typeof m === "object" && m !== null && "value" in m ? m.value : undefined;
  };

  // Pass 0: a metric is UNIVERSAL if it is present (nonzero) in stateMetrics for >=3 countries.
  // Country-specific metrics (present in only one country) are excluded so baseline pollution
  // can't leak e.g. Irish irishLanguageStrength into US regions.
  const MIN_UNIVERSAL_COUNTRIES = 3;
  const metricCountries = {}; // metricKey -> Set(countryId) where present nonzero
  for (const doc of metricsDocs) {
    const cc = countryOf.get(String(doc._id));
    if (!cc) continue;
    for (const [cat, metrics] of Object.entries(doc)) {
      if (
        cat.startsWith("_") ||
        cat === "lastUpdated" ||
        typeof metrics !== "object" ||
        metrics === null
      )
        continue;
      for (const [mid, mv] of Object.entries(metrics)) {
        if (
          typeof mv === "object" &&
          mv !== null &&
          typeof mv.value === "number" &&
          mv.value !== 0
        ) {
          (metricCountries[`${cat}.${mid}`] ??= new Set()).add(cc);
        }
      }
    }
  }
  const isUniversal = (key) => (metricCountries[key]?.size ?? 0) >= MIN_UNIVERSAL_COUNTRIES;

  // Pass 1: per (country, metricKey), tally zero-vs-present among regions with a nonzero baseline.
  const tally = {}; // country -> metricKey -> { zero, present, cat, mid }
  for (const doc of metricsDocs) {
    const cc = countryOf.get(String(doc._id));
    const base = baselines.get(String(doc._id));
    if (!cc || !base?.baselines) continue;
    for (const [cat, metrics] of Object.entries(base.baselines)) {
      if (typeof metrics !== "object" || metrics === null) continue;
      for (const [mid, bv] of Object.entries(metrics)) {
        if (typeof bv !== "number" || bv <= 0 || EXCLUDE.has(mid)) continue;
        const key = `${cat}.${mid}`;
        if (!isUniversal(key)) continue; // skip country-specific / baseline-polluted metrics
        const t = ((tally[cc] ??= {})[key] ??= { zero: 0, present: 0, cat, mid });
        const cur = val(doc, cat, mid);
        if (cur === undefined || cur === 0) t.zero++;
        else t.present++;
      }
    }
  }

  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  // Which (country, metricKey) are systematically zero → eligible. For each, resolve the
  // backfill SOURCE: per-region baseline, UNLESS the baseline is a PLACEHOLDER (US large
  // metrics seed 0-100 stubs — e.g. crimeRate baseline 63 vs real ~900). Detect a
  // placeholder by comparing the country's median present value to its median baseline;
  // if present values are >2× the baseline, the baseline is a stub → use the median of
  // the country's present real values instead.
  const eligible = new Map(); // "cc|key" -> { source: "baseline" | number }
  const report = [];
  for (const [cc, keys] of Object.entries(tally)) {
    for (const [key, t] of Object.entries(keys)) {
      const total = t.zero + t.present;
      const frac = total ? t.zero / total : 0;
      if (!(t.zero > 0 && frac >= SYSTEMATIC_FRACTION)) continue;
      const [cat, mid] = key.split(".");
      const presentVals = [];
      const baseVals = [];
      for (const doc of metricsDocs) {
        if (countryOf.get(String(doc._id)) !== cc) continue;
        const cur = val(doc, cat, mid);
        if (typeof cur === "number" && cur > 0) presentVals.push(cur);
        const bv = baselines.get(String(doc._id))?.baselines?.[cat]?.[mid];
        if (typeof bv === "number" && bv > 0) baseVals.push(bv);
      }
      const medPresent = median(presentVals);
      const medBase = median(baseVals);
      const placeholder = medPresent != null && medBase != null && medPresent > 2 * medBase;
      const source = placeholder ? medPresent : "baseline";
      eligible.set(`${cc}|${key}`, { source });
      report.push({
        cc,
        key,
        zero: t.zero,
        total,
        frac: +(frac * 100).toFixed(0),
        src: placeholder ? `median≈${medPresent}` : "baseline",
      });
    }
  }
  report.sort((a, b) => a.key.localeCompare(b.key) || a.cc.localeCompare(b.cc));

  // Pass 2: build $set ops for each region's zeroed eligible metric from its resolved source.
  const ops = [];
  let cells = 0;
  for (const doc of metricsDocs) {
    const cc = countryOf.get(String(doc._id));
    const base = baselines.get(String(doc._id));
    if (!cc || !base?.baselines) continue;
    const set = {};
    for (const [cat, metrics] of Object.entries(base.baselines)) {
      if (typeof metrics !== "object" || metrics === null) continue;
      for (const [mid, bv] of Object.entries(metrics)) {
        if (typeof bv !== "number" || bv <= 0 || EXCLUDE.has(mid)) continue;
        if (!isUniversal(`${cat}.${mid}`)) continue;
        const e = eligible.get(`${cc}|${cat}.${mid}`);
        if (!e) continue;
        const cur = val(doc, cat, mid);
        if (cur === undefined || cur === 0) {
          set[`${cat}.${mid}.value`] = e.source === "baseline" ? bv : e.source;
          cells++;
        }
      }
    }
    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
    }
  }

  console.log(
    `=== Backfill plan (${useLive ? "LIVE" : "local"}) — systematic zero universal metrics ===`
  );
  for (const r of report)
    console.log(`  ${r.key.padEnd(36)} ${r.cc}: ${r.zero}/${r.total} (${r.frac}%) ← ${r.src}`);
  console.log(
    `\nWould update ${ops.length} region docs, ${cells} metric cells across ${new Set(report.map((r) => r.key)).size} distinct metrics.`
  );

  if (!apply) {
    console.log("\nDRY RUN — no writes. Re-run with --apply --live to mutate.");
  } else if (ops.length) {
    const res = await db.collection("stateMetrics").bulkWrite(ops);
    console.log(`\nAPPLIED: modified ${res.modifiedCount} region docs.`);
  } else {
    console.log("\nNothing to backfill.");
  }
} finally {
  await client.close();
}
