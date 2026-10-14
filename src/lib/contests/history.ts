import { ObjectId, type Db, type Document } from "mongodb";
import type { ContestRecordKind } from "@/lib/db/types/contestRound";
import { getContestRoundsCollection } from "./collection";
import type { ContestsViewer } from "./queries";

export const HISTORY_PAGE_SIZE = 20;
export interface ContestHistoryEntry {
  id: string;
  kind: ContestRecordKind;
  iterationKey: string | null;
  roundNumber: number;
  settledAt: string;
  rank: number;
  entrants: number;
  characterName: string;
  subjectName: string;
  score: number;
  placed: boolean;
  prizeAnchor: number;
  supporter: boolean;
  alreadySupporter: boolean;
}
export interface ContestTotals {
  kind: ContestRecordKind;
  rounds: number;
  wins: number;
  podiums: number;
  bestRank: number;
  prizeAnchor: number;
}
export interface ContestHistoryData {
  entries: ContestHistoryEntry[];
  totals: ContestTotals[];
  count: number;
  page: number;
  iterations: string[];
}
export interface ContestChampion {
  userId: string;
  characterName: string;
  wins: number;
  podiums: number;
  rounds: number;
  prizeAnchor: number;
}

/** One best entry per account per round. Prize sums include every paid entry. */
function resultPipeline(): Document[] {
  return [
    {
      $project: {
        kind: 1,
        roundNumber: 1,
        iterationKey: 1,
        settledAt: 1,
        standings: 1,
        winners: 1,
      },
    },
    { $set: { entrants: { $size: "$standings" } } },
    { $unwind: { path: "$standings", includeArrayIndex: "position" } },
    {
      $set: {
        rank: { $add: ["$position", 1] },
        winner: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$winners",
                as: "w",
                cond: {
                  $and: [
                    { $eq: ["$$w.subjectId", "$standings.subjectId"] },
                    { $eq: ["$$w.characterId", "$standings.characterId"] },
                  ],
                },
              },
            },
            0,
          ],
        },
      },
    },
  ];
}
function accountRoundPipeline(): Document[] {
  return [
    { $sort: { rank: 1 } },
    {
      $group: {
        _id: { round: "$_id", user: "$standings.userId" },
        entry: { $first: "$$ROOT" },
        prizeAnchor: {
          $sum: { $cond: ["$winner.paidAt", { $ifNull: ["$winner.prizeAnchor", 0] }, 0] },
        },
        placed: { $max: { $cond: [{ $gt: [{ $ifNull: ["$winner.score", 0] }, 0] }, 1, 0] } },
        won: {
          $max: {
            $cond: [
              { $eq: [{ $ifNull: ["$winner.rank", 1] }, 1] },
              { $cond: [{ $gt: ["$winner.score", 0] }, 1, 0] },
              0,
            ],
          },
        },
      },
    },
    {
      $replaceWith: {
        $mergeObjects: [
          "$entry",
          {
            prizeAnchor: "$prizeAnchor",
            placed: "$placed",
            won: "$won",
          },
        ],
      },
    },
  ];
}

export async function loadContestHistory(
  db: Db,
  viewer: ContestsViewer,
  page = 1,
  filter: { kind?: ContestRecordKind; iterationKey?: string } = {}
): Promise<ContestHistoryData> {
  const userId = viewer.userId;
  // Legacy rows can still be linked while a live or retired character exists.
  const [live, retired] = await Promise.all([
    db
      .collection("characters")
      .find({ userId: new ObjectId(userId) }, { projection: { _id: 1 } })
      .toArray(),
    db
      .collection("retiredCharacters")
      .find({ userId: new ObjectId(userId) }, { projection: { characterId: 1 } })
      .toArray(),
  ]);
  const characterIds = [
    ...new Set([
      ...live.map((c) => c._id.toString()),
      ...retired.map((c) => c.characterId.toString()),
      ...(viewer.characterId ? [viewer.characterId] : []),
    ]),
  ];
  const belongs = {
    $or: [
      { "standings.userId": userId },
      { "standings.userId": null, "standings.characterId": { $in: characterIds } },
    ],
  };
  const match = {
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.iterationKey ? { iterationKey: filter.iterationKey } : {}),
  };
  const requestedPage = Number.isSafeInteger(page) ? Math.max(1, Math.min(page, 100_000)) : 1;
  type Facet = {
    entries: Array<Omit<ContestHistoryEntry, "settledAt"> & { settledAt: Date }>;
    count: Array<{ value: number }>;
    totals: ContestTotals[];
    iterations: Array<{ _id: string | null }>;
  };
  const [result] = await getContestRoundsCollection(db)
    .aggregate<Facet>([
      {
        $match: {
          status: "settled",
          $or: [{ "standings.userId": userId }, { "standings.characterId": { $in: characterIds } }],
        },
      },
      ...resultPipeline(),
      { $match: belongs },
      ...accountRoundPipeline(),
      {
        $facet: {
          entries: [
            { $match: match },
            { $sort: { settledAt: -1, _id: 1 } },
            { $skip: (requestedPage - 1) * HISTORY_PAGE_SIZE },
            { $limit: HISTORY_PAGE_SIZE },
            {
              $project: {
                _id: 0,
                id: "$_id",
                kind: 1,
                iterationKey: { $ifNull: ["$iterationKey", null] },
                roundNumber: 1,
                settledAt: 1,
                rank: 1,
                entrants: 1,
                characterName: "$standings.characterName",
                subjectName: "$standings.subjectName",
                score: "$standings.score",
                placed: { $eq: ["$placed", 1] },
                prizeAnchor: 1,
                alreadySupporter: { $eq: ["$winner.alreadySupporter", true] },
                supporter: {
                  $and: [
                    { $eq: ["$kind", "referrals_iteration"] },
                    { $eq: ["$placed", 1] },
                    { $in: ["$winner.alreadySupporter", [true, false]] },
                  ],
                },
              },
            },
          ],
          count: [{ $match: match }, { $count: "value" }],
          totals: [
            {
              $group: {
                _id: "$kind",
                rounds: { $sum: 1 },
                wins: { $sum: "$won" },
                podiums: { $sum: "$placed" },
                bestRank: { $min: "$rank" },
                prizeAnchor: { $sum: "$prizeAnchor" },
              },
            },
            {
              $project: {
                _id: 0,
                kind: "$_id",
                rounds: 1,
                wins: 1,
                podiums: 1,
                bestRank: 1,
                prizeAnchor: 1,
              },
            },
            { $sort: { kind: 1 } },
          ],
          iterations: [{ $group: { _id: "$iterationKey" } }, { $sort: { _id: 1 } }],
        },
      },
    ])
    .toArray();
  return {
    entries: (result?.entries ?? []).map((r) => ({ ...r, settledAt: r.settledAt.toISOString() })),
    count: result?.count[0]?.value ?? 0,
    totals: result?.totals ?? [],
    page: requestedPage,
    iterations: (result?.iterations ?? []).map((i) => i._id).filter((i): i is string => !!i),
  };
}

export async function loadContestChampions(db: Db): Promise<ContestChampion[]> {
  return getContestRoundsCollection(db)
    .aggregate<ContestChampion>([
      { $match: { status: "settled" } },
      ...resultPipeline(),
      { $match: { "standings.userId": { $type: "string" } } },
      ...accountRoundPipeline(),
      { $sort: { settledAt: -1, _id: 1 } },
      {
        $group: {
          _id: "$standings.userId",
          characterName: { $first: "$standings.characterName" },
          wins: { $sum: "$won" },
          podiums: { $sum: "$placed" },
          rounds: { $sum: 1 },
          prizeAnchor: { $sum: "$prizeAnchor" },
        },
      },
      // Exclude deleted/banned accounts without discarding the historic round records.
      {
        $lookup: {
          from: "users",
          let: {
            userId: { $convert: { input: "$_id", to: "objectId", onError: null, onNull: null } },
          },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", "$$userId"] },
                isBanned: { $ne: true },
              },
            },
            { $project: { _id: 1 } },
          ],
          as: "account",
        },
      },
      { $match: { "account.0": { $exists: true }, wins: { $gt: 0 } } },
      { $sort: { wins: -1, podiums: -1, prizeAnchor: -1, _id: 1 } },
      { $limit: 20 },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          characterName: 1,
          wins: 1,
          podiums: 1,
          rounds: 1,
          prizeAnchor: 1,
        },
      },
    ])
    .toArray();
}
