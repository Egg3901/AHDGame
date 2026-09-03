/**
 * Two stale fields on the unified state's government formation.
 *
 * `seatsByParty` IS A PARTY REFERENCE the renumber did not know about. Like
 * `governingPartyId` before it, this field is not in `PARTY_REF_COLLECTIONS` —
 * the table that documents itself as the one place a party-referencing collection
 * has to be registered — so the reversal's two-phase sweep never touched it. Its
 * keys are still the pre-renumber ids, which now name BANNED Federal Republic
 * parties, and `updateParliamentaryGovernmentSeats` sizes the government's
 * support off exactly this map.
 *
 * `pmName` is a stored denormalisation of `pmCharacterId` and has drifted from
 * it: the id resolves to the sitting General Secretary, the name is somebody who
 * no longer exists under any character record. The country lander renders the
 * name and links the id, which is why it showed the right person's page under the
 * wrong person's name. This predates the reversal — the formation dates to turn
 * 49 — but it is on the GDR's lander now, so it is corrected here from the id,
 * which is the authoritative half.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient, ObjectId } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gov = await db.collection("governmentFormations").findOne({ _id: TO as never });
  if (!gov) throw new Error("no government formation");

  // ── the head of government's name ────────────────────────────────────────
  const pmId = gov.pmCharacterId;
  let realName: string | null = null;
  if (pmId) {
    const c = await db.collection("characters").findOne({ _id: new ObjectId(String(pmId)) });
    const nm = [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim();
    realName = nm || (c?.name ? String(c.name) : null);
  }
  console.log(`pmName: "${gov.pmName}" -> "${realName ?? "(cannot resolve)"}"`);

  // ── the seat map ─────────────────────────────────────────────────────────
  const parties = await db
    .collection("politicalParties")
    .find({ countryId: TO })
    .project({ sequentialId: 1, name: 1, mergedFrom: 1, regimeStatus: 1 })
    .toArray();
  // The renumber moved the GDR's parties home; `mergedFrom` on the Federal
  // Republic's records what each of THEM used to be, so the inverse of the map
  // that was applied is recoverable from the documents themselves.
  const oldToNew = new Map<string, string>();
  for (const p of parties) {
    const mf = p.mergedFrom as { countryId?: string; sequentialId?: number } | undefined;
    if (mf?.countryId === "DE" && mf.sequentialId != null) {
      oldToNew.set(String(mf.sequentialId), String(p.sequentialId));
    }
  }
  // The GDR's own parties went 7..11 -> 1..5; those are the keys actually present.
  // Recover them by name-stable identity: a party whose current id is 1..5 and
  // which carries no `mergedFrom` came home from `mergedFrom.sequentialId + 6`.
  const seats = (gov.seatsByParty ?? {}) as Record<string, number>;
  const nameById = new Map(parties.map((p) => [String(p.sequentialId), String(p.name)]));

  console.log("\nseatsByParty:");
  const rebuilt: Record<string, number> = {};
  for (const [key, value] of Object.entries(seats)) {
    // Under the old numbering the GDR's parties were 7..11 and are now 1..5.
    const asOld = Number(key);
    const newKey = asOld >= 7 && asOld <= 11 ? String(asOld - 6) : (oldToNew.get(key) ?? key);
    rebuilt[newKey] = (rebuilt[newKey] ?? 0) + value;
    console.log(
      `  ${key} (${nameById.get(key) ?? "?"}) -> ${newKey} (${nameById.get(newKey) ?? "?"})  seats=${value}`
    );
  }

  if (APPLY) {
    const set: Record<string, unknown> = { seatsByParty: rebuilt, updatedAt: new Date() };
    if (realName) set.pmName = realName;
    await db
      .collection("governmentFormations")
      .updateOne({ _id: TO as never }, { $set: set } as never);
    console.log("\nAPPLIED");
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
