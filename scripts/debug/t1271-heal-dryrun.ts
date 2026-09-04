/**
 * READ-ONLY dry run of the three #1271 defects against a live world.
 * Runs detect() and plan() only. Never calls apply().
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";
import { defect as mergedStateExtraction } from "@/lib/remediation/defects/AHD-1271-merged-state-extraction";
import { defect as poolCountryAttribution } from "@/lib/remediation/defects/AHD-1271-pool-country-attribution";
import { defect as natCorpSplitSectorType } from "@/lib/remediation/defects/AHD-1271-natcorp-split-sector-type";
import type { HealContext } from "@/lib/remediation/types";

config({ path: ".env.local" });

const raw = process.env.MONGODB_URI_LIVE!;
const uri = raw.includes("directConnection")
  ? raw
  : raw + (raw.includes("?") ? "&" : "?") + "directConnection=true";

const ctx: HealContext = { env: "prod", dryRun: true, now: new Date() };

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  for (const defect of [mergedStateExtraction, poolCountryAttribution, natCorpSplitSectorType]) {
    console.log("\n" + "=".repeat(72));
    console.log(defect.id, "|", defect.title);
    console.log("=".repeat(72));

    const detected = await defect.detect(db, ctx);
    console.log("affected:", detected.affected);
    for (const note of detected.notes ?? []) console.log("  note:", note);
    for (const s of detected.sample) console.log("  sample:", JSON.stringify(s));

    const plan = await defect.plan(db, ctx);
    console.log("plan.summary:", plan.summary);
    console.log("plan.moneyDelta:", plan.moneyDelta);
    console.log(
      "plan.touched:",
      plan.touched.map((t) => `${t.collection}=${t.ids.length}`).join(", ") || "(none, insert-only)"
    );
    for (const note of plan.notes ?? []) console.log("  plan note:", note);

    const payload = plan.payload as { docs?: Record<string, unknown>[] } | undefined;
    if (payload?.docs?.length) {
      console.log(`  would insert ${payload.docs.length} document(s); first:`);
      const d = payload.docs[0];
      console.log(
        "   ",
        JSON.stringify({
          stateId: d.stateId,
          countryId: d.countryId,
          sectorType: d.sectorType,
          corporationId: String(d.corporationId),
          revenue: d.revenue,
          capitalStock: d.capitalStock,
          workers: d.workers,
        })
      );
    }
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
