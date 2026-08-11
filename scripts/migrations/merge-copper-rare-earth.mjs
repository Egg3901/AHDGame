/**
 * Migration: merge `copper` INTO `rare_earth` ("Rare Earth Minerals"), base $21,000.
 *
 * CORRECTNESS (verified against the engine, `dollarsToUnits = $/price`):
 *  - Supply/demand/stock/capacity are UNIT quantities whose VALUE = units × basePrice.
 *    To preserve value when re-denominating to the $21,000 base, VALUE-WEIGHT them:
 *      merged_units = (copper_units*9000 + rare_units*50000) / 21000
 *    (A naive unit sum would inflate value ~38%.)
 *  - Recipe/mining RATES live in code and are summed there (value = revenue×rate,
 *    base-independent) — NOT touched here.
 *  - `copper_mining` is DELETED in code (true merge, not repointed), so live sectors
 *    on it are remapped to the unified `rare_earth_mining` strategy here.
 *  - commodityPrices/flows supply/demand re-derive from sectors next turn; we still
 *    value-weight them for a clean one-turn seed. stockUnits + capacity PERSIST, so
 *    their value-weighting is the load-bearing part.
 *
 * SAFETY: --dry (default, no writes) | --backup (dump affected docs) | --run (apply; needs --backup).
 * Idempotent (no-op once no copper docs remain). Reversible from the backup dir.
 */
import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const CP = "copper";
const RE = "rare_earth";
const OLD = { copper: 9000, rare_earth: 50000 };
const NEW_BASE = 21000;
const args = new Set(process.argv.slice(2));
const RUN = args.has("--run");
const BACKUP = args.has("--backup");
const DRY = !RUN;
const STAMP = [...args].find((a) => /^\d{8,}$/.test(a)) ?? "manual";

function loadUri() {
  let uri = process.env.MONGODB_URI;
  if (!uri)
    for (const f of [".env.local", ".env", ".env.production"]) {
      try {
        const m = fs.readFileSync(f, "utf8").match(/^MONGODB_URI\s*=\s*["']?([^"'\n]+)/m);
        if (m) {
          uri = m[1];
          break;
        }
      } catch {}
    }
  if (!uri) throw new Error("no MONGODB_URI");
  if (!/directConnection/.test(uri))
    uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
  return uri;
}

// Value-weight a copper unit-qty + rare unit-qty into the $21,000 denomination.
const vw = (cu, re) => ((cu ?? 0) * OLD.copper + (re ?? 0) * OLD.rare_earth) / NEW_BASE;
// Blend a $/unit price by demand weight (transient seed; re-derived next turn).
function blendPrice(cp, cd, rp, rd) {
  const w = (cd ?? 0) + (rd ?? 0);
  return w <= 0
    ? (rp ?? cp ?? NEW_BASE)
    : ((cp ?? NEW_BASE) * (cd ?? 0) + (rp ?? NEW_BASE) * (rd ?? 0)) / w;
}
// Value-weight two per-key unit maps (supply/demand).
function vwMap(cMap = {}, rMap = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(cMap ?? {}), ...Object.keys(rMap ?? {})]))
    out[k] = vw(cMap?.[k], rMap?.[k]);
  return out;
}
// Demand-weight two per-key price maps.
function priceMap(cP = {}, rP = {}, cD = {}, rD = {}) {
  const out = { ...(rP ?? {}) };
  for (const k of new Set([...Object.keys(cP ?? {}), ...Object.keys(rP ?? {})]))
    out[k] = blendPrice(cP?.[k], cD?.[k], rP?.[k], rD?.[k]);
  return out;
}
function mergedDoc(c, r) {
  const base = r ?? { ...c, commodity: RE };
  return {
    ...base,
    commodity: RE,
    globalSupply: vw(c?.globalSupply, r?.globalSupply),
    globalDemand: vw(c?.globalDemand, r?.globalDemand),
    globalPrice: blendPrice(c?.globalPrice, c?.globalDemand, r?.globalPrice, r?.globalDemand),
    ...(c?.stockUnits != null || r?.stockUnits != null
      ? { stockUnits: vw(c?.stockUnits, r?.stockUnits) }
      : {}),
    stateSupply: vwMap(c?.stateSupply, r?.stateSupply),
    stateDemand: vwMap(c?.stateDemand, r?.stateDemand),
    statePrices: priceMap(c?.statePrices, r?.statePrices, c?.stateDemand, r?.stateDemand),
    nationalSupply: vwMap(c?.nationalSupply, r?.nationalSupply),
    nationalDemand: vwMap(c?.nationalDemand, r?.nationalDemand),
    nationalPrices: priceMap(
      c?.nationalPrices,
      r?.nationalPrices,
      c?.nationalDemand,
      r?.nationalDemand
    ),
  };
}

async function backupDocs(db, name, filter, dir) {
  try {
    const docs = await db.collection(name).find(filter).toArray();
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(docs));
    return docs.length;
  } catch {
    return 0;
  }
}

async function main() {
  const client = new MongoClient(loadUri(), { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db();
  const report = {};

  if (BACKUP) {
    const dir = path.join("scripts/migrations", `backup-${STAMP}`);
    fs.mkdirSync(dir, { recursive: true });
    report.backup = {
      commodityPrices: await backupDocs(
        db,
        "commodityPrices",
        { commodity: { $in: [CP, RE] } },
        dir
      ),
      commodityPriceHistory: await backupDocs(
        db,
        "commodityPriceHistory",
        { commodity: { $in: [CP, RE] } },
        dir
      ),
      commodityFlows: await backupDocs(db, "commodityFlows", { commodity: { $in: [CP, RE] } }, dir),
      stateResourceCapacity: await backupDocs(
        db,
        "stateResourceCapacity",
        {
          $or: [
            { "resources.copper": { $exists: true } },
            { "resources.rare_earth": { $exists: true } },
          ],
        },
        dir
      ),
      extractionContracts: await backupDocs(db, "extractionContracts", { resource: CP }, dir),
    };
    console.log("backup ->", dir, report.backup);
  }

  // 1. commodityPrices + history + flows: value-weight-merge per (commodity,turn)
  for (const coll of ["commodityPrices", "commodityPriceHistory", "commodityFlows"]) {
    let coppers;
    try {
      coppers = await db.collection(coll).find({ commodity: CP }).toArray();
    } catch {
      continue;
    }
    let merged = 0,
      renamed = 0;
    for (const c of coppers) {
      const turnKey = c.turn != null ? { turn: c.turn } : {};
      const r = await db.collection(coll).findOne({ commodity: RE, ...turnKey });
      if (!DRY) {
        if (r) {
          await db.collection(coll).replaceOne({ _id: r._id }, mergedDoc(c, r));
          await db.collection(coll).deleteOne({ _id: c._id });
          merged++;
        } else {
          await db.collection(coll).replaceOne({ _id: c._id }, mergedDoc(c, null));
          renamed++;
        }
      } else if (r) merged++;
      else renamed++;
    }
    report[coll] = { copperDocs: coppers.length, merged, renamed };
  }

  // 2. stateResourceCapacity: VALUE-WEIGHT copper cap into rare_earth cap
  {
    const states = await db
      .collection("stateResourceCapacity")
      .find({ "resources.copper": { $gt: 0 } })
      .toArray();
    for (const s of states) {
      const merged = Math.round(vw(s.resources?.copper, s.resources?.rare_earth) * 100) / 100;
      if (!DRY)
        await db
          .collection("stateResourceCapacity")
          .updateOne(
            { _id: s._id },
            { $set: { "resources.rare_earth": merged }, $unset: { "resources.copper": "" } }
          );
    }
    if (!DRY)
      await db
        .collection("stateResourceCapacity")
        .updateMany(
          { "resources.copper": { $exists: true } },
          { $unset: { "resources.copper": "" } }
        );
    report.stateResourceCapacity = { statesValueWeighted: states.length };
  }

  // 3. corporateSectors: copper_mining is DELETED from code -> remap live sectors to rare_earth_mining.
  {
    const remap = { copper_mining: "rare_earth_mining" };
    for (const field of ["strategyId", "transitionFromStrategyId", "transitionToStrategyId"]) {
      const n = await db
        .collection("corporateSectors")
        .countDocuments({ [field]: "copper_mining" });
      if (!DRY && n)
        await db
          .collection("corporateSectors")
          .updateMany({ [field]: "copper_mining" }, { $set: { [field]: remap.copper_mining } });
      if (n) report.corporateSectors = { ...(report.corporateSectors ?? {}), [field]: n };
    }
  }

  // 4. contracts + prospects: resource copper -> rare_earth
  for (const coll of ["extractionContracts", "prospectingSurveys", "prospects"]) {
    let n;
    try {
      n = await db.collection(coll).countDocuments({ resource: CP });
    } catch {
      continue;
    }
    if (!DRY && n)
      await db.collection(coll).updateMany({ resource: CP }, { $set: { resource: RE } });
    if (n) report[coll] = { resourceRenamed: n };
  }

  console.log(
    JSON.stringify({ mode: DRY ? "DRY-RUN (no writes)" : "APPLIED", ...report }, null, 2)
  );
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
