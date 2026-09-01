/**
 * Hand Germany's newly-unowned western sectors to the state — Germany only.
 *
 * Destroying the foreign operations returned their capacity to `unownedSectors`,
 * which is right for a market economy and wrong for this one: private founding is
 * banned in a command country, so that headroom is unreachable — capacity nobody
 * can ever use, diluting the state's share of its own economy.
 *
 * `reconcileCommandEconomyUnowned` is the shipped answer (ticket #1014): it
 * upserts an SOE plus per-state plants for every sector a command economy should
 * cover, then drains the unowned docs for those sectors. Idempotent, and already
 * the path the deploy migration uses on live worlds.
 *
 * SCOPED BY NARROWING ITS INPUT, NOT BY COPYING IT. The pass derives its country
 * list from the `states` it reads, and everything downstream — the seed entries
 * and the unowned delete filter — is built from that list. So it is given a `db`
 * whose `states` query is confined to DD and left otherwise untouched; it then
 * scopes itself. Re-implementing the pass with a country filter would have meant
 * maintaining a second copy of logic that upserts 1,424 rows, which is exactly
 * the kind of divergence that has caused trouble already.
 *
 * Run unscoped it would touch twelve command countries. That is a real pending
 * question for the Eastern bloc, but it is not this one.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "dotenv";
import { reconcileCommandEconomyUnowned } from "@/lib/admin/seed/reconcileCommandEconomyUnowned";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ONLY = "DD";

/**
 * The same Db, except that a `states` read only ever sees one country.
 *
 * Every other collection passes straight through: the corporation and sector
 * upserts and the unowned delete must see the real world, or the pass would
 * mis-detect what already exists.
 */
function scopedToCountry(db: Db, countryId: string): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "collection") return Reflect.get(target, prop, receiver);
      return (name: string, ...rest: unknown[]) => {
        const coll = (target.collection as (n: string, ...a: unknown[]) => Collection)(
          name,
          ...rest
        );
        if (name !== "states") return coll;
        return new Proxy(coll, {
          get(c, p, r) {
            if (p !== "find") return Reflect.get(c, p, r);
            return (filter: Record<string, unknown> = {}, ...args: unknown[]) =>
              (c.find as (f: unknown, ...a: unknown[]) => unknown)(
                { ...filter, countryId },
                ...args
              );
          },
        });
      };
    },
  }) as Db;
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const cfg = await db
    .collection("gameConfig")
    .findOne({ _id: "default" as never }, { projection: { commandEconomyEnabled: 1 } });
  if (cfg?.commandEconomyEnabled !== true) {
    console.log("commandEconomyEnabled is off — the reconcile is a no-op. Stopping.");
    await client.close();
    return;
  }

  const before = await db.collection("unownedSectors").countDocuments({ countryId: ONLY } as never);
  const beforeWorld = await db.collection("unownedSectors").countDocuments({});
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — scoped to ${ONLY}`);
  console.log(`unowned pools before: ${ONLY}=${before}, world=${beforeWorld}\n`);

  const result = await reconcileCommandEconomyUnowned(scopedToCountry(db, ONLY), {
    dryRun: !APPLY,
    log: (m) => console.log(`  ${m}`),
  });

  if (result.commandCountries.some((c) => c !== ONLY)) {
    throw new Error(`scoping failed — pass would touch ${result.commandCountries.join(",")}`);
  }

  console.log(`\ncountries touched: ${result.commandCountries.join(", ") || "(none)"}`);
  console.log(`  SOEs created:     ${result.soesCreated}`);
  console.log(`  SOEs reused:      ${result.soesReused}`);
  console.log(`  sectors upserted: ${result.sectorsUpserted}`);
  console.log(`  unowned deleted:  ${result.unownedDeleted}`);

  if (APPLY) {
    const after = await db
      .collection("unownedSectors")
      .countDocuments({ countryId: ONLY } as never);
    const afterWorld = await db.collection("unownedSectors").countDocuments({});
    console.log(`\nunowned pools after: ${ONLY}=${after}, world=${afterWorld}`);
    console.log(
      `world total changed by ${afterWorld - beforeWorld} (should equal ${ONLY}'s change)`
    );
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
