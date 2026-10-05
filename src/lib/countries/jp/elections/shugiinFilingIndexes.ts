/**
 * Guard active Japanese party nominations against concurrent district/list filings.
 * Independent constituency candidates do not share a party nomination slot.
 */

import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";

export type JapanShugiinFilingIndex = [string, IndexSpecification, CreateIndexesOptions];

export function japanShugiinDistrictPartyKey(party: string, constituencyId: string): string {
  return `${party}|${constituencyId}`;
}

/** Unique guards for active Japanese lower-house constituency and list nominations. */
export const JAPAN_SHUGIIN_FILING_INDEXES: JapanShugiinFilingIndex[] = [
  [
    "electionCandidates",
    { electionId: 1, japanShugiinDistrictPartyKey: 1 },
    {
      name: "unique_active_jp_shugiin_district_nominee",
      unique: true,
      partialFilterExpression: {
        countryId: "JP",
        status: "active",
        japanShugiinDistrictPartyKey: { $type: "string" },
      },
    },
  ],
  [
    "electionCandidates",
    { electionId: 1, party: 1, japanShugiinListOrder: 1 },
    {
      name: "unique_active_jp_shugiin_list_rank",
      unique: true,
      partialFilterExpression: {
        countryId: "JP",
        status: "active",
        party: { $type: "string" },
        japanShugiinListOrder: { $type: "number" },
      },
    },
  ],
];

const ensures = new WeakMap<Db, Promise<void>>();

/** Ensure the same partial unique guards during runtime and bootstrap seeding. */
export function ensureJapanShugiinFilingIndexes(db: Db): Promise<void> {
  const existing = ensures.get(db);
  if (existing) return existing;
  const pending = (async () => {
    const electionCandidates = db.collection("electionCandidates");
    // Backfill existing party nominations before creating the guard so upgraded worlds
    // receive the same uniqueness guarantee as newly filed candidates. Independent
    // nominations intentionally have no shared party-slot key.
    await electionCandidates.updateMany(
      {
        countryId: "JP",
        status: "active",
        constituencyId: { $type: "string" },
        party: { $type: "string", $ne: "independent" },
        japanShugiinDistrictPartyKey: { $exists: false },
      },
      [
        {
          $set: {
            japanShugiinDistrictPartyKey: {
              $concat: ["$party", "|", "$constituencyId"],
            },
          },
        },
      ]
    );
    await Promise.all(
      JAPAN_SHUGIIN_FILING_INDEXES.map(([collection, keys, options]) =>
        db.collection(collection).createIndex(keys, options)
      )
    );
  })();
  ensures.set(db, pending);
  void pending.catch(() => {
    if (ensures.get(db) === pending) ensures.delete(db);
  });
  return pending;
}
