/**
 * Seed `governorOfficeState` documents for every currently-elected regional
 * executive (Governor / Minister-President / future analogues) AND every
 * national pseudo-state row (federal / uk_national / de_national / jp_national).
 * Without the national rows, the federal Address / Executive Orders /
 * National Address flows silently fail with "Insufficient office action points"
 * because the spend paths require an existing row and never upsert.
 *
 * Idempotent — skips entries that already exist.
 *
 * Run locally: `npx tsx scripts/migrations/createGovernorOffices.ts`
 * Per feedback_migrations_local_only.md, this commit stays local until reviewed.
 */
import { getDb } from "../../src/lib/mongodb";
import { GUBERNATORIAL_ACTION_CAP } from "../../src/lib/constants/governorOffice";
import {
  COUNTRY_CONFIGS,
  getRegionalExecutiveOfficeKey,
  type CountryId,
} from "../../src/lib/constants/countries";
import { NATIONAL_POLICY_STATE_IDS } from "../../src/lib/policy/nationalStateId";

async function main() {
  const db = await getDb();
  const gameState = await db
    .collection("gameState")
    .findOne({ _id: "current" as unknown as never });
  const currentTurn = (gameState as { currentTurn?: number } | null)?.currentTurn ?? 0;
  const now = new Date();
  let inserted = 0;
  let skipped = 0;

  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    // Regional executives — one row per filled seat (player or NPP).
    const officeKey = getRegionalExecutiveOfficeKey(countryId);
    const holders = await db
      .collection("electedOfficials")
      .find({ officeType: officeKey, countryId })
      .toArray();
    for (const h of holders) {
      if (!h.characterId || !h.state) {
        skipped++;
        continue;
      }
      const existing = await db.collection("governorOfficeState").findOne({
        countryId,
        stateId: h.state,
      });
      if (existing) {
        skipped++;
        continue;
      }
      await db.collection("governorOfficeState").insertOne({
        countryId,
        stateId: h.state,
        characterId: h.characterId,
        characterName: h.characterName ?? "Unknown",
        gubernatorialActions: GUBERNATORIAL_ACTION_CAP,
        lastActionGrantedTurn: currentTurn,
        createdAt: now,
        updatedAt: now,
      });
      inserted++;
    }

    // National pseudo-stateId — one row per country regardless of who holds
    // the head-of-government seat. Required for federal Address /
    // Executive Orders / Orders in Council flows.
    const nationalStateId = NATIONAL_POLICY_STATE_IDS[countryId];
    if (nationalStateId) {
      const existing = await db.collection("governorOfficeState").findOne({
        countryId,
        stateId: nationalStateId,
      });
      if (existing) {
        skipped++;
      } else {
        await db.collection("governorOfficeState").insertOne({
          countryId,
          stateId: nationalStateId,
          characterId: null,
          characterName: "National Office",
          gubernatorialActions: GUBERNATORIAL_ACTION_CAP,
          lastActionGrantedTurn: currentTurn,
          createdAt: now,
          updatedAt: now,
        });
        inserted++;
      }
    }
  }
  console.log(`Seeded ${inserted} governorOfficeState docs (skipped ${skipped} existing/invalid).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
