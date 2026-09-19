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

interface MotionVoteTallyUpdateOptions<TVote extends string> {
  motionId: string;
  voteKey: string;
  vote: TVote;
  tallyFieldByVote: VoteTallyFieldMap<TVote>;
  updatedAt: Date;
  weight?: number;
}

/**
 * Build an atomic update pipeline for one element of a motions array. The
 * $map rewrites only the matching voting motion's vote map + cached tallies
 * at write time, so concurrent votes on the same motion converge instead of
 * clobbering each other like a whole-array read/modify/write would. Sibling
 * motions pass through untouched; a non-voting match is left alone so the
 * caller can reject it after re-reading.
 */
export function buildMotionVoteTallyUpdate<TVote extends string>({
  motionId,
  voteKey,
  vote,
  tallyFieldByVote,
  updatedAt,
  weight = 1,
}: MotionVoteTallyUpdateOptions<TVote>) {
  const existingVoteExpr = {
    $getField: {
      field: voteKey,
      input: { $ifNull: ["$$m.votes", {}] },
    },
  };

  const tallyUpdates = Object.fromEntries(
    Object.entries(tallyFieldByVote).map(([voteValue, tallyField]) => [
      tallyField,
      {
        $add: [
          { $ifNull: [`$$m.${tallyField}`, 0] },
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
        motions: {
          $map: {
            input: "$motions",
            as: "m",
            in: {
              $cond: [
                {
                  $and: [{ $eq: ["$$m.motionId", motionId] }, { $eq: ["$$m.status", "voting"] }],
                },
                {
                  $mergeObjects: [
                    "$$m",
                    {
                      votes: {
                        $mergeObjects: [{ $ifNull: ["$$m.votes", {}] }, { [voteKey]: vote }],
                      },
                      ...tallyUpdates,
                    },
                  ],
                },
                "$$m",
              ],
            },
          },
        },
        updatedAt,
      },
    },
  ];
}
