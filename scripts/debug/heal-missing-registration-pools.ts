/**
 * Create the `stateRegistrationPool` rows that statehood admission failed to
 * write, and apply the registration shares it skipped on the way past.
 *
 * WHY THIS EXISTS. `seedAdmittedStatePolitics` resolved the registration seed's
 * parties by ABBREVIATION and threw when one did not match. The live world
 * renamed the seeded "REP" to "GOP" (a separate party document, sequentialId 6,
 * `isDefault: false`), so every US admission threw on the second party in the
 * seed — after the seats, org rows and DEM's shares were written, but BEFORE
 * the `stateRegistrationPool` upsert at the end of the block.
 *
 * The live signature is unambiguous. Alaska, admitted in-game 1955:
 *
 *     DEM  reg 31.00   (1953 seed says 32 — applied, then drifted)
 *     GOP  reg  1.00   (1953 seed says 30 — never applied)
 *     stateRegistrationPool US_AK — absent
 *
 * Hawaii (admitted 1965) carries the same shape. The pool row matters because
 * `regDriftDecay` uses pool existence as its bootstrap gate and skips any state
 * without one — so Reg in AK and HI is not slow, it is frozen, and the
 * registration drive cannot run there at all.
 *
 * DC is a third case with the same symptom and a different cause: it is never
 * admitted (no `admittedYear`), so statehood never runs for it, and
 * `buildUSSeeds1953` filters the bootstrap bundle to `HOUSE_SEATS_1953` — the
 * constitutional 48 — which excludes DC because it has no House seats. It has
 * `statePartyOrg` rows and an authored 1953 override, so it should have a pool.
 *
 * THE CODE FIX SHIPS ALONGSIDE THIS. `statehood.ts` now falls back to the
 * canonical seed NAME when an abbreviation does not resolve, and warns instead
 * of throwing so a single unmatched party can never again strand an admission.
 * That fixes future admissions; it cannot retroactively create rows for AK/HI,
 * which is what this script is for.
 *
 * WHAT IT WRITES. Only `stateRegistrationPool` rows that are ABSENT, from the
 * authored 1953 seed values, plus (with --shares) the registration/organization
 * shares for parties whose row still sits at the untouched bootstrap default.
 * It never overwrites an existing pool row, and never lowers a party's Reg.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT TOUCH — a second live consequence of the
 * same root cause. `buildMajorPartyOrgsForState` hardcodes Republican =
 * sequentialId 2, so admission also wrote the REPUBLICANS' starting
 * organisation (25) onto whatever party holds seq 2 — the Farmer-Labor Party.
 * Live: `AK_2` org 53.49 and `HI_2` org 22.89 (drifted up from the seeded 25),
 * while the real Republican rows sat at 4.60 / 8.42. The code fix stops this
 * happening again, but FLP has been playing on that organisation for in-game
 * decades and rolling it back is a balance decision, not a repair. Raise it
 * with the user before touching those two rows.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write, `--live` to target
 * MONGODB_URI_LIVE, `--shares` to also apply the skipped party shares.
 *
 * STATUS: NOT RUN.
 */
import { MongoClient, type Db } from "mongodb";
import fs from "node:fs";
import { get1953USRegistrationSeed } from "@/lib/seeds/registration/registrationLanes1953";
import { politicalParties as SEED_PARTIES } from "@/lib/seeds/reference/politicalParties";
import type { PoliticalParty, StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";

const APPLY = process.argv.includes("--apply");
const LIVE = process.argv.includes("--live");
const SHARES = process.argv.includes("--shares");

/** Jurisdictions the bootstrap bundle deliberately skips in a 1953 world. */
const CANDIDATES = ["AK", "HI", "DC"];

function uri(): string {
  const env = fs.readFileSync(".env.local", "utf8");
  const key = LIVE ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const raw = (env.match(new RegExp(`^${key}=(.*)$`, "m")) ?? [])[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!raw) throw new Error(`${key} not found in .env.local`);
  // Railway's Mongo needs a direct connection; replica-set discovery hangs.
  return LIVE ? raw + (raw.includes("?") ? "&" : "?") + "directConnection=true" : raw;
}

const seedNameByAbbr = new Map(
  SEED_PARTIES.filter((p) => p.countryId === "US" && p.abbreviation && p.name).map(
    (p) => [p.abbreviation.toUpperCase(), p.name.trim().toLowerCase()] as const
  )
);

async function main(): Promise<void> {
  const client = new MongoClient(uri());
  await client.connect();
  const db = client.db() as unknown as Db;

  try {
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: "US" })
      .toArray();
    const byAbbr = new Map(parties.map((p) => [p.abbreviation?.toUpperCase(), p] as const));
    const byName = new Map(parties.map((p) => [p.name?.trim().toLowerCase(), p] as const));

    console.log(`${APPLY ? "APPLY" : "DRY RUN"} against ${LIVE ? "LIVE" : "testing"} database\n`);

    let poolsCreated = 0;
    let sharesApplied = 0;

    for (const stateId of CANDIDATES) {
      const seed = get1953USRegistrationSeed(stateId);
      if (!seed) {
        console.log(`${stateId}: no 1953 registration seed — skipping`);
        continue;
      }

      const orgRows = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({ countryId: "US", stateId })
        .toArray();
      if (orgRows.length === 0) {
        console.log(`${stateId}: no statePartyOrg rows — not part of this world, skipping`);
        continue;
      }

      const poolId = `US_${stateId}`;
      const pool = await db
        .collection<StateRegistrationPool>("stateRegistrationPool")
        .findOne({ _id: poolId });

      if (pool) {
        console.log(
          `${stateId}: pool already exists (ind ${pool.independent} / unreg ${pool.unregistered}) — leaving alone`
        );
      } else {
        console.log(
          `${stateId}: CREATE pool ind=${seed.independent} unreg=${seed.unregistered} (from 1953 seed)`
        );
        poolsCreated += 1;
        if (APPLY) {
          const now = new Date();
          await db.collection<StateRegistrationPool>("stateRegistrationPool").updateOne(
            { _id: poolId },
            {
              $set: {
                countryId: "US",
                stateId,
                independent: seed.independent,
                unregistered: seed.unregistered,
                lastUpdatedTurn: 0,
                updatedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            { upsert: true }
          );
        }
      }

      if (!SHARES) continue;

      for (const share of seed.parties) {
        const canonical = seedNameByAbbr.get(share.abbr.toUpperCase());
        const byAbbrMatch = byAbbr.get(share.abbr.toUpperCase());
        const party = byAbbrMatch ?? (canonical ? byName.get(canonical) : undefined);
        if (!party) {
          console.log(`  ${stateId}/${share.abbr}: no matching party in this world — skipping`);
          continue;
        }
        // Only parties the ORIGINAL admission could not resolve were skipped.
        // A party that still matches its seed abbreviation had its shares
        // applied at admission and has been played since — AK's DEM sits at
        // reg 31 against a seeded 32 purely from ten in-game years of drift,
        // and rewriting that would revert real play, not heal a gap.
        if (byAbbrMatch) {
          console.log(
            `  ${stateId}/${share.abbr} (${party.abbreviation}): matched by abbreviation, so it was seeded at admission — leaving alone`
          );
          continue;
        }
        const rowId = `${stateId}_${party.sequentialId}`;
        const row = orgRows.find((r) => r._id === rowId);
        if (!row) {
          console.log(`  ${stateId}/${share.abbr}: no statePartyOrg row ${rowId} — skipping`);
          continue;
        }
        const currentReg = row.registration ?? 0;
        // Only fill in a share that never landed. A row already at or above the
        // seeded value has been played since; never walk a live figure back.
        if (currentReg >= share.reg) {
          console.log(
            `  ${stateId}/${share.abbr} (${party.abbreviation}): reg ${currentReg} >= seed ${share.reg} — leaving alone`
          );
          continue;
        }
        console.log(
          `  ${stateId}/${share.abbr} (${party.abbreviation}): APPLY reg ${currentReg} -> ${share.reg}, org ${row.organization ?? 0} -> ${share.org}`
        );
        sharesApplied += 1;
        if (APPLY) {
          await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
            { _id: rowId },
            {
              $set: {
                organization: share.org,
                registration: share.reg,
                hasPresence: true,
                updatedAt: new Date(),
              },
            }
          );
        }
      }
    }

    console.log(
      `\n${APPLY ? "Applied" : "Would create"}: ${poolsCreated} pool row(s)` +
        (SHARES ? `, ${sharesApplied} party share update(s)` : " (pass --shares for party shares)")
    );
    if (!APPLY) console.log("Dry run only — pass --apply to write.");
  } finally {
    await client.close();
  }
}

void main();
