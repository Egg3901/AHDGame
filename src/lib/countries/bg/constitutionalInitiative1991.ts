/** Constituent signatures authorize introduction, while adoption still needs a separate vote. */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { ElectedOfficial, NPP } from "@/lib/db/types";
import { computePartyLineForce, verdictFromForces } from "@/lib/turn/npp/crossPressure";
import { bg1991InitiativeSupport } from "./rules/constitutionalInitiative1991";

export const BG_1991_INITIATIVES_COLLECTION = "bg1991ConstitutionalInitiatives";
export class Bg1991InitiativeConflict extends Error {}
const id = (revision: number) => `1991-default:bg-constitutional:initiative:${revision}`;
type Signature = { signedOnTurn: number; reason: "personal_choice" | "npc_party_line" };
interface Initiative {
  _id: string;
  revision: number;
  signatures: Record<string, Signature>;
}
type Deputy = Pick<ElectedOfficial, "characterId" | "nppId" | "seatsHeld" | "party">;
function actor(row: Deputy) {
  if (row.characterId instanceof ObjectId && !row.nppId) return `character_${row.characterId}`;
  if (row.nppId instanceof ObjectId && !row.characterId) return `npp_${row.nppId}`;
  throw new Error("Constituent deputy has ambiguous financial ownership");
}
async function deputies(db: Db, session?: ClientSession) {
  return db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "BG", officeType: "assemblyDeputy", seatsHeld: { $ne: 0 } },
      { session, projection: { characterId: 1, nppId: 1, seatsHeld: 1, party: 1 } }
    )
    .toArray();
}
function support(rows: Deputy[], signatures: Record<string, Signature>) {
  return bg1991InitiativeSupport(
    rows.map((row) => ({
      actor: actor(row),
      seats: row.seatsHeld ?? 1,
      human: row.characterId != null,
    })),
    Object.keys(signatures),
    400
  );
}
export async function loadBg1991Initiative(db: Db, revision: number, session?: ClientSession) {
  const journal = await db
    .collection<Initiative>(BG_1991_INITIATIVES_COLLECTION)
    .findOne({ _id: id(revision) }, { session, projection: { revision: 1, signatures: 1 } });
  if (!journal) return { support: 0, required: 100, canIntroduce: false };
  if (journal.revision !== revision) throw new Error("Constituent initiative revision changed");
  const rows = await deputies(db, session);
  return support(rows, journal.signatures);
}
export async function signBg1991Initiative(input: {
  db: Db;
  session: ClientSession;
  revision: number;
  turn: number;
  characterId: ObjectId;
}) {
  const { db, session, revision, turn, characterId } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1
  )
    throw new Error("Constituent signatures need a transaction and valid revision");
  const rows = await deputies(db, session);
  const proposer = rows.find((row) => row.characterId?.equals(characterId));
  if (!proposer)
    throw new Bg1991InitiativeConflict("A seated constituent deputy must endorse this initiative");
  const journal = await db
    .collection<Initiative>(BG_1991_INITIATIVES_COLLECTION)
    .findOne({ _id: id(revision) }, { session });
  if (journal && journal.revision !== revision)
    throw new Error("Constituent initiative revision changed");
  const currentActors = new Set(rows.map(actor));
  const signatures: Record<string, Signature> = {
    ...Object.fromEntries(
      Object.entries(journal?.signatures ?? {}).filter(([key]) => currentActors.has(key))
    ),
    [actor(proposer)]: { signedOnTurn: turn, reason: "personal_choice" as const },
  };
  const npcs = await db
    .collection<Pick<NPP, "_id" | "party" | "personality">>("npps")
    .find(
      { _id: { $in: rows.flatMap((row) => (row.nppId ? [row.nppId] : [])) } },
      { session, projection: { party: 1, personality: 1 } }
    )
    .toArray();
  const owners = new Map(npcs.map((row) => [row._id.toHexString(), row]));
  for (const row of rows) {
    if (!row.nppId || row.characterId) continue;
    const npp = owners.get(row.nppId.toHexString());
    if (!npp) throw new Error("Constituent NPC financial owner is missing");
    if (
      verdictFromForces({
        ideology: computePartyLineForce(npp, proposer.party),
        whip: 0,
        district: 0,
        donors: 0,
      }) === "for" &&
      !signatures[actor(row)]
    )
      signatures[actor(row)] = { signedOnTurn: turn, reason: "npc_party_line" };
  }
  const result = support(rows, signatures);
  await db
    .collection<Initiative>(BG_1991_INITIATIVES_COLLECTION)
    .updateOne(
      { _id: id(revision) },
      { $set: { revision, signatures } },
      { session, upsert: true }
    );
  return result;
}
