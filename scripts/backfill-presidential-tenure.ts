/**
 * One-off seed for `gameState.presidentialTenureByCountry`.
 *
 * The party-tenure voter-fatigue penalty reads a consecutive-terms counter that
 * is maintained going forward at each presidential resolution. Existing games
 * have no such counter, so this derives the current streak from the career-
 * history ledger (the only place past presidential wins survive) and seeds it.
 *
 * Derivation: collect every "elected" career event for the head-of-government
 * office across characters + retiredCharacters + npps, order by date descending,
 * then count how many consecutive most-recent terms share the current holder's
 * party. NPP-held terms are included when the npp doc carries careerHistory.
 *
 * It PRINTS the ordered party sequence so the result can be sanity-checked
 * against known reality before writing.
 *
 * Usage:
 *   npx tsx scripts/backfill-presidential-tenure.ts            # dry-run (default), US
 *   npx tsx scripts/backfill-presidential-tenure.ts --apply    # write
 *   npx tsx scripts/backfill-presidential-tenure.ts --country US
 *
 * Connects to MONGODB_URI_LIVE (directConnection) per project convention.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { getCountryConfig, type CountryId } from "../src/lib/constants/countries";
import { nextPresidentialTenure } from "../src/lib/turn/election/presidentialTenureLedger";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const APPLY = process.argv.includes("--apply");
const countryArgIdx = process.argv.indexOf("--country");
const COUNTRY = (countryArgIdx >= 0 ? process.argv[countryArgIdx + 1] : "US") as CountryId;

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE not set in .env.local");

type EventRow = { party?: string; date?: Date; who: string };

async function main() {
  const officeKey =
    getCountryConfig(COUNTRY).executiveTermLimit?.officeKey ??
    (COUNTRY === "US" ? "president" : undefined);
  if (!officeKey) throw new Error(`No head-of-government office key for ${COUNTRY}`);

  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();

  const rows: EventRow[] = [];
  for (const coll of ["characters", "retiredCharacters", "npps"]) {
    const docs = await db
      .collection(coll)
      .find(
        { "careerHistory.office.type": officeKey },
        { projection: { careerHistory: 1, name: 1 } }
      )
      .toArray();
    for (const d of docs) {
      for (const ev of (d.careerHistory ?? []) as Array<Record<string, unknown>>) {
        const office = ev.office as { type?: string } | undefined;
        if (office?.type !== officeKey) continue;
        if (ev.type !== "elected" && ev.type !== "appointed") continue;
        const pcid = ev.partyCountryId as string | undefined;
        if (pcid != null && pcid !== COUNTRY) continue;
        rows.push({ party: ev.party as string, date: ev.date as Date, who: d.name ?? coll });
      }
    }
  }

  rows.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  console.log(`\nHead-of-government (${officeKey}) wins for ${COUNTRY}, most recent first:`);
  for (const r of rows.slice(0, 12)) {
    console.log(`  ${r.date?.toISOString().slice(0, 10) ?? "????"}  ${r.party ?? "?"}  (${r.who})`);
  }

  if (rows.length === 0) {
    console.log("No presidential career-history events found — nothing to seed.");
    await client.close();
    return;
  }

  const currentParty = rows[0].party;
  let streak = 0;
  for (const r of rows) {
    if (r.party === currentParty) streak++;
    else break;
  }

  // Cross-check against the seated president.
  const seated = await db
    .collection("electedOfficials")
    .findOne({ countryId: COUNTRY, officeType: officeKey }, { sort: { electedAt: -1 } });
  console.log(`\nSeated ${officeKey} party (electedOfficials): ${seated?.party ?? "none"}`);
  console.log(`Derived current party: ${currentParty}`);
  console.log(`Derived consecutive terms held: ${streak}  (party is seeking term ${streak + 1})`);
  if (seated?.party && seated.party !== currentParty) {
    console.warn("WARNING: seated party != derived party — review before applying.");
  }

  const entry = nextPresidentialTenure(undefined, currentParty);
  entry.consecutiveTerms = streak; // terms already held (do not +1)
  console.log(`\nProposed gameState.presidentialTenureByCountry.${COUNTRY} =`, entry);

  if (!APPLY) {
    console.log("\nDry-run. Re-run with --apply to write.");
    await client.close();
    return;
  }

  await db
    .collection("gameState")
    .updateOne(
      { _id: "current" as unknown as never },
      { $set: { [`presidentialTenureByCountry.${COUNTRY}`]: entry } }
    );
  console.log("\nWritten.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
