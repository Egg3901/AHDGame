/**
 * Renumber the party DOCUMENTS to match references that were already remapped.
 *
 * The reversal's party step swept all 28 reference collections through a
 * temporary band and back down — that part completed — and then tried to write
 * the party documents themselves in ONE pass. It died on E11000: the SED's move
 * to #1 collided with the SPD, which still held #1. The same permutation hazard
 * the reference sweep was built to avoid, left out of the write that follows it.
 *
 * So references now say what the numbers SHOULD mean and the documents still say
 * what they used to. This closes that gap, and nothing else: the references are
 * already correct and must not be touched again, or the remap applies twice.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";
const FROM = "DE";
const TEMP = 1000;

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const currentTurn = Number(gs?.currentTurn ?? 0);

  const parties = await db
    .collection("politicalParties")
    .find({ countryId: TO })
    .project({ sequentialId: 1, name: 1, mergedFrom: 1 })
    .sort({ sequentialId: 1 })
    .toArray();

  const home = parties
    .filter((p) => (p.mergedFrom as { countryId?: string } | undefined)?.countryId === TO)
    .map((p) => ({
      _id: p._id,
      name: String(p.name),
      from: Number(p.sequentialId),
      to: Number((p.mergedFrom as { sequentialId?: number }).sequentialId),
      native: true,
    }));
  let next = home.length === 0 ? 1 : Math.max(...home.map((h) => h.to)) + 1;
  const absorbed = parties
    .filter((p) => (p.mergedFrom as { countryId?: string } | undefined)?.countryId !== TO)
    .map((p) => ({
      _id: p._id,
      name: String(p.name),
      from: Number(p.sequentialId),
      to: next++,
      native: false,
    }));
  const all = [...home, ...absorbed];

  if (new Set(all.map((r) => r.to)).size !== parties.length) {
    throw new Error("not a bijection — refusing to write");
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — party documents only, turn ${currentTurn}\n`);
  for (const r of all)
    console.log(`  #${String(r.from).padEnd(3)} -> #${String(r.to).padEnd(3)} ${r.name}`);

  if (APPLY) {
    // TWO PHASES, for the reason the single pass failed: 7 -> 1 while 1 -> 6, so
    // any direct assignment order collides with a number still occupied.
    for (const r of all) {
      await db
        .collection("politicalParties")
        .updateOne({ _id: r._id }, { $set: { sequentialId: r.from + TEMP } });
    }
    for (const r of all) {
      await db.collection("politicalParties").updateOne({ _id: r._id }, {
        $set: {
          sequentialId: r.to,
          updatedAt: new Date(),
          ...(r.native
            ? {}
            : { mergedFrom: { countryId: FROM, sequentialId: r.from, turn: currentTurn } }),
        },
        ...(r.native ? { $unset: { mergedFrom: "" } } : {}),
      } as never);
    }
    const sed = all.find((r) => r.name.startsWith("Sozialistische Einheitspartei"));
    if (sed) {
      await db
        .collection("countryState")
        .updateOne({ _id: TO as never }, { $set: { rulingPartyId: sed.to } } as never);
      console.log(`\ncountryState.rulingPartyId = ${sed.to} (${sed.name})`);
    }
    console.log("APPLIED");
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
