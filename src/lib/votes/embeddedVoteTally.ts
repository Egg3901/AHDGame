type VoteTallyFieldMap<TVote extends string> = Record<TVote, string>;

interface EmbeddedVoteTallyUpdateOptions<TVote extends string> {
  voteField: string;
  voteKey: string;
  vote: TVote;
  tallyFieldByVote: VoteTallyFieldMap<TVote>;
  updatedAt: Date;
  weight?: number;
}

/**
 * Build an atomic update pipeline for vote maps that also maintain cached
 * tally fields. The pipeline reads the existing stored vote at write time so
 * concurrent re-votes cannot double-apply stale increment/decrement math.
 */
export function buildEmbeddedVoteTallyUpdate<TVote extends string>({
  voteField,
  voteKey,
  vote,
  tallyFieldByVote,
  updatedAt,
  weight = 1,
}: EmbeddedVoteTallyUpdateOptions<TVote>) {
  const existingVoteExpr = {
    $getField: {
      field: voteKey,
      input: { $ifNull: [`$${voteField}`, {}] },
    },
  };

  const tallyUpdates = Object.fromEntries(
    Object.entries(tallyFieldByVote).map(([voteValue, tallyField]) => [
      tallyField,
      {
        $add: [
          { $ifNull: [`$${tallyField}`, 0] },
          vote === voteValue ? weight : 0,
          {
            $cond: [{ $eq: [existingVoteExpr, voteValue] }, -weight, 0],
          },
        ],
      },
    ])
  );

  return [
    {
      $set: {
        [voteField]: {
          $mergeObjects: [{ $ifNull: [`$${voteField}`, {}] }, { [voteKey]: vote }],
        },
        updatedAt,
        ...tallyUpdates,
      },
    },
  ];
}
