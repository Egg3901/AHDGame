/**
 * The index-seeder targets: one entry per index module, as plain data.
 *
 * CLIENT-SAFE ON PURPOSE. No db imports, so the Universal Seeder can render its
 * rows straight from this list instead of keeping a parallel copy. Importing
 * `seedIndexes.ts` there would drag `mongodb` into the browser bundle and break
 * `next build` — a failure neither typecheck nor vitest can see — which is why
 * the metadata lives here and only the function binding lives server-side.
 *
 * WHY THIS FILE EXISTS. The id ↔ module pairing used to be maintained by hand
 * in three places: the module array, the seed route's target list, and the
 * seeder UI. It drifted. Eight modules — ledger, crisis interactions, crises,
 * action audit log, alt detection, audit anomalies, watchlist and conflicts —
 * ran from bootstrap and full reset but had no granular target anywhere, so on
 * a world that was already running they could not be reached at all. That is
 * tolerable for a pure performance index and is not tolerable for a correctness
 * one: `conflicts` carries the unique index that keeps two conflicts from
 * sharing a public number, and `settlement` carries the unique partial index
 * that stops two live German Questions.
 *
 * Adding a module is now: add an entry here, add its runner to `INDEX_RUNNERS`
 * in `seedIndexes.ts`. The runner map is keyed by `IndexTargetId`, so leaving
 * the second step out is a COMPILE ERROR rather than a silently unreachable
 * module. Route target, dispatch, description and UI row all follow from this
 * list on their own.
 */
export interface IndexTargetMeta {
  /** Seed-route target id, and the Universal Seeder row id. */
  id: string;
  /** Universal Seeder row label. */
  label: string;
  description: string;
}

export const INDEX_TARGETS = [
  {
    id: "indexesCore",
    label: "Indexes — Core",
    description:
      "Core identity/lookup indexes (users email/username/lastActivity, characters, states, parties, corporations)",
  },
  {
    id: "indexesActivity",
    label: "Indexes — Activity Log",
    description:
      "activityLog TTL + query indexes and suspiciousCharacters indexes for admin activity tracking",
  },
  {
    id: "indexesCabinet",
    label: "Indexes — Cabinet",
    description:
      "Unified cabinetMembers + UK cabinet cooldowns/members indexes (TTL on cooldownUntil)",
  },
  {
    id: "indexesPerf",
    label: "Indexes — Performance",
    description:
      "Compound indexes on hot read paths: bills, notifications, elections, primarySnapshots, npps, playerMail",
  },
  {
    id: "indexesSlowQuery",
    label: "Indexes — Slow Query",
    description:
      "Indexes for COLLSCAN offenders (corporationHistory, commodityPriceHistory, actionLogs, statePartyElections)",
  },
  {
    id: "indexesSearch",
    label: "Indexes — Search",
    description: "Text/search indexes across the searchable collections",
  },
  {
    id: "indexesInternationalOrganizations",
    label: "Indexes — International Organizations",
    description: "UN/IMF leadership, legislation, membership, vote indexes",
  },
  {
    id: "indexesWriteGuards",
    label: "Indexes — Write Guards",
    description:
      "Partial-unique indexes blocking double-submit on election entry, endorsements, governance votes, share offers, cabinet nominations, leadership ballots, corp votes",
  },
  {
    id: "indexesPartyNppRework",
    label: "Indexes — Party / NPP rework",
    description:
      "Caucus, recruitment slate, NPP cross-pressure / endorsement, political capital, and treasury indexes",
  },
  {
    id: "indexesSovereignDefault",
    label: "Indexes — Sovereign Default",
    description:
      "Sovereign-crisis state-machine sweep indexes on federalBudget + sovereignCrisisDecisions",
  },
  {
    id: "indexesObservability",
    label: "Indexes — Observability",
    description:
      "gameHealthSnapshots, codeQualitySnapshots, siteTrafficPageviews (TTLs + query indexes)",
  },
  {
    id: "indexesFinancialTxLog",
    label: "Indexes — Financial Tx Log",
    description: "financialTxLog query indexes + TTL on expiresAt",
  },
  {
    id: "indexesLedger",
    label: "Indexes — Shadow Ledger",
    description:
      "Shadow double-entry ledger: ledgerEntries (~90d TTL), balanceSnapshots, ledgerReconciliations",
  },
  {
    id: "indexesCommodityPrices",
    label: "Indexes — Commodity Prices",
    description: "Unique index on commodityPrices.commodity",
  },
  {
    id: "indexesIndexFunds",
    label: "Indexes — Index Funds",
    description:
      "indexFunds, indexFundPositions, indexFundTransactions, indexFundRedemptionQueue, indexFundSnapshots",
  },
  {
    id: "indexesApiAccess",
    label: "Indexes — API Access",
    description:
      "Unique tokenHash + per-user/scope indexes on userApiKeys, and TTL + query indexes on apiAccessLog",
  },
  {
    id: "indexesCrisisInteractions",
    label: "Indexes — Crisis Interactions",
    description:
      "UNIQUE crisisId (one interaction document per crisis), deadline sweep, contributor guard",
  },
  {
    id: "indexesCrises",
    label: "Indexes — Crises",
    description: "crises status + autoGenerated, for the per-turn auto-disaster query",
  },
  {
    id: "indexesActionAuditLog",
    label: "Indexes — Action Audit Log",
    description:
      "actionAuditLog spine: recency, trace-following, per-actor and per-subject history, TTL cleanup",
  },
  {
    id: "indexesAltDetection",
    label: "Indexes — Alt Detection",
    description: "altLinks, altClusters, and altScoringRuns (90-day TTL on run telemetry)",
  },
  {
    id: "indexesAuditAnomalies",
    label: "Indexes — Audit Anomalies",
    description: "auditAnomalies scan-summary rollup: recency-sorted TTL index",
  },
  {
    id: "indexesWatchlist",
    label: "Indexes — Watchlist",
    description:
      "UNIQUE pin guard (an account cannot be pinned twice), pinned-by lookups, createdAt-desc listing",
  },
  {
    id: "indexesConflict",
    label: "Indexes — Conflicts",
    description:
      "UNIQUE partial index on conflicts.conflictId — the public number that resolves /world/conflicts/<n>. Two conflicts sharing a number would make one unreachable.",
  },
  {
    // AHDGame-only module. It has no target in the a-house-divided lineage this
    // feature was written against, so the port adds one — INDEX_RUNNERS is a
    // Record over IndexTargetId, which makes a missing target a compile error
    // rather than a module that silently stops being seedable.
    id: "indexesBanking",
    label: "Indexes — Banking",
    description:
      "Bank charter, deposit, lending and reserve indexes. Required before the banking console is used on a world that was never reset.",
  },
  {
    id: "indexesSettlement",
    label: "Indexes — Settlement Crisis",
    description:
      "settlementPlays drain + per-turn indexes, and the UNIQUE partial index on settlementCrises that stops two live German Questions. Required before the crisis is opened on a world that was never reset.",
  },
] as const satisfies readonly IndexTargetMeta[];

export type IndexTargetId = (typeof INDEX_TARGETS)[number]["id"];

/** Every index module's target id, for the seed route's target list. */
export const INDEX_TARGET_IDS: readonly IndexTargetId[] = INDEX_TARGETS.map((t) => t.id);
