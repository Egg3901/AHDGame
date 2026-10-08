import { ObjectId, type Db } from "mongodb";
import type { Shareholder } from "@/lib/db/types/corporation";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import { ownershipKey, type OwnerKind, type OwnershipHistory } from "./rules";

const holderFields = [
  ["character", "characterId", "characters"],
  ["imperial", "imperialCharacterId", "imperialCharacters"],
  ["corporation", "corporationId", "corporations"],
  ["npp", "nppId", "npps"],
  ["fund", "fundId", "indexFunds"],
] as const;

function identify(holder: Shareholder): { kind: OwnerKind; id: ObjectId } | null {
  for (const [kind, field] of holderFields) {
    if (holder[field]) return { kind, id: holder[field] };
  }
  return null;
}

/** Public ownership only. Never project cost basis or financial history fields. */
export async function loadOwnershipHistory(
  db: Db,
  corporationId: ObjectId,
  turns: number
): Promise<OwnershipHistory> {
  const collection = db.collection<CorporationHistory>("corporationHistory");
  const newest = await collection.findOne(
    { corporationId },
    { sort: { turn: -1 }, projection: { turn: 1 } }
  );
  if (!newest) return { snapshots: [], owners: [] };

  const rows = await collection
    .aggregate<Pick<CorporationHistory, "turn" | "totalShares" | "shareholders" | "publicFloat">>([
      { $match: { corporationId, turn: { $gte: newest.turn - turns + 1, $lte: newest.turn } } },
      { $sort: { turn: -1, createdAt: -1, _id: -1 } },
      {
        $project: {
          turn: 1,
          totalShares: 1,
          publicFloat: 1,
          shareholders: {
            $map: {
              input: "$shareholders",
              as: "holder",
              in: {
                characterId: "$$holder.characterId",
                imperialCharacterId: "$$holder.imperialCharacterId",
                corporationId: "$$holder.corporationId",
                nppId: "$$holder.nppId",
                fundId: "$$holder.fundId",
                shares: "$$holder.shares",
              },
            },
          },
        },
      },
      { $group: { _id: "$turn", row: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$row" } },
      { $sort: { turn: 1 } },
      { $limit: turns },
    ])
    .toArray();

  const identities = new Map<string, { kind: OwnerKind; id: ObjectId }>();
  const snapshots = rows.map((row) => ({
    turn: row.turn,
    totalShares: row.totalShares,
    publicFloat: row.publicFloat ?? null,
    holders:
      row.shareholders == null
        ? null
        : row.shareholders.flatMap((holder) => {
            const owner = identify(holder);
            if (!owner) return [];
            const key = ownershipKey(owner.kind, owner.id.toString());
            identities.set(key, owner);
            return [{ key, shares: holder.shares }];
          }),
  }));
  const names = new Map<string, string>();
  // At most one projected name lookup per holder class, including departed holders.
  await Promise.all(
    holderFields.map(async ([kind, , collectionName]) => {
      const ids = [...identities.values()]
        .filter((owner) => owner.kind === kind)
        .map((owner) => owner.id);
      if (ids.length === 0) return;
      const docs = await db
        .collection<{ _id: ObjectId; name: string }>(collectionName)
        .find({ _id: { $in: ids } }, { projection: { name: 1 } })
        .toArray();
      for (const doc of docs) names.set(ownershipKey(kind, doc._id.toString()), doc.name);
    })
  );
  return {
    snapshots,
    owners: [...identities].map(([key, owner]) => ({
      key,
      kind: owner.kind,
      name: names.get(key) ?? `${owner.kind} ${owner.id.toString().slice(-6)}`,
    })),
  };
}
