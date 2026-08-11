import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { AltCluster } from "@/lib/db/types/altDetection";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockRejectedValue(new Error("no db in test")) }));
vi.mock("./featureFlag", () => ({ isAltScoringEnabled: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({ sendDiscordWebhookMultiple: vi.fn() }));

import { selectNewClusters, pruneReportedIds, formatAltDigestEmbed, runAltDigest } from "./digest";

function makeCluster(overrides: Partial<AltCluster> = {}): AltCluster {
  return {
    _id: new ObjectId(),
    memberUserIds: [new ObjectId(), new ObjectId()],
    confidence: 0.75,
    size: 2,
    signalSummary: [
      { type: "device_fingerprint_exact", count: 1, maxContribution: 0.9 },
      { type: "ip_exact_nonCF", count: 1, maxContribution: 0.3 },
    ],
    roles: { burners: [], associates: [] },
    topEvidence: ["shared fingerprint a1b2c3d4…", "shared IP 12.34.56.xxx"],
    status: "open",
    updatedAt: new Date(),
    turn: 100,
    ...overrides,
  };
}

// ─── selectNewClusters ────────────────────────────────────────────────────

describe("selectNewClusters", () => {
  it("returns empty selection when there are no open clusters", () => {
    const result = selectNewClusters([], new Set(), 0.6);
    expect(result.newClusters).toEqual([]);
    expect(result.openAboveThresholdIds).toEqual([]);
    expect(result.allOpenIds).toEqual([]);
  });

  it("filters out clusters below the confidence threshold", () => {
    const low = makeCluster({ confidence: 0.4 });
    const high = makeCluster({ confidence: 0.8 });
    const result = selectNewClusters([low, high], new Set(), 0.6);
    expect(result.newClusters.map((c) => c.id)).toEqual([high._id.toString()]);
    // Below-threshold cluster is still tracked in allOpenIds (it's open),
    // just not in openAboveThresholdIds.
    expect(result.allOpenIds).toContain(low._id.toString());
    expect(result.openAboveThresholdIds).not.toContain(low._id.toString());
  });

  it("excludes clusters already in the reported-id set (new-since-marker logic)", () => {
    const alreadyReported = makeCluster({ confidence: 0.9 });
    const fresh = makeCluster({ confidence: 0.7 });
    const reportedIds = new Set([alreadyReported._id.toString()]);
    const result = selectNewClusters([alreadyReported, fresh], reportedIds, 0.6);
    expect(result.newClusters).toHaveLength(1);
    expect(result.newClusters[0].id).toBe(fresh._id.toString());
    // Both remain part of the open/above-threshold bookkeeping sets.
    expect(result.openAboveThresholdIds).toHaveLength(2);
  });

  it("sorts new clusters by confidence descending", () => {
    const low = makeCluster({ confidence: 0.65 });
    const high = makeCluster({ confidence: 0.95 });
    const mid = makeCluster({ confidence: 0.8 });
    const result = selectNewClusters([low, high, mid], new Set(), 0.6);
    expect(result.newClusters.map((c) => c.confidence)).toEqual([0.95, 0.8, 0.65]);
  });

  it("caps topSignals at 3 (strongest contribution first) and topEvidence at 2", () => {
    const cluster = makeCluster({
      signalSummary: [
        { type: "referral_link", count: 1, maxContribution: 0.1 },
        { type: "oauth_shared", count: 1, maxContribution: 0.97 },
        { type: "device_fingerprint_exact", count: 1, maxContribution: 0.9 },
        { type: "deviceKey_exact", count: 1, maxContribution: 0.8 },
      ],
      topEvidence: ["evidence 1", "evidence 2", "evidence 3"],
    });
    const result = selectNewClusters([cluster], new Set(), 0.6);
    expect(result.newClusters[0].topSignals).toEqual([
      "oauth_shared",
      "device_fingerprint_exact",
      "deviceKey_exact",
    ]);
    expect(result.newClusters[0].topEvidence).toEqual(["evidence 1", "evidence 2"]);
  });

  it("does not double count a cluster present twice in reportedIds vs allOpenIds bookkeeping", () => {
    const cluster = makeCluster({ confidence: 0.7 });
    const result = selectNewClusters([cluster], new Set(), 0.6);
    expect(result.allOpenIds).toEqual([cluster._id.toString()]);
    expect(result.openAboveThresholdIds).toEqual([cluster._id.toString()]);
  });
});

// ─── pruneReportedIds ─────────────────────────────────────────────────────

describe("pruneReportedIds", () => {
  it("drops ids that are no longer open (dismissed/reviewed/confirmed)", () => {
    const stillOpen = new ObjectId().toString();
    const noLongerOpen = new ObjectId().toString();
    const pruned = pruneReportedIds(new Set([stillOpen, noLongerOpen]), [stillOpen]);
    expect(pruned.has(stillOpen)).toBe(true);
    expect(pruned.has(noLongerOpen)).toBe(false);
  });

  it("is a no-op when everything reported is still open", () => {
    const a = new ObjectId().toString();
    const b = new ObjectId().toString();
    const pruned = pruneReportedIds(new Set([a, b]), [a, b, new ObjectId().toString()]);
    expect(pruned).toEqual(new Set([a, b]));
  });

  it("returns an empty set given an empty reported set", () => {
    expect(pruneReportedIds(new Set(), [new ObjectId().toString()])).toEqual(new Set());
  });
});

// ─── formatAltDigestEmbed ─────────────────────────────────────────────────

describe("formatAltDigestEmbed", () => {
  it("returns null for the empty case (nothing new to report)", () => {
    expect(formatAltDigestEmbed({ newClusters: [] })).toBeNull();
  });

  it("formats a single new ring with signals and evidence", () => {
    const embed = formatAltDigestEmbed({
      newClusters: [
        {
          id: "abc",
          confidence: 0.82,
          size: 3,
          topSignals: ["device_fingerprint_exact", "ip_exact_nonCF"],
          topEvidence: ["shared fingerprint a1b2c3d4…"],
        },
      ],
    });
    expect(embed).not.toBeNull();
    expect(embed!.description).toContain("**1** new suspicious ring detected");
    expect(embed!.fields).toHaveLength(1);
    expect(embed!.fields![0].name).toContain("82% confidence");
    expect(embed!.fields![0].name).toContain("3 accounts");
    expect(embed!.fields![0].value).toContain("Signals: device_fingerprint_exact, ip_exact_nonCF");
    expect(embed!.fields![0].value).toContain("shared fingerprint a1b2c3d4…");
  });

  it("uses singular 'ring' / 'account' wording for a single-member cluster", () => {
    const embed = formatAltDigestEmbed({
      newClusters: [{ id: "a", confidence: 0.7, size: 1, topSignals: [], topEvidence: [] }],
    });
    expect(embed!.description).toContain("**1** new suspicious ring detected");
    expect(embed!.fields![0].name).toContain("1 account");
    expect(embed!.fields![0].name).not.toContain("1 accounts");
  });

  it("truncates the field list to the top N and notes the remainder", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      confidence: 0.9 - i * 0.01,
      size: 2,
      topSignals: [] as string[],
      topEvidence: [] as string[],
    }));
    const embed = formatAltDigestEmbed({ newClusters: many });
    expect(embed!.fields).toHaveLength(8);
    expect(embed!.description).toContain("Showing the top 8; 4 more not shown.");
  });

  it("includes an admin deep link when provided", () => {
    const embed = formatAltDigestEmbed(
      { newClusters: [{ id: "a", confidence: 0.7, size: 2, topSignals: [], topEvidence: [] }] },
      { adminUrl: "https://example.com/admin?tab=players&sub=alts" }
    );
    expect(embed!.description).toContain("https://example.com/admin?tab=players&sub=alts");
  });

  it("falls back to a placeholder when a ring has no signals or evidence", () => {
    const embed = formatAltDigestEmbed({
      newClusters: [{ id: "a", confidence: 0.7, size: 2, topSignals: [], topEvidence: [] }],
    });
    expect(embed!.fields![0].value).toBe("(no evidence detail)");
  });
});

// ─── runAltDigest (integration, mocked db) ────────────────────────────────

describe("runAltDigest", () => {
  let db: MockDb;

  beforeEach(async () => {
    // `resetAllMocks` (not `clearAllMocks`): several tests install a
    // `mockResolvedValue`/`mockRejectedValue` on the shared
    // `sendDiscordWebhookMultiple` mock — `clearAllMocks` only resets call
    // history, so a rejection installed in one test would otherwise leak
    // into the next test's default (resolved) expectation.
    vi.resetAllMocks();
    db = createMockDb();
    db.collection("altClusters");
    db.collection("altDigestState");
    db.collection("gameConfig");
  });

  it("is a no-op and returns enabled:false when alt scoring is disabled", async () => {
    const { isAltScoringEnabled } = await import("./featureFlag");
    vi.mocked(isAltScoringEnabled).mockResolvedValue(false);

    const result = await runAltDigest(db as unknown as Db);
    expect(result.enabled).toBe(false);
    expect(result.newClusterCount).toBe(0);
    expect(db.collectionMocks.altClusters.find).not.toHaveBeenCalled();
  });

  it("reports the empty case without posting when there are no new clusters", async () => {
    const { isAltScoringEnabled } = await import("./featureFlag");
    vi.mocked(isAltScoringEnabled).mockResolvedValue(true);
    db.collectionMocks.altClusters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.altDigestState.findOne.mockResolvedValue(null);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);

    const { sendDiscordWebhookMultiple } = await import("@/lib/discordWebhooks");

    const result = await runAltDigest(db as unknown as Db);
    expect(result.enabled).toBe(true);
    expect(result.newClusterCount).toBe(0);
    expect(result.posted).toBe(false);
    expect(sendDiscordWebhookMultiple).not.toHaveBeenCalled();
    expect(db.collectionMocks.altDigestState.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({ $set: expect.objectContaining({ reportedClusterIds: [] }) }),
      { upsert: true }
    );
  });

  it("posts to Discord and advances the marker when a webhook is configured", async () => {
    vi.stubEnv("DISCORD_ALT_DIGEST_WEBHOOK_URL", "https://discord.example/webhook");
    const { isAltScoringEnabled } = await import("./featureFlag");
    vi.mocked(isAltScoringEnabled).mockResolvedValue(true);

    const cluster = makeCluster({ confidence: 0.9 });
    db.collectionMocks.altClusters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([cluster]),
    });
    db.collectionMocks.altDigestState.findOne.mockResolvedValue(null);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);

    const { sendDiscordWebhookMultiple } = await import("@/lib/discordWebhooks");
    vi.mocked(sendDiscordWebhookMultiple).mockResolvedValue(undefined);

    const result = await runAltDigest(db as unknown as Db);
    expect(result.posted).toBe(true);
    expect(result.newClusterCount).toBe(1);
    expect(sendDiscordWebhookMultiple).toHaveBeenCalledWith(
      "https://discord.example/webhook",
      expect.any(Array)
    );
    expect(db.collectionMocks.altDigestState.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({
        $set: expect.objectContaining({ reportedClusterIds: [cluster._id.toString()] }),
      }),
      { upsert: true }
    );
    vi.unstubAllEnvs();
  });

  it("logs a no-op and still advances the marker when no webhook is configured", async () => {
    vi.stubEnv("DISCORD_ALT_DIGEST_WEBHOOK_URL", "");
    const { isAltScoringEnabled } = await import("./featureFlag");
    vi.mocked(isAltScoringEnabled).mockResolvedValue(true);

    const cluster = makeCluster({ confidence: 0.9 });
    db.collectionMocks.altClusters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([cluster]),
    });
    db.collectionMocks.altDigestState.findOne.mockResolvedValue(null);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);

    const { sendDiscordWebhookMultiple } = await import("@/lib/discordWebhooks");

    const result = await runAltDigest(db as unknown as Db);
    expect(result.webhookConfigured).toBe(false);
    expect(result.posted).toBe(false);
    expect(result.newClusterCount).toBe(1);
    expect(sendDiscordWebhookMultiple).not.toHaveBeenCalled();
    // Marker still advances — the cluster was "reported" via the log path.
    expect(db.collectionMocks.altDigestState.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({
        $set: expect.objectContaining({ reportedClusterIds: [cluster._id.toString()] }),
      }),
      { upsert: true }
    );
    vi.unstubAllEnvs();
  });

  it("does not re-report a cluster already present in the persisted reportedClusterIds", async () => {
    vi.stubEnv("DISCORD_ALT_DIGEST_WEBHOOK_URL", "https://discord.example/webhook");
    const { isAltScoringEnabled } = await import("./featureFlag");
    vi.mocked(isAltScoringEnabled).mockResolvedValue(true);

    const cluster = makeCluster({ confidence: 0.9 });
    db.collectionMocks.altClusters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([cluster]),
    });
    db.collectionMocks.altDigestState.findOne.mockResolvedValue({
      _id: "default",
      reportedClusterIds: [cluster._id.toString()],
    });
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);

    const { sendDiscordWebhookMultiple } = await import("@/lib/discordWebhooks");

    const result = await runAltDigest(db as unknown as Db);
    expect(result.newClusterCount).toBe(0);
    expect(result.posted).toBe(false);
    expect(sendDiscordWebhookMultiple).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("does not advance the marker when the Discord POST fails (retry next run)", async () => {
    vi.stubEnv("DISCORD_ALT_DIGEST_WEBHOOK_URL", "https://discord.example/webhook");
    const { isAltScoringEnabled } = await import("./featureFlag");
    vi.mocked(isAltScoringEnabled).mockResolvedValue(true);

    const cluster = makeCluster({ confidence: 0.9 });
    db.collectionMocks.altClusters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([cluster]),
    });
    db.collectionMocks.altDigestState.findOne.mockResolvedValue(null);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);

    const { sendDiscordWebhookMultiple } = await import("@/lib/discordWebhooks");
    vi.mocked(sendDiscordWebhookMultiple).mockRejectedValue(
      new Error("Discord webhook failed: 500")
    );

    const result = await runAltDigest(db as unknown as Db);
    expect(result.posted).toBe(false);
    expect(result.error).toContain("Discord webhook failed");
    // The success-path updateOne (with reportedClusterIds) must not have
    // fired; only the failure-bookkeeping updateOne (lastError) is allowed.
    const calls = db.collectionMocks.altDigestState.updateOne.mock.calls;
    for (const call of calls) {
      expect(call[1].$set.reportedClusterIds).toBeUndefined();
    }
    expect(db.collectionMocks.altDigestState.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({ $set: expect.objectContaining({ lastError: expect.any(String) }) }),
      { upsert: true }
    );
    vi.unstubAllEnvs();
  });

  it("applies a stored altScoring.thresholds.cluster override when selecting new clusters", async () => {
    vi.stubEnv("DISCORD_ALT_DIGEST_WEBHOOK_URL", "https://discord.example/webhook");
    const { isAltScoringEnabled } = await import("./featureFlag");
    vi.mocked(isAltScoringEnabled).mockResolvedValue(true);

    // Below the default 0.6 cluster threshold, but above a stored 0.4 override.
    const cluster = makeCluster({ confidence: 0.5 });
    db.collectionMocks.altClusters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([cluster]),
    });
    db.collectionMocks.altDigestState.findOne.mockResolvedValue(null);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      altScoring: { thresholds: { cluster: 0.4 } },
    });

    const result = await runAltDigest(db as unknown as Db);
    expect(result.newClusterCount).toBe(1);
    vi.unstubAllEnvs();
  });
});
