import type { Collection, Document, Filter, ObjectId, UpdateResult } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";

interface PendingVoteContainer {
  _id: ObjectId;
  status: string;
  votes: ProposalVoteRecord[];
}

/**
 * Rewrite the embedded vote list atomically so each country has at most one
 * live vote row even if parallel requests land before either response returns.
 */
export async function upsertPendingOrganizationVote<T extends PendingVoteContainer>(
  collection: Collection<T>,
  documentId: ObjectId,
  vote: ProposalVoteRecord
): Promise<UpdateResult<T>> {
  const pipeline: Document[] = [
    {
      $set: {
        votes: {
          $concatArrays: [
            {
              $filter: {
                input: "$votes",
                as: "existingVote",
                cond: {
                  $ne: ["$$existingVote.countryId", vote.countryId],
                },
              },
            },
            [vote],
          ],
        },
      },
    },
  ];

  return collection.updateOne(
    {
      _id: documentId,
      status: "pending",
    } as Filter<T>,
    pipeline
  );
}

/**
 * Fold historical duplicate rows down to the latest vote per country so stale
 * corruption cannot keep affecting unanimous or majority vote resolution.
 */
export function dedupeOrganizationVotes(votes: ProposalVoteRecord[]): ProposalVoteRecord[] {
  const latestByCountry = new Map<CountryId, ProposalVoteRecord>();
  for (const vote of votes) {
    latestByCountry.set(vote.countryId, vote);
  }
  return [...latestByCountry.values()];
}
