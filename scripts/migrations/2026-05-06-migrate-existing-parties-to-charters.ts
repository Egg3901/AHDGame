/**
 * Phase 6 / Task 6.4 migration: synthesize a `partyCharters` row for every
 * existing non-default party.
 *
 * Per Phase 6 D7, default parties (Democrat / Republican / Labour / etc.,
 * `isDefault: true`) bypass the charter system. Non-default parties created
 * before Phase 6 need a back-fill charter so the cleanup-immunity hook
 * (`emptyPartyCleanup`) doesn't reap them and so the future presidential-
 * primary gate (Task 6.5) has a status to read.
 *
 * Founder selection (per non-default party):
 *   1. chair character's userId (if a chair is set and their character exists)
 *   2. viceChair character's userId
 *   3. treasurer character's userId
 *   4. then the oldest-joining party-affiliated characters by `createdAt`
 *
 * Up to 3 unique userIds are picked. Result statuses:
 *   - 3 founders found  → status: `migrated`
 *   - 1–2 founders      → status: `migrated-incomplete`,
 *                         pendingFounderSlots = 3 - founders
 *   - 0 founders        → status: `migrated-incomplete`, no synth signatures.
 *                         The party is empty-but-protected; admins will need
 *                         to manually retire or seed founders. We still create
 *                         a charter so cleanup-immunity kicks in.
 *
 * Platform: derives from the existing party position fields:
 *   - economic = round(economicPosition * 12)  // [-5,5] → [-60,60]
 *   - social   = round(socialPosition * 12)
 *
 * Idempotent: parties that already have a charter (any status) are skipped.
 *
 * Usage:
 *   # Dry run against live DB (default, no writes):
 *   npx tsx scripts/migrations/2026-05-06-migrate-existing-parties-to-charters.ts
 *
 *   # Apply for real:
 *   npx tsx scripts/migrations/2026-05-06-migrate-existing-parties-to-charters.ts --apply
 *
 *   # Run against local DB instead:
 *   npx tsx scripts/migrations/2026-05-06-migrate-existing-parties-to-charters.ts --db=local
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
  }
  dotenv.config();
  return null;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

interface PartyRow {
  _id: ObjectId;
  sequentialId: number;
  countryId: string;
  isDefault: boolean;
  chairId: ObjectId | null;
  viceChairId: ObjectId | null;
  treasurerId: ObjectId | null;
  economicPosition: number;
  socialPosition: number;
  name: string;
  abbreviation: string;
}

interface CharacterRow {
  _id: ObjectId;
  /** Optional because NPP / system characters may exist; we filter humans only. */
  userId: ObjectId | null;
  party?: string;
  countryId?: string;
  createdAt?: Date;
}

function clampAxis(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(-60, Math.min(60, Math.round(v)));
}

async function main() {
  const envPath = loadEnvLocal();
  const dbMode = getArg("db") === "local" ? "local" : "live";
  const uriKey = dbMode === "local" ? "MONGODB_URI" : "MONGODB_URI_LIVE";
  const uri = process.env[uriKey];
  if (!uri) {
    throw new Error(
      `Missing ${uriKey}. Loaded env from ${envPath ?? "default dotenv resolution"}.`
    );
  }
  const apply = hasFlag("apply");

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    console.log(`Mode: ${dbMode.toUpperCase()}${apply ? " (APPLY)" : " (dry-run)"}`);

    const parties = (await db
      .collection("politicalParties")
      .find({ isDefault: { $ne: true } })
      .toArray()) as unknown as PartyRow[];

    console.log(`Found ${parties.length} non-default parties to inspect.`);

    let migrated = 0;
    let migratedIncomplete = 0;
    let skippedAlreadyCharter = 0;
    let skippedZeroFounders = 0;

    const now = new Date();

    for (const party of parties) {
      const partyIdStr = String(party.sequentialId);

      const existing = await db
        .collection("partyCharters")
        .findOne({ partyId: partyIdStr, countryId: party.countryId });
      if (existing) {
        skippedAlreadyCharter++;
        continue;
      }

      // Collect candidate founder Characters in priority order:
      // chair → vice → treasurer → oldest senior members.
      const officerCharIds = [party.chairId, party.viceChairId, party.treasurerId].filter(
        (id): id is ObjectId => id !== null && id !== undefined
      );
      const officers = (await db
        .collection("characters")
        .find({ _id: { $in: officerCharIds } })
        .toArray()) as unknown as CharacterRow[];
      const officerById = new Map(officers.map((c) => [c._id.toString(), c]));

      const orderedOfficerCandidates: CharacterRow[] = officerCharIds
        .map((id) => officerById.get(id.toString()))
        .filter((c): c is CharacterRow => c !== undefined);

      const seniorCandidates = (await db
        .collection("characters")
        .find({
          party: partyIdStr,
          countryId: party.countryId,
          _id: { $nin: officerCharIds },
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(10)
        .toArray()) as unknown as CharacterRow[];

      // Founders are now characterIds (Phase 6 schema rev). Same priority
      // order — chair → vice → treasurer → oldest senior — but uniqueness
      // is at the character level so a single user with multiple
      // characters can fill multiple slots if they're the only humans
      // associated with the party.
      const founderCharacterIds: ObjectId[] = [];
      const seenCharacterKeys = new Set<string>();
      for (const c of [...orderedOfficerCandidates, ...seniorCandidates]) {
        if (founderCharacterIds.length >= 3) break;
        if (!c.userId) continue; // humans only
        const key = c._id.toString();
        if (seenCharacterKeys.has(key)) continue;
        seenCharacterKeys.add(key);
        founderCharacterIds.push(c._id);
      }

      const status = founderCharacterIds.length === 3 ? "migrated" : "migrated-incomplete";
      const pendingFounderSlots = 3 - founderCharacterIds.length;
      const signatures = founderCharacterIds.map((characterId) => ({
        characterId,
        signedAt: now,
      }));

      const charterDoc = {
        _id: new ObjectId(),
        countryId: party.countryId,
        partyId: partyIdStr,
        proposedName: party.name,
        proposedAbbr: party.abbreviation,
        foundersCharacterIds: founderCharacterIds,
        pendingFounderSlots,
        platform: {
          economic: clampAxis((party.economicPosition ?? 0) * 12),
          social: clampAxis((party.socialPosition ?? 0) * 12),
        },
        signatures,
        status,
        createdAt: now,
        expiresAt: null,
        ratifiedAt: now,
        founderReplacementDeadline: null,
        updatedAt: now,
      };

      console.log(
        `  party=${partyIdStr}/${party.countryId} (${party.abbreviation}): ` +
          `${founderCharacterIds.length} founders → ${status}`
      );

      if (founderCharacterIds.length === 0) {
        skippedZeroFounders++;
      }

      if (apply) {
        await db.collection("partyCharters").insertOne(charterDoc);
      }

      if (status === "migrated") migrated++;
      else migratedIncomplete++;
    }

    console.log("");
    console.log("=== Summary ===");
    console.log(`  parties scanned             : ${parties.length}`);
    console.log(`  already had charter (skip)  : ${skippedAlreadyCharter}`);
    console.log(`  → migrated                   : ${migrated}`);
    console.log(`  → migrated-incomplete        : ${migratedIncomplete}`);
    console.log(`     (of which 0 founders)     : ${skippedZeroFounders}`);
    console.log(apply ? "Applied." : "Dry run — no writes.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
