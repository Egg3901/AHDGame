import type { Collection, Document, Filter, ObjectId, UpdateResult } from "mongodb";
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

// Re-exported so the existing server-side importers keep one import path; the
// implementation lives in resolutionRules.ts because the client panels tally too.
export { dedupeOrganizationVotes } from "./resolutionRules";
