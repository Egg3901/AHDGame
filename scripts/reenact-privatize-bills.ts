/**
 * One-off: re-enact the privatize provisions of signed bills that silently
 * no-oped before the anti-monopoly carve clamp (issue #2864 / PR #2873).
 *
 *   npx tsx scripts/reenact-privatize-bills.ts            # dry-run (diagnose only)
 *   npx tsx scripts/reenact-privatize-bills.ts --apply    # re-enact against prod
 *
 * Idempotent: a provision is skipped when a corporation with its newCorpName
 * already exists, so partially applied runs are safe to repeat.
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
// The Railway proxy fronts a single-node rs0 whose advertised member address is
// unreachable from outside — force direct connection for this client AND for
// the app's own getDb() (wire-event logging inside privatizeAsset).
if (process.env.MONGODB_URI && !/directConnection/.test(process.env.MONGODB_URI)) {
  process.env.MONGODB_URI += "&directConnection=true";
}

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

const APPLY = process.argv.includes("--apply");

// Signed bills whose privatize provisions produced no corporation.
const TARGET_BILL_IDS = [
  "6a458880bd7c4be5a0ae1e37", // Public Assets Act (DE) — Berlin Development Group
  "6a4acce302a448ede6b0d749", // Privatize Key Sectors (CN) — Energy/Manufacturing/Agriculture corp
  "6a4c053b02e69a3692c97eb6", // China Extraction Privatization (CN) — China Mining
];

async function main() {
  const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
  const { fetchSectorMarketSharePercent } = await import("@/lib/corporations/marketShare");
  const { isStateOwned } = await import("@/lib/nationalization/nationalCorporation");
  const { maxCarveFractionForMarketShare, REPRIVATIZE_COOLDOWN_TURNS, CARVE_FRACTION_MIN } =
    await import("@/lib/nationalization/constants");
  const { applyPrivatizeProvision } = await import("@/lib/nationalization/legislativePrivatize");

  const client = new MongoClient(process.env.MONGODB_URI!, { directConnection: true });
  await client.connect();
  const db = client.db();
  const turn = await getCurrentTurn(db);
  console.log(`mode=${APPLY ? "APPLY" : "dry-run"} currentTurn=${turn}\n`);

  const bills = await db
    .collection("bills")
    .find({ _id: { $in: TARGET_BILL_IDS.map((id) => new ObjectId(id)) } })
    .toArray();

  for (const bill of bills) {
    console.log(`== ${bill.title} [${bill.status}] ${bill._id}`);
    if (bill.status !== "signed") {
      console.log("  SKIP: bill is not signed");
      continue;
    }
    for (const p of bill.provisions ?? []) {
      if (p.type !== "privatize") continue;
      const name = String(p.newCorpName).trim();
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const existing = await db
        .collection("corporations")
        .findOne({ name: { $regex: new RegExp(`^${escaped}$`, "i") } });
      if (existing) {
        console.log(`  SKIP "${name}": corporation already exists (${existing._id})`);
        continue;
      }

      const source = await db
        .collection("corporations")
        .findOne({ _id: p.sourceNationalCorporationId });
      if (!source || !isStateOwned(source as never)) {
        console.log(`  FAIL "${name}": source NatCorp missing or not state-owned`);
        continue;
      }
      const countryId = source.countryOwnerId;
      console.log(`  "${name}" method=${p.method ?? "ipo"} country=${countryId}`);

      // Per-selection diagnostics: what the clamp will do, and any hard blocker.
      let blocked = false;
      for (const sel of p.selections ?? []) {
        const sector = await db.collection("corporateSectors").findOne({ _id: sel.sectorId });
        if (!sector) {
          console.log(`    sector ${sel.sectorId}: MISSING — provision will fail`);
          blocked = true;
          continue;
        }
        if (String(sector.corporationId) !== String(source._id)) {
          console.log(
            `    sector ${sel.sectorId} (${sector.sectorType}/${sector.stateId}): ` +
              `NOT OWNED by source (owner ${sector.corporationId}) — provision will fail`
          );
          blocked = true;
          continue;
        }
        const cooldownLeft =
          sector.absorbedAtTurn != null
            ? REPRIVATIZE_COOLDOWN_TURNS - (turn - sector.absorbedAtTurn)
            : 0;
        if (cooldownLeft > 0) {
          console.log(
            `    sector ${sector.sectorType}/${sector.stateId}: COOLDOWN (${cooldownLeft} turns left) — provision will fail`
          );
          blocked = true;
          continue;
        }
        const share = await fetchSectorMarketSharePercent(db, sector as never, source as never);
        const maxF = maxCarveFractionForMarketShare(share);
        const clamped = Math.min(sel.carveFraction, maxF);
        const minOk = clamped >= CARVE_FRACTION_MIN;
        console.log(
          `    sector ${sector.sectorType}/${sector.stateId}: share=${share.toFixed(1)}% ` +
            `carve ${sel.carveFraction} -> ${clamped.toFixed(3)}${minOk ? "" : " (BELOW MIN — will fail)"}`
        );
        if (!minOk) blocked = true;
      }

      if (!APPLY) continue;
      if (blocked) {
        console.log(`  NOT APPLYING "${name}": hard blocker above`);
        continue;
      }
      await applyPrivatizeProvision(db, countryId, {
        type: "privatize",
        sourceNationalCorporationId: p.sourceNationalCorporationId,
        selections: p.selections,
        newCorpName: p.newCorpName,
        goldenSharePercent: p.goldenSharePercent ?? 0,
        method: p.method ?? "ipo",
        ...(p.reservePrice != null ? { reservePrice: p.reservePrice } : {}),
      } as never);
      const created = await db
        .collection("corporations")
        .findOne({ name: { $regex: new RegExp(`^${escaped}$`, "i") } });
      console.log(
        created
          ? `  APPLIED "${name}" -> corp ${created._id} (foundedAtTurn=${created.foundedAtTurn})`
          : `  APPLY FAILED "${name}" — see [legislativePrivatize] error above`
      );
    }
    console.log("");
  }

  await client.close();
  // getDb()'s cached client (wire events) keeps the loop alive; we're done.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
