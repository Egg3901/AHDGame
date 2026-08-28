/**
 * Balance report for the war exhaustion cooldown.
 *
 * Exhaustion used to be a closed-form function of the CURRENT war's clock, so it
 * reset the moment a war ended: a government could sign peace and declare again
 * the same turn with a clean slate. It is now a persisted integrator that moves
 * one point per in-game year in whichever direction the country is going, and
 * the rally on entering a new war is capped at +1 rather than granted outright.
 *
 * This report answers the three questions that decide whether that is balanced:
 *
 *   1. Does a single war from a clean slate behave exactly as it did before?
 *      (It must. Anything else is an unintended regression, not a fix.)
 *   2. How much does the exploit actually cost now?
 *   3. How long does a country carry a war after it ends?
 *
 * Read only. Sections 1 to 3 are pure arithmetic on the shipped functions;
 * section 4 reads the live world to show what the change does to the countries
 * currently fighting.
 *
 *   npx tsx scripts/sim/warExhaustionCooldown2026-08-28.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { stepWarExhaustion, warExhaustion, WAR_EXHAUSTION_FLOOR } from "@/lib/military/warApproval";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const YEAR = TURNS_PER_YEAR;
const f = (value: number) => value.toFixed(2).padStart(7);

/** Run the integrator forward through a scripted sequence of wars and peaces. */
function run(steps: Array<{ conflictId: string | null; turns: number }>): number[] {
  let value: number | undefined = undefined;
  let prevConflictId: string | null = null;
  let sinceEntry = 0;
  const trace: number[] = [];

  for (const step of steps) {
    for (let i = 0; i < step.turns; i += 1) {
      sinceEntry = step.conflictId === prevConflictId ? sinceEntry + 1 : 0;
      value = stepWarExhaustion({
        prev: value,
        conflictId: step.conflictId,
        prevConflictId,
        turnsSinceEntry: sinceEntry,
      });
      prevConflictId = step.conflictId;
      trace.push(value);
    }
  }
  return trace;
}

console.log("War exhaustion cooldown: balance report");
console.log("=".repeat(72));
console.log(`One in-game year = ${YEAR} turns. Floor = ${WAR_EXHAUSTION_FLOOR}.\n`);

// 1. A single war from a clean slate must be unchanged.
console.log("1. Single war from a clean slate (new integrator vs the old curve)");
console.log("   years   new     old     delta");
const single = run([{ conflictId: "war_a", turns: 12 * YEAR }]);
let worst = 0;
for (const year of [0, 1, 2, 4, 8, 12]) {
  const turn = Math.max(0, year * YEAR - 1);
  const now = single[turn]!;
  const before = warExhaustion(turn);
  worst = Math.max(worst, Math.abs(now - before));
  console.log(`   ${String(year).padStart(5)} ${f(now)} ${f(before)} ${f(now - before)}`);
}
console.log(`   worst divergence over twelve years: ${worst.toFixed(3)}`);
console.log(
  worst < 0.05
    ? "   PASS: a first war is unchanged to within display resolution.\n"
    : "   FAIL: the first-war curve has moved. That is a regression, not the fix.\n"
);

// 2. The exploit: peace for one turn, then declare again.
console.log("2. Serial wars. Four years of fighting, one turn of peace, then declare again.");
const serial = run([
  { conflictId: "war_a", turns: 4 * YEAR },
  { conflictId: null, turns: 1 },
  { conflictId: "war_b", turns: 4 * YEAR },
]);
const atPeace = serial[4 * YEAR - 1]!;
const afterRedeclare = serial[4 * YEAR + 1]!;
const endOfSecond = serial[serial.length - 1]!;
console.log(`   end of first war        ${f(atPeace)}`);
console.log(`   old model on redeclare  ${f(warExhaustion(0))}  (a clean +1, every time)`);
console.log(`   new model on redeclare  ${f(afterRedeclare)}`);
console.log(`   end of second war       ${f(endOfSecond)}`);
console.log(
  `   cost of the exploit closed: ${(warExhaustion(0) - afterRedeclare).toFixed(2)} approval\n`
);

// 2b. The rally is only ever paid out of peace.
console.log("2b. Continuous war. Four years, then straight into a second with no peace between.");
const continuous = run([
  { conflictId: "war_a", turns: 4 * YEAR },
  { conflictId: "war_b", turns: 1 },
]);
const beforeSwitch = continuous[4 * YEAR - 1]!;
const afterSwitch = continuous[continuous.length - 1]!;
console.log(`   end of first war        ${f(beforeSwitch)}`);
console.log(`   first turn of second    ${f(afterSwitch)}`);
console.log(
  afterSwitch < beforeSwitch
    ? "   PASS: no rally without a peace, so a war ended while still at war buys nothing.\n"
    : "   FAIL: a rally was paid to a country that never stopped fighting.\n"
);

// 3. Recovery. How long a country carries a war after it ends.
console.log("3. Recovery from peace, by depth of exhaustion carried out of the war.");
console.log("   carried   turns to heal   in-game years   real days (1 turn = 1 hour)");
for (const depth of [-0.5, -1, -3, -6, -12, WAR_EXHAUSTION_FLOOR]) {
  let value = depth;
  let turns = 0;
  while (value !== 0 && turns < 200 * YEAR) {
    value = stepWarExhaustion({
      prev: value,
      conflictId: null,
      prevConflictId: "war_a",
      turnsSinceEntry: 0,
    });
    turns += 1;
  }
  const days = (turns / 24).toFixed(1);
  console.log(
    `   ${f(depth)}   ${String(turns).padStart(13)}   ${(turns / YEAR).toFixed(1).padStart(13)}   ${days.padStart(9)}`
  );
}
console.log();

// 4. What the change does to the countries fighting right now.
async function liveSection(): Promise<void> {
  const configuredUri = process.env.MONGODB_URI_LIVE ?? process.env.MONGODB_URI;
  if (!configuredUri) {
    console.log("4. Live world: skipped, no MONGODB_URI_LIVE or MONGODB_URI configured.");
  } else {
    let uri = configuredUri;
    if (!/directConnection=/.test(uri)) {
      uri += `${uri.includes("?") ? "&" : "?"}directConnection=true`;
    }
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db("a-house-divided");

    const gameState = await db.collection("gameState").findOne({});
    const turn = (gameState?.currentTurn as number) ?? (gameState?.turn as number) ?? 0;
    const conflicts = await listActiveConflicts(db);

    console.log(`4. Live world at turn ${turn}. Seeding, not rallying, is what must happen here.`);
    console.log("   country  war                 entered  turns   seeded exhaustion");
    for (const conflict of conflicts) {
      const roster = [
        ...((conflict.sideA?.countries ?? []) as CountryId[]),
        ...((conflict.sideB?.countries ?? []) as CountryId[]),
      ];
      for (const countryId of roster) {
        if (!(countryId in COUNTRY_CONFIGS)) continue;
        const joined =
          conflict.joinTurns?.find((e) => e.countryId === countryId)?.turn ??
          conflict.treatyEntries?.find((e) => e.countryId === countryId)?.joinedTurn ??
          conflict.startTurn;
        const sinceEntry = Math.max(0, turn - joined);
        // No stored value yet, so this is the self-migrating seed path.
        const seeded = stepWarExhaustion({
          prev: undefined,
          conflictId: conflict._id,
          prevConflictId: null,
          turnsSinceEntry: sinceEntry,
        });
        console.log(
          `   ${countryId.padEnd(7)}  ${conflict._id.padEnd(18)}  ${String(joined).padStart(7)}  ${String(sinceEntry).padStart(5)}   ${f(seeded)}   (old curve ${f(warExhaustion(sinceEntry))})`
        );
      }
    }
    await client.close();
  }
}

void liveSection().then(() => console.log("\nDone."));
