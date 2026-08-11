/**
 * READ-ONLY dry-run for bug #0540 (corp dissolution payout).
 *
 * Elevance Health was force-liquidated on 2026-05-17. The pre-fix
 * `allocateShareholderPool` divided by `corp.totalShares` but only emitted rows
 * for character/imperial shareholders, silently dropping the slice attributable
 * to corporate equity holders and publicFloat. The drained corp's liquidCapital
 * never lands in any recipient's balance — it is destroyed.
 *
 * This script:
 *   1. Reads the dissolution's `bond_default` financialTxLog row for the
 *      authoritative `shareholderPoolAnchor` and `totalPayoutToPeopleAnchor`.
 *   2. Pulls the last `corporationHistory` snapshot pre-dissolution to recover
 *      the cap table (shareholders + publicFloat).
 *   3. Computes what every corp shareholder + publicFloat row SHOULD have
 *      received under the post-fix `allocateShareholderPool`.
 *   4. Converts each anchor payout to the recipient's local currency at the
 *      current `exchangeRates` rate (mirrors `anchorToCorpCapital`).
 *   5. Prints the proposed compensation. NO WRITES.
 *
 * Apply with a follow-up script after the user has approved the amounts.
 */

import fs from "node:fs";
import path from "node:path";
import { MongoClient, ObjectId } from "mongodb";

// ── Inputs ──────────────────────────────────────────────────────────────────
const CORP_ID = "6a0237c3996f80915281c64d"; // Elevance Health
const ENV_PATH = path.join(process.cwd(), ".env.local");

// ── Connect ─────────────────────────────────────────────────────────────────
const env = fs.readFileSync(ENV_PATH, "utf8");
const uriMatch = env.match(/MONGODB_URI=(.+)/);
if (!uriMatch) {
  console.error("MONGODB_URI not found in .env.local");
  process.exit(1);
}
const uri = uriMatch[1].trim().replace(/^["']|["']$/g, "");
const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db("a-house-divided");
  const corpId = new ObjectId(CORP_ID);

  // 1. bond_default tx for the corp.
  const bondDefaultTx = await db.collection("financialTxLog").findOne({
    type: "bond_default",
    subjectId: corpId,
  });
  if (!bondDefaultTx) {
    console.error("No bond_default tx found for corp", CORP_ID);
    process.exit(1);
  }
  const shareholderPoolAnchor = bondDefaultTx.meta?.shareholderPoolAnchor;
  const totalPayoutToPeopleAnchor = bondDefaultTx.meta?.totalPayoutToPeopleAnchor;
  console.log("──────────── DISSOLUTION TX ────────────");
  console.log("  txId:", bondDefaultTx._id.toString());
  console.log("  date:", bondDefaultTx.createdAt.toISOString());
  console.log("  shareholderPoolAnchor:", shareholderPoolAnchor.toLocaleString());
  console.log("  totalPayoutToPeopleAnchor:", totalPayoutToPeopleAnchor.toLocaleString());
  console.log(
    "  dropped slice (anchor):",
    (shareholderPoolAnchor - totalPayoutToPeopleAnchor).toLocaleString()
  );

  // 2. Pre-dissolution corporationHistory snapshot (latest by turn).
  const [snap] = await db
    .collection("corporationHistory")
    .find({ corporationId: corpId })
    .sort({ turn: -1 })
    .limit(1)
    .toArray();
  if (!snap) {
    console.error("No corporationHistory snapshot for", CORP_ID);
    process.exit(1);
  }
  console.log("\n──────────── PRE-DISSOLUTION CAP TABLE ────────────");
  console.log("  snapshot turn:", snap.turn);
  console.log("  totalShares:", snap.totalShares.toLocaleString());
  console.log("  publicFloat:", (snap.publicFloat ?? 0).toLocaleString());
  console.log("  currencyCode:", snap.currencyCode);

  // 3. Exchange rates AT DISSOLUTION TIME — use the snapshot turn's rate from
  //    rateHistory so the compensation reflects what was owed when the bug
  //    fired, not what today's rate would imply.
  const fxDocs = await db.collection("exchangeRates").find({}).toArray();
  const fxByCurrency = new Map();
  const fxRateSource = new Map();
  for (const f of fxDocs) {
    if (!f.currencyCode) continue;
    const hist = Array.isArray(f.rateHistory) ? f.rateHistory : [];
    // Find rate at or just before snapshot turn. Fall back to oldest then current.
    const candidatesAtOrBefore = hist.filter((h) => h.turn <= snap.turn);
    const chosen =
      candidatesAtOrBefore.length > 0
        ? candidatesAtOrBefore[candidatesAtOrBefore.length - 1]
        : hist.length > 0
          ? hist[0]
          : null;
    const rate = chosen?.rate ?? f.rate ?? 1;
    fxByCurrency.set(f.currencyCode, rate);
    fxRateSource.set(
      f.currencyCode,
      chosen ? `rateHistory@turn=${chosen.turn}` : `live rate (no history available)`
    );
  }

  // 4. Reproduce allocateShareholderPool's math (post-fix).
  const totalShares = snap.totalShares;
  const characterRows = [];
  const corporationRows = [];
  for (const sh of snap.shareholders ?? []) {
    const payout = Math.floor((shareholderPoolAnchor * sh.shares) / totalShares);
    if (sh.characterId) {
      characterRows.push({
        kind: "character",
        id: sh.characterId.toString(),
        shares: sh.shares,
        payoutAnchor: payout,
      });
    } else if (sh.imperialCharacterId) {
      characterRows.push({
        kind: "imperial",
        id: sh.imperialCharacterId.toString(),
        shares: sh.shares,
        payoutAnchor: payout,
      });
    } else if (sh.corporationId) {
      corporationRows.push({
        id: sh.corporationId.toString(),
        shares: sh.shares,
        payoutAnchor: payout,
      });
    }
  }
  const floatShares = snap.publicFloat ?? 0;
  const publicFloatPayoutAnchor =
    floatShares > 0 ? Math.floor((shareholderPoolAnchor * floatShares) / totalShares) : 0;

  console.log("\n──────────── ALREADY PAID (chars + imperials) ────────────");
  const totalAlreadyPaid = characterRows.reduce((s, r) => s + r.payoutAnchor, 0);
  for (const r of characterRows) {
    console.log(
      `  ${r.kind === "imperial" ? "[imp]" : "[chr]"} ${r.id}  shares=${r.shares.toLocaleString().padStart(13)}  anchor=${r.payoutAnchor.toLocaleString().padStart(15)}`
    );
  }
  console.log("  ─ total already paid (anchor):", totalAlreadyPaid.toLocaleString());

  // 5. Look up beneficiary corp docs for currency + name + status.
  const corpIds = corporationRows.map((r) => new ObjectId(r.id));
  const beneficiaryCorps =
    corpIds.length > 0
      ? await db
          .collection("corporations")
          .find({ _id: { $in: corpIds } })
          .project({
            _id: 1,
            name: 1,
            sequentialId: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
            liquidCapital: 1,
            ceoId: 1,
          })
          .toArray()
      : [];
  const corpById = new Map(beneficiaryCorps.map((c) => [c._id.toString(), c]));

  console.log("\n──────────── PROPOSED COMPENSATION ────────────");
  let totalCompAnchor = 0;
  for (const row of corporationRows) {
    const corp = corpById.get(row.id);
    if (!corp) {
      console.log(
        `  [MISSING] corp ${row.id}  shares=${row.shares.toLocaleString()}  anchor=${row.payoutAnchor.toLocaleString()}  — corp doc not found, SKIP`
      );
      continue;
    }
    const currency = corp.liquidCurrencyCode ?? "USD";
    const rate = fxByCurrency.get(currency) ?? 1;
    const payoutLocal = row.payoutAnchor * rate;
    totalCompAnchor += row.payoutAnchor;
    console.log(`  → ${corp.name} (seq ${corp.sequentialId}, ${corp.countryId} / ${currency})`);
    console.log(`      shares:        ${row.shares.toLocaleString()}`);
    console.log(`      anchor payout: ${row.payoutAnchor.toLocaleString()}`);
    console.log(
      `      local payout:  ${payoutLocal.toLocaleString()} ${currency}  (rate ${rate.toFixed(4)} from ${fxRateSource.get(currency)})`
    );
    console.log(`      current LC:    ${corp.liquidCapital.toLocaleString()} ${currency}`);
    console.log(
      `      post-comp LC:  ${(corp.liquidCapital + payoutLocal).toLocaleString()} ${currency}`
    );
  }

  if (publicFloatPayoutAnchor > 0) {
    // CB reserve in country currency (anchor * rate).
    const corpDoc = await db
      .collection("corporations")
      .findOne({ _id: corpId }, { projection: { liquidCurrencyCode: 1, countryId: 1 } });
    // Corp doc deleted post-dissolution; fall back to snapshot currency.
    const countryCurrency = corpDoc?.liquidCurrencyCode ?? snap.currencyCode ?? "USD";
    const rate = fxByCurrency.get(countryCurrency) ?? 1;
    const floatLocal = publicFloatPayoutAnchor * rate;
    totalCompAnchor += publicFloatPayoutAnchor;
    console.log(`  → ${countryCurrency} central bank reserveBalance`);
    console.log(`      float shares:  ${floatShares.toLocaleString()}`);
    console.log(`      anchor payout: ${publicFloatPayoutAnchor.toLocaleString()}`);
    console.log(`      local payout:  ${floatLocal.toLocaleString()} ${countryCurrency}`);
  }

  console.log("\n──────────── RECONCILIATION ────────────");
  console.log("  shareholderPool (anchor):       ", shareholderPoolAnchor.toLocaleString());
  console.log("  already paid to chars (anchor): ", totalAlreadyPaid.toLocaleString());
  console.log("  proposed compensation (anchor): ", totalCompAnchor.toLocaleString());
  console.log(
    "  sum (anchor):                   ",
    (totalAlreadyPaid + totalCompAnchor).toLocaleString()
  );
  const residual = shareholderPoolAnchor - (totalAlreadyPaid + totalCompAnchor);
  console.log(
    "  residual (Math.floor dust):     ",
    residual.toLocaleString(),
    residual >= 0 && residual < corporationRows.length + 1 ? "(OK — floor dust)" : "(⚠ INVESTIGATE)"
  );

  console.log("\n──────────── NEXT STEP ────────────");
  console.log("  Review the per-recipient amounts above. To apply, write a sibling");
  console.log("  script that performs the corp $inc liquidCapital + CB $inc reserveBalance");
  console.log("  and emits matching corp_dissolution_distribution ledger rows tagged");
  console.log("  with meta.bugFixCompensation = '0540'. This script does NOT mutate.");

  await client.close();
}

main().catch(async (e) => {
  console.error(e);
  await client.close();
  process.exit(1);
});
