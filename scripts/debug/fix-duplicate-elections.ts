/**
 * Retire the Federal Republic's races that came across in the reversal.
 *
 * WHAT WENT WRONG. The reversal remapped `electedOfficials.officeType` but not
 * `elections.electionType`: the FRG's active races moved country and kept their
 * own offices, and the next turn then spawned the GDR's races from DD's config.
 * The unified state ended up running BOTH — 96 active races over 16 regions where
 * there should be 48 — which is what a player reported as "we have bundestag and
 * also volkskammer".
 *
 * NOT A REMAP. The equivalent GDR race already exists in every region, so
 * renaming the stale one would produce two races of the same type. The stale
 * races are deleted — but only the ACTIVE ones. The resolved FRG races are real
 * electoral history from when that country existed and are left alone.
 *
 * ⚠️ PLAYER STAKES MOVE FIRST. Four player candidacies sit on these races, plus a
 * slate and a recruitment slate. They are NOT linked by `userId` — that field is
 * null on every candidacy — but by `characterId`, so a check for player
 * involvement that trusted `userId` would have reported none and deleted all four.
 * Each is moved to the equivalent race in the SAME region before anything is
 * removed, and skipped if that character already stands there.
 *
 * DRY RUN BY DEFAULT. `--apply` writes.
 */
import { MongoClient } from "mongodb";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const TO = "DD";

/** The Federal Republic's offices, and the GDR office each corresponds to. */
const EQUIV: Record<string, string> = {
  bundestag: "volkskammerDeputy",
  landtag: "landAssembly",
  ministerPresident: "governor",
};

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set");
  const client = new MongoClient(uri, { directConnection: true });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_LIVE || undefined);

  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — turn ${gs?.currentTurn} processing=${gs?.processingStartedAt ?? "-"}\n`
  );

  const stale = await db
    .collection("elections")
    .find({ countryId: TO, status: "active", electionType: { $in: Object.keys(EQUIV) } })
    .toArray();
  console.log(`stale active races: ${stale.length}`);
  if (stale.length === 0) {
    console.log("nothing to do");
    await client.close();
    return;
  }

  // Target race per stale race: same region, the equivalent office.
  const targetFor = new Map<string, unknown>();
  let unmatched = 0;
  for (const el of stale) {
    const target = await db.collection("elections").findOne({
      countryId: TO,
      status: "active",
      electionType: EQUIV[String(el.electionType)],
      state: el.state,
    } as never);
    if (target) targetFor.set(String(el._id), target._id);
    else unmatched++;
  }
  console.log(
    `  with an equivalent race in the same region: ${targetFor.size}, without: ${unmatched}`
  );
  if (unmatched > 0) {
    throw new Error("a stale race has no equivalent — refusing to delete anything");
  }

  const staleIds = stale.map((e) => e._id);
  const players = await db
    .collection("characters")
    .find({ countryId: TO, userId: { $ne: null } })
    .project({ _id: 1 })
    .toArray();
  const playerIds = players.map((p) => p._id);

  // ── move the player stakes ───────────────────────────────────────────────
  const stakes = await db
    .collection("electionCandidates")
    .find({ electionId: { $in: staleIds }, characterId: { $in: playerIds } } as never)
    .toArray();
  console.log(`\nplayer candidacies to move: ${stakes.length}`);
  for (const c of stakes) {
    const target = targetFor.get(String(c.electionId));
    const already = await db
      .collection("electionCandidates")
      .countDocuments({ electionId: target, characterId: c.characterId } as never);
    console.log(
      `  ${c.characterName || String(c.characterId)}: -> ${String(target)}${already ? "  (already standing — stale row dropped)" : ""}`
    );
    if (APPLY && !already) {
      await db
        .collection("electionCandidates")
        .updateOne({ _id: c._id }, { $set: { electionId: target, updatedAt: new Date() } });
    }
  }

  // Slates point at an election too.
  for (const coll of ["slateCandidates", "recruitmentSlates", "statePartyCandidates"]) {
    const rows = await db
      .collection(coll)
      .find({ electionId: { $in: staleIds } } as never)
      .toArray()
      .catch(() => []);
    for (const r of rows) {
      const target = targetFor.get(String(r.electionId));
      console.log(`  ${coll} ${String(r._id)} -> ${String(target)}`);
      if (APPLY) {
        await db
          .collection(coll)
          .updateOne({ _id: r._id }, { $set: { electionId: target, updatedAt: new Date() } });
      }
    }
  }

  // ── remove what is left of the stale races ───────────────────────────────
  const npps = await db
    .collection("electionCandidates")
    .countDocuments({ electionId: { $in: staleIds } } as never);
  const tallies = await db
    .collection("electionVoteTallies")
    .countDocuments({ electionId: { $in: staleIds } } as never);
  console.log(`\nremaining on stale races: ${npps} candidacy(ies), ${tallies} tally row(s)`);
  console.log(`deleting ${stale.length} active race(s); resolved history is left alone`);
  if (APPLY) {
    await db
      .collection("electionCandidates")
      .deleteMany({ electionId: { $in: staleIds } } as never);
    await db
      .collection("electionVoteTallies")
      .deleteMany({ electionId: { $in: staleIds } } as never);
    await db.collection("elections").deleteMany({ _id: { $in: staleIds } } as never);
  }

  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written.");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
