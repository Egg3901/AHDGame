/**
 * READ-ONLY. Diagnose the "already a candidate" + "0 candidates" desync for a
 * named character's National Chair race. Confirms whether the candidacy is
 * attached to a different nationalPartyElections doc than the panel lists
 * (duplicate voting elections / countryId null-vs-explicit split).
 *
 *   MONGODB_URI="$(grep '^MONGODB_URI=' .env.local | cut -d= -f2-)" \
 *     npx tsx scripts/migrations/diagnose-national-chair-desync.ts "Ronan Vale"
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI not set");
const NAME = process.argv[2] ?? "Ronan Vale";

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();

  const character = await db
    .collection("characters")
    .findOne({ name: { $regex: `^${NAME}$`, $options: "i" } });
  if (!character) {
    console.log(`No character named "${NAME}"`);
    await client.close();
    return;
  }
  const partyId = character.party ?? character.partyId ?? null;
  console.log(`Character: ${character.name}  _id=${character._id}`);
  console.log(`  party(string)=${partyId}  countryId=${character.countryId}`);

  // All national-party elections for this party (any position/status) — look for dupes.
  const elections = await db
    .collection("nationalPartyElections")
    .find({ partyId: String(partyId) })
    .sort({ position: 1, createdAt: 1 })
    .toArray();
  console.log(`\nnationalPartyElections for partyId=${partyId}: ${elections.length}`);
  for (const e of elections) {
    console.log(
      `  _id=${e._id}  position=${e.position}  status=${e.status}  countryId=${JSON.stringify(
        e.countryId
      )}  turns=${e.startTurn}->${e.endTurn}  created=${e.createdAt?.toISOString?.() ?? e.createdAt}`
    );
  }
  // Dup detection: same position with >1 doc.
  const byPos: Record<string, number> = {};
  for (const e of elections) byPos[e.position] = (byPos[e.position] ?? 0) + 1;
  const dups = Object.entries(byPos).filter(([, n]) => n > 1);
  console.log(
    dups.length
      ? `  >>> DUPLICATE positions: ${JSON.stringify(dups)}`
      : `  (no duplicate positions)`
  );

  // This character's candidacies.
  const cands = await db
    .collection("nationalPartyCandidates")
    .find({ characterId: character._id })
    .toArray();
  console.log(`\nnationalPartyCandidates for ${character.name}: ${cands.length}`);
  const elById = new Map(elections.map((e) => [e._id.toString(), e]));
  for (const c of cands) {
    const linked = elById.get(c.electionId?.toString());
    console.log(
      `  _id=${c._id}  position=${c.position}  status=${c.status}  countryId=${JSON.stringify(
        c.countryId
      )}  electionId=${c.electionId}`
    );
    console.log(
      linked
        ? `     -> linked election: position=${linked.position} status=${linked.status} countryId=${JSON.stringify(linked.countryId)}`
        : `     -> !! electionId NOT among this party's elections (orphaned/foreign election doc)`
    );
  }

  // Chair-specific cross check: which chair election would ENTER match vs which the panel lists.
  const chairPositions = elections.filter((e) => /chair/i.test(String(e.position)));
  console.log(`\nChair-position election docs: ${chairPositions.length}`);
  for (const e of chairPositions) {
    const activeCands = await db
      .collection("nationalPartyCandidates")
      .countDocuments({ electionId: e._id, status: "active" });
    console.log(
      `  chair election _id=${e._id} status=${e.status} countryId=${JSON.stringify(e.countryId)} -> ${activeCands} active candidate(s)`
    );
  }

  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
