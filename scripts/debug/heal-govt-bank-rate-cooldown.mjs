/**
 * Heal: clear the stranded rate cooldown on government-controlled central banks.
 *
 * Ticket #1250. `processNppChairAutoRate` had no government-control gate, so on
 * a government-controlled bank (the pre-1997 Bank of England) the autonomous
 * technocrat chair kept setting Bank Rate and stamping `lastRateChangeTurn`.
 * The government shares that one cooldown field, so the Treasury's window
 * slammed shut every time it opened and the rate card sat permanently on
 * "on cooldown". The code fix stops the NPP taking the rate; this clears the
 * last stolen move so the government can act now rather than waiting it out.
 *
 * Only banks whose LAST rate change was the NPP chair's are healed: a bank
 * whose cooldown was spent by a human government move is left alone, because
 * that cooldown is legitimate.
 *
 *   node scripts/debug/heal-govt-bank-rate-cooldown.mjs          # dry run
 *   node scripts/debug/heal-govt-bank-rate-cooldown.mjs --apply  # write
 */
import { MongoClient } from "mongodb";
import fs from "fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    })
);

// Mirrors src/lib/centralBank/governance.ts. Kept literal rather than imported
// so this script stays runnable as plain node against a built tree.
const BOE_INDEPENDENCE_YEAR = 1997;
const HISTORICALLY_GOVERNMENT_CONTROLLED = new Set(["UK"]);
const PRESET_START_YEARS = {
  "1953-default": 1953,
  "1979-default": 1979,
  "1991-default": 1991,
  "1999-default": 1999,
  "2007-default": 2007,
  "2023-default": 2023,
};

function isGovernmentControlled(bank, countryId, startingYear) {
  if (typeof bank.governmentControlled === "boolean") return bank.governmentControlled;
  return (
    HISTORICALLY_GOVERNMENT_CONTROLLED.has(countryId) &&
    typeof startingYear === "number" &&
    startingYear < BOE_INDEPENDENCE_YEAR
  );
}

let uri = env.MONGODB_URI_LIVE;
if (!uri.includes("directConnection"))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";
const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const gs = await db.collection("gameState").findOne({ _id: "current" });
const startingYear = gs?.startingYear ?? PRESET_START_YEARS[gs?.preset] ?? 2019;
console.log(
  `World: turn ${gs?.currentTurn}, year ${gs?.currentYear}, preset ${gs?.preset}, startingYear ${startingYear}`
);
console.log(APPLY ? "MODE: APPLY\n" : "MODE: DRY RUN (pass --apply to write)\n");

const banks = await db.collection("centralBanks").find({}).toArray();
let healed = 0;
let skipped = 0;

for (const bank of banks) {
  const countryId = bank.countryId ?? bank._id;
  if (!isGovernmentControlled(bank, countryId, startingYear)) continue;
  if (bank.lastRateChangeTurn == null) {
    console.log(`  ${bank._id} (${countryId}): no cooldown stamped, nothing to clear`);
    continue;
  }

  // Whose move was the last one? rateHistory carries the actor; an NPP chair's
  // entry is the one this heal is for. A missing history is treated as the
  // NPP's, since a government move would have written an entry.
  const last = (bank.rateHistory ?? []).at(-1);
  const lastWasGovernment =
    last != null && last.changedByName != null && !/npp|technocrat/i.test(last.changedByName);

  if (lastWasGovernment) {
    console.log(
      `  ${bank._id} (${countryId}): last change by "${last.changedByName}" at turn ${last.turn ?? "?"} — legitimate cooldown, SKIPPED`
    );
    skipped++;
    continue;
  }

  console.log(
    `  ${bank._id} (${countryId}): lastRateChangeTurn ${bank.lastRateChangeTurn}, primeRate ${bank.primeRate}, chairMode ${bank.chairMode} — CLEARING`
  );
  if (APPLY) {
    await db
      .collection("centralBanks")
      .updateOne(
        { _id: bank._id },
        { $unset: { lastRateChangeTurn: "" }, $set: { updatedAt: new Date() } }
      );
  }
  healed++;
}

console.log(`\n${APPLY ? "Healed" : "Would heal"}: ${healed}; skipped as legitimate: ${skipped}`);
await client.close();
