import type { CollectionEntry } from "./seedManifestTypes";

// ─── Preserved collections ───────────────────────────────────────────────────
// Survive reset by default. Some (users, characters) have an opt-in "full
// reset" mode that nukes them; that path is documented in resetGameWorld.

export const PRESERVED: CollectionEntry[] = [
  {
    name: "unifiedSessions",
    category: "preserved",
    notes:
      "Durable unified identity sessions and revocation state. Account security data must survive game-world resets.",
  },
  {
    name: "unifiedOidcFlows",
    category: "preserved",
    notes:
      "Short-lived PKCE login transactions expire through a TTL index and remain independent of game-world resets.",
  },
  {
    name: "nativePushDevices",
    category: "preserved",
    notes:
      "Account-bound native push registrations and delivery cursors. Device credentials, never seed data. Expire after 30 days without renewal.",
  },
  {
    name: "clientDiagnostics",
    category: "preserved",
    notes:
      "Opt-in redacted desktop failure reports expire through a 30-day TTL index, independently of world resets.",
  },
  {
    name: "clientSimulationStatistics",
    category: "preserved",
    notes:
      "Anonymous desktop run aggregates expire through a 30-day TTL index, independently of world resets.",
  },
  {
    name: "users",
    category: "preserved",
    notes:
      "Every account survives a soft reset. A full reset (deleteProfiles: true) deletes player accounts but keeps staff (isAdmin, role admin or moderator) and banned accounts: the ban, its reason, mod notes and the identity signals on a banned row are what stop the same person registering again.",
  },
  {
    name: "characters",
    category: "preserved",
    notes:
      "Soft reset retires every character (preserving history). Full reset (deleteProfiles: true) deletes the documents.",
  },
  { name: "retiredCharacters", category: "preserved" },
  { name: "characterAchievements", category: "preserved" },
  {
    name: "imperialCharacters",
    category: "preserved",
    notes:
      "Heads-of-state for monarchies (e.g. JP Emperor). Reset clears the user-side activeImperialCharacterId pointer but leaves the imperial-character documents in place so they survive across worlds.",
  },
  {
    name: "adminLogs",
    category: "preserved",
    notes: "Audit trail. Reset writes a new game_reset entry but never wipes the collection.",
  },
  {
    name: "migrations",
    category: "preserved",
    notes: "Registry of which deploy migrations have run. MUST NOT be reset.",
  },
  { name: "bannedIps", category: "preserved" },
  { name: "botApiKeys", category: "preserved" },
  { name: "botApiRequestLog", category: "preserved" },
  { name: "userApiKeys", category: "preserved" },
  { name: "discordBotFunds", category: "preserved" },
  { name: "userSubscriptions", category: "preserved", notes: "Patreon tier records." },
  {
    name: "patreonReconcileUnmatched",
    category: "preserved",
    notes:
      "Pseudonymous unmatched-account fingerprints, retry counts, and resolution history. Preserve this account-linked support audit across world resets.",
  },
  {
    name: "patreonReconcileRuns",
    category: "preserved",
    notes:
      "PII-free Patreon reconciliation run counts and failure status. Operational audit history is independent of the current game world.",
  },
  { name: "feedback", category: "preserved" },
  {
    name: "tickets",
    category: "preserved",
    notes:
      "Discord-bot support tickets (triage pipeline). Community/support content — must survive resets like feedback/suggestions.",
  },
  { name: "modAuditLog", category: "preserved" },
  {
    name: "partyMembershipEvents",
    category: "preserved",
    notes: "Append-only party join/leave/purge audit trail for moderation investigations.",
  },
  { name: "comments", category: "preserved" },
  { name: "suggestions", category: "preserved" },
  { name: "suggestionComments", category: "preserved" },
  { name: "suggestionReactions", category: "preserved" },
  { name: "suggestionReads", category: "preserved" },
  { name: "suspiciousCharacters", category: "preserved", notes: "Mod tooling state." },
  {
    name: "wikiReports",
    category: "preserved",
    notes: "Player-filed wiki page issue reports; feedback, survives world resets.",
  },
  { name: "systemSettings", category: "preserved" },
  { name: "systemTags", category: "preserved" },
  { name: "tasks", category: "preserved", notes: "Admin task tracker." },
  { name: "taskComments", category: "preserved" },
  { name: "taskLessons", category: "preserved" },
  { name: "roadmapCategories", category: "preserved" },
  { name: "roadmapItems", category: "preserved" },
  { name: "wikiPages", category: "preserved" },
  { name: "wikiTemplates", category: "preserved" },
  { name: "changelogSentHistory", category: "preserved" },
  { name: "remediations", category: "preserved", notes: "Incident-script registry." },

  // ── 2026-06 backfill: infra / audit / admin-config that must survive reset ──
  { name: "apiAccessLog", category: "preserved", notes: "API access audit log." },
  { name: "apiAbuseScans", category: "preserved", notes: "API-abuse detection audit." },
  { name: "rateLimitBuckets", category: "preserved", notes: "Rate-limit infra." },
  {
    name: "cronLocks",
    category: "preserved",
    notes:
      "Scheduled-job leases are operational concurrency guards, not world state. Preserve an active lease across reset so another reconciliation cannot overlap it; expired leases are replaced on acquisition.",
  },
  { name: "ipGeoCache", category: "preserved", notes: "IP-geo lookup cache." },
  { name: "playerBannerAds", category: "preserved", notes: "Banner-ad infra/content." },
  {
    name: "manualOfficeHistory",
    category: "preserved",
    notes: "Wiki/community-authored office history.",
  },
  {
    name: "migrationsRun",
    category: "preserved",
    notes: "Migration-run registry (twin of `migrations`). MUST NOT be reset.",
  },
  {
    name: "demographicConfigOverrides",
    category: "preserved",
    notes:
      "Admin-authored era/position overrides (written by the position editor, consumed by the seed pipeline). Persists across resets as authored config.",
  },

  // ── 2026-07 backfill: moderation / audit surfaces that must survive reset ──
  {
    name: "altLinks",
    category: "preserved",
    notes: "Alt-account link evidence. Moderation history — must outlive a world reset.",
  },
  {
    name: "altClusters",
    category: "preserved",
    notes: "Alt-account clusters derived from altLinks. Moderation history.",
  },
  {
    name: "altDigestState",
    category: "preserved",
    notes: "Alt-detection digest cursor/state. Resetting it would replay old alerts.",
  },
  {
    name: "identityObservations",
    category: "preserved",
    notes:
      "Per-value IP and fingerprint observation runs behind the Players panel's rotation history and historical duplicate grouping. Moderation evidence, like altLinks — an account that rotated an address to evade detection must not have that trail cleared by a world reset. Registered explicitly rather than left out of the manifest: omission happens to keep it out of the reset sweep today, but the sweep is driven by this list, so an unlisted collection is one nobody can reason about. Self-limiting regardless, via a 90-day TTL on lastSeen.",
  },
  {
    name: "altScoringRuns",
    category: "preserved",
    notes:
      "Per-run alt-scoring telemetry (candidate volume, confidence distribution, per-signal firing trends). Staff operational history, not world state — its whole value is the longitudinal trend that shows a signal going silent, so a world reset must not erase it. Self-bounding via a 90-day TTL index.",
  },
  {
    name: "actionAuditLog",
    category: "preserved",
    notes: "Append-only player-action audit trail consumed by alt detection.",
  },
  {
    name: "auditAnomalies",
    category: "preserved",
    notes: "Forensic anomaly findings. Audit trail.",
  },
  {
    name: "watchlist",
    category: "preserved",
    notes: "Admin watchlist entries. Admin metadata.",
  },
  {
    name: "supporterRequests",
    category: "preserved",
    notes: "Player supporter/perk requests. User-linked community content.",
  },
  {
    name: "simRuns",
    category: "preserved",
    notes:
      "Offline election-balance sim harness run records (src/lib/sim). Analysis artifact, not gameplay state — never needed for a fresh game.",
  },

  // ── 2026-10 backfill: cross-game data the runtime sweep was dropping ──
  {
    name: "playerMailReports",
    category: "preserved",
    notes:
      "Moderation queue for reported mail. A pending report must not vanish unreviewed on reset. Each row snapshots the reported message, since playerMail itself is world state.",
  },
  {
    name: "playerContentReports",
    category: "preserved",
    notes:
      "Moderation queue for reported names, bios, portraits and articles. Rows snapshot the character name and key on the account, so they outlive the world they were filed in.",
  },
  {
    name: "politicianOverrides",
    category: "preserved",
    notes:
      "Wiki politician pages: admin-written bios and sections plus the election history appended as races resolve. Keyed by character id, so a new world's characters never collide with a retired one's page.",
  },
  {
    name: "eventDefinitions",
    category: "preserved",
    notes:
      "Random-event templates and their admin approval status. Bootstrap does not reseed them, and seedPreeEventDefinitions never overwrites status, so wiping them emptied /wiki/random-events and stopped random events until an admin reseeded and re-approved. Cooldowns and fired instances are world state and live in eventCooldownLedger and eventInstances.",
  },
  {
    name: "siteTrafficPageviews",
    category: "preserved",
    notes:
      "First-party site analytics keyed by the visitor cookie, not by world. Self-limiting via its own ~180-day TTL.",
  },
  {
    name: "codeQualitySnapshots",
    category: "preserved",
    notes: "Build-time code quality history for the admin dashboard. Not world state.",
  },
  {
    name: "officeHistoryArchive",
    category: "preserved",
    notes:
      "Wiki office tenures from finished worlds. resetGameWorld writes each generated office page's tenure list here before the sweep drops the office tables it is computed from; the office pages read it back as earlier iterations.",
  },
  // 2026-10 backfill: account, operations and security state
  {
    name: "authSourceOwnershipProofs",
    category: "preserved",
    notes: "Account ownership evidence survives world resets.",
  },
  {
    name: "broadcastDms",
    category: "preserved",
    notes: "Operator broadcast delivery receipts are cross-world accountability records.",
  },
  {
    name: "healBackups",
    category: "preserved",
    notes: "Remediation backup archive is operational data.",
  },
  {
    name: "healRuns",
    category: "preserved",
    notes: "Remediation execution history is operational data.",
  },
  {
    name: "healTokens",
    category: "preserved",
    notes: "Remediation authorization state has its own lifecycle.",
  },
  {
    name: "emailChanges",
    category: "preserved",
    notes: "Pending account email confirmations are independent of a game world.",
  },
  {
    name: "passwordResets",
    category: "preserved",
    notes: "Account recovery records are independent of a game world.",
  },
  {
    name: "sourceFenceConsumptions",
    category: "preserved",
    notes: "Security replay-consumption state survives world resets.",
  },
  {
    name: "sourceFenceReceipts",
    category: "preserved",
    notes: "Security receipts survive world resets.",
  },
];
