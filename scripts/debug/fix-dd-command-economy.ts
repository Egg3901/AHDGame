/**
 * Bring the unified state's ownership back in line with its regime.
 *
 * The GDR sat at `marketizationLevel` 0 — a pure command economy, the same
 * reading as RU and CN — at both fiscal gates before reunification. It then
 * absorbed the Federal Republic's entire private economy and nothing converted
 * ownership: `mergeEconomicRegime` carries the marketization DIAL and there is no
 * code path that nationalises what a command economy takes. Not one of the 182
 * western sector operations was state-owned, state ownership fell to roughly a
 * sixth, and the dial has been drifting up on its own (0 -> 0.42 -> 0.63) because
 * `commandEconomyTurn` reads SOE coverage.
 *
 * SOCI IS DRIVEN BY THE CORPORATION, not the sector row: the index sums
 * `corporateSectors.revenue` whose owning corporation has
 * `countryOwnerId === countryId`. So the lever is corporate ownership, and
 * `soeMandate` on the sector is the operating mandate that follows it.
 *
 * ⚠️ PLAYER-RUN COMPANIES ARE LEFT ALONE. Nationalising every corporation reaches
 * SOCI 100; nationalising only the NPP-run and ownerless ones reaches 97.0, which
 * is already above RU's 99.77 in kind if not to the decimal. The remaining three
 * points would cost seven real players their firms — COSTCO, Love Shack, Advanced
 * Advertising, Streibl Group, Land Rover, Roxxon Energy and Butxot-Freiburg — and
 * expropriating a player is a decision for a human, not a repair script.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient, ObjectId } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
/** Opt in to seizing player-run companies as well. */
const INCLUDE_PLAYERS = process.argv.includes("--include-players");
const TO = "DD";

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — turn ${gs?.currentTurn}${INCLUDE_PLAYERS ? "  (INCLUDING player firms)" : ""}\n`
  );

  const sectors = await db
    .collection("corporateSectors")
    .find({ countryId: TO })
    .project({ corporationId: 1, revenue: 1, sectorType: 1, soeMandate: 1 })
    .toArray();
  const corpIds = [...new Set(sectors.map((s) => String(s.corporationId)))];
  const corps = await db
    .collection("corporations")
    .find({ _id: { $in: corpIds.map((i) => new ObjectId(i)) } } as never)
    .project({ name: 1, ceoType: 1, countryOwnerId: 1, isNationalized: 1 })
    .toArray();

  const alreadyState = corps.filter((c) => c.countryOwnerId === TO);
  const players = corps.filter((c) => c.ceoType === "character" && c.countryOwnerId !== TO);
  const target = corps.filter((c) => {
    if (c.countryOwnerId === TO) return false;
    const isPlayer = c.ceoType === "character";
    return INCLUDE_PLAYERS ? true : !isPlayer;
  });

  console.log(`corporations operating in ${TO}: ${corps.length}`);
  console.log(`  already state-owned: ${alreadyState.length}`);
  console.log(`  to nationalise:      ${target.length}`);
  console.log(`  player-run, left private: ${INCLUDE_PLAYERS ? 0 : players.length}`);

  // The mandate the GDR's own enterprises operate under, mirrored onto the new ones.
  const mandates = new Map<string, number>();
  for (const s of sectors) {
    if (!s.soeMandate) continue;
    const k = JSON.stringify(s.soeMandate);
    mandates.set(k, (mandates.get(k) ?? 0) + 1);
  }
  const [mandateJson] = [...mandates.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["null", 0];
  const mandate = JSON.parse(mandateJson) as Record<string, unknown> | null;
  console.log(`\nGDR operating mandate (most common of ${mandates.size} shape(s)): ${mandateJson}`);
  if (!mandate) throw new Error("no existing soeMandate to mirror — refusing to invent one");

  const targetIds = new Set(target.map((c) => String(c._id)));
  const sectorsToMandate = sectors.filter(
    (s) => targetIds.has(String(s.corporationId)) && !s.soeMandate
  );

  // Projected SOCI, by the same revenue-share the index uses.
  let total = 0;
  let state = 0;
  for (const s of sectors) {
    const rev = Number(s.revenue ?? 0);
    total += rev;
    const owner = corps.find((c) => String(c._id) === String(s.corporationId));
    if (owner && (owner.countryOwnerId === TO || targetIds.has(String(owner._id)))) state += rev;
  }
  console.log(`\nsector operations gaining a mandate: ${sectorsToMandate.length}`);
  console.log(`projected SOCI: ${total > 0 ? ((100 * state) / total).toFixed(1) : "0"}`);

  if (!INCLUDE_PLAYERS && players.length > 0) {
    console.log(`\nleft in private hands (${players.length}):`);
    for (const p of players) console.log(`  ${String(p.name)}`);
  }

  if (APPLY) {
    await db
      .collection("corporations")
      .updateMany(
        { _id: { $in: target.map((c) => c._id) } } as never,
        { $set: { countryOwnerId: TO, isNationalized: true, updatedAt: new Date() } } as never
      );
    await db
      .collection("corporateSectors")
      .updateMany(
        { _id: { $in: sectorsToMandate.map((s) => s._id) } } as never,
        { $set: { soeMandate: mandate, updatedAt: new Date() } } as never
      );
    console.log(
      `\nAPPLIED — ${target.length} corporation(s) nationalised, ${sectorsToMandate.length} operation(s) placed under mandate.`
    );
    console.log("SOCI recomputes on the next turn.");
  } else {
    console.log("\nDRY RUN — nothing written.");
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
