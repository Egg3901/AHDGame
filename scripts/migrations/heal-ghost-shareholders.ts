/**
 * Heal pass for historical damage from the self-delete / admin-delete bug
 * (forward fix lives in `src/lib/account/cascadeCharacterDeletion.ts`).
 *
 * For every corporation:
 *   - For each shareholder entry whose `characterId` / `imperialCharacterId`
 *     does not resolve to a row in `characters`, `retiredCharacters`, or
 *     `imperialCharacters`, $pull the entry and $inc `publicFloat` by the
 *     pulled shares.
 *   - If `ceoId` does not resolve and `ceoVacant !== true`, mark the seat
 *     vacant (same $set/$unset shape as `vacateCeoForBannedUser`).
 *
 * Does NOT touch entries whose holder still exists. Dry-run by default —
 * pass --execute to apply.
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import type { Corporation } from "../../src/lib/db/types/corporation";
import type { GameState } from "../../src/lib/db/types/gameState";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

interface GhostShareholderAction {
  corpId: ObjectId;
  corpSeq: number | undefined;
  corpName: string;
  kind: "character" | "imperial";
  holderId: ObjectId;
  shares: number;
}

interface GhostCeoAction {
  corpId: ObjectId;
  corpSeq: number | undefined;
  corpName: string;
  kind: "character" | "imperial";
  ceoId: ObjectId;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const corpsCollection = db.collection<Corporation>("corporations");
  const corps = await corpsCollection.find({}).toArray();
  console.log(`Scanning ${corps.length} corporations...\n`);

  // Collect every referenced id up-front, then bulk-check existence.
  const charIdStrs = new Set<string>();
  const imperialIdStrs = new Set<string>();
  for (const corp of corps) {
    if (corp.ceoId) {
      if (corp.ceoType === "imperial") imperialIdStrs.add(corp.ceoId.toString());
      else charIdStrs.add(corp.ceoId.toString());
    }
    for (const sh of corp.shareholders ?? []) {
      if (sh.characterId) charIdStrs.add(sh.characterId.toString());
      if (sh.imperialCharacterId) imperialIdStrs.add(sh.imperialCharacterId.toString());
    }
  }

  const charOids = Array.from(charIdStrs).map((s) => new ObjectId(s));
  const imperialOids = Array.from(imperialIdStrs).map((s) => new ObjectId(s));

  const [existingChars, existingRetired, existingImperial] = await Promise.all([
    charOids.length
      ? db
          .collection("characters")
          .find({ _id: { $in: charOids } }, { projection: { _id: 1 } })
          .toArray()
      : Promise.resolve([]),
    charOids.length
      ? db
          .collection("retiredCharacters")
          .find({ _id: { $in: charOids } }, { projection: { _id: 1 } })
          .toArray()
      : Promise.resolve([]),
    imperialOids.length
      ? db
          .collection("imperialCharacters")
          .find({ _id: { $in: imperialOids } }, { projection: { _id: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);

  const liveChars = new Set(existingChars.map((c) => c._id.toString()));
  const liveRetired = new Set(existingRetired.map((c) => c._id.toString()));
  const liveImperial = new Set(existingImperial.map((c) => c._id.toString()));

  const shareholderActions: GhostShareholderAction[] = [];
  const ceoActions: GhostCeoAction[] = [];

  for (const corp of corps) {
    for (const sh of corp.shareholders ?? []) {
      if (sh.characterId) {
        const idStr = sh.characterId.toString();
        if (!liveChars.has(idStr) && !liveRetired.has(idStr)) {
          shareholderActions.push({
            corpId: corp._id,
            corpSeq: corp.sequentialId,
            corpName: corp.name,
            kind: "character",
            holderId: sh.characterId,
            shares: sh.shares,
          });
        }
      } else if (sh.imperialCharacterId) {
        const idStr = sh.imperialCharacterId.toString();
        if (!liveImperial.has(idStr)) {
          shareholderActions.push({
            corpId: corp._id,
            corpSeq: corp.sequentialId,
            corpName: corp.name,
            kind: "imperial",
            holderId: sh.imperialCharacterId,
            shares: sh.shares,
          });
        }
      }
      // shareholder corporationId entries are not in scope here.
    }

    if (corp.ceoId && !corp.ceoVacant) {
      const idStr = corp.ceoId.toString();
      const isImperial = corp.ceoType === "imperial";
      const resolved = isImperial
        ? liveImperial.has(idStr)
        : liveChars.has(idStr) || liveRetired.has(idStr);
      if (!resolved) {
        ceoActions.push({
          corpId: corp._id,
          corpSeq: corp.sequentialId,
          corpName: corp.name,
          kind: isImperial ? "imperial" : "character",
          ceoId: corp.ceoId,
        });
      }
    }
  }

  console.log("=== Planned shareholder releases → publicFloat ===");
  console.log(
    `  entries=${shareholderActions.length} totalShares=${shareholderActions.reduce((s, a) => s + a.shares, 0)}`
  );
  for (const a of shareholderActions) {
    console.log(
      `  #${a.corpSeq} ${a.corpName} — ${a.kind} ${a.holderId.toString()} shares=${a.shares}`
    );
  }

  console.log("\n=== Planned CEO vacates ===");
  console.log(`  corps=${ceoActions.length}`);
  for (const a of ceoActions) {
    console.log(`  #${a.corpSeq} ${a.corpName} — ${a.kind} ${a.ceoId.toString()}`);
  }

  if (!execute) {
    console.log(`\nDRY RUN — pass --execute to apply`);
    await client.close();
    return;
  }

  // Apply shareholder releases
  let appliedShares = 0;
  let appliedShareRows = 0;
  for (const a of shareholderActions) {
    const res =
      a.kind === "character"
        ? await corpsCollection.updateOne(
            { _id: a.corpId, "shareholders.characterId": a.holderId },
            {
              $pull: { shareholders: { characterId: a.holderId } },
              $inc: { publicFloat: a.shares },
            }
          )
        : await corpsCollection.updateOne(
            { _id: a.corpId, "shareholders.imperialCharacterId": a.holderId },
            {
              $pull: { shareholders: { imperialCharacterId: a.holderId } },
              $inc: { publicFloat: a.shares },
            }
          );
    if (res.modifiedCount === 1) {
      appliedShares += a.shares;
      appliedShareRows++;
    } else {
      console.warn(
        `  WARN: no-op for corp #${a.corpSeq} holder ${a.holderId.toString()} — state drift?`
      );
    }
  }

  // Apply CEO vacates
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const currentTurn = gameState?.currentTurn ?? 0;
  const now = new Date();
  let appliedCeo = 0;
  for (const a of ceoActions) {
    const res = await corpsCollection.updateOne(
      { _id: a.corpId, ceoId: a.ceoId, ceoVacant: { $ne: true } },
      {
        $set: {
          ceoVacant: true,
          ceoVacantSinceTurn: currentTurn,
          updatedAt: now,
        },
        $unset: { ceoId: "", userId: "" },
      }
    );
    if (res.modifiedCount === 1) appliedCeo++;
  }

  console.log(`\n=== APPLIED ===`);
  console.log(
    `  shareholder rows cleared: ${appliedShareRows}/${shareholderActions.length} (${appliedShares} shares → publicFloat)`
  );
  console.log(`  CEOs vacated: ${appliedCeo}/${ceoActions.length}`);

  // Re-verify invariant for every touched corp
  const touchedCorpIds = new Set<string>([
    ...shareholderActions.map((a) => a.corpId.toString()),
    ...ceoActions.map((a) => a.corpId.toString()),
  ]);
  console.log(`\n=== Invariant verification ===`);
  let allOk = true;
  for (const idStr of touchedCorpIds) {
    const c = await corpsCollection.findOne({ _id: new ObjectId(idStr) });
    if (!c) continue;
    const sumSh = (c.shareholders ?? []).reduce((s, sh) => s + (sh.shares ?? 0), 0);
    const ok = (c.publicFloat ?? 0) + sumSh === c.totalShares;
    if (!ok) allOk = false;
    console.log(
      `  #${c.sequentialId} ${c.name}: publicFloat=${c.publicFloat ?? 0} + Σsh=${sumSh} == totalShares=${c.totalShares} → ${ok}`
    );
  }
  console.log(`\n  all invariants ok: ${allOk}`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
