import { describe, it, expect, vi } from "vitest";
import {
  templatizePath,
  detectPolling,
  detectEnumeration,
  analyzeActor,
  detectAbuse,
  actorOf,
  persistApiAbuseScan,
  getLatestApiAbuseScan,
  type AccessRow,
} from "./abuseDetection";

function row(over: Partial<AccessRow> & { timestamp: Date }): AccessRow {
  return {
    path: "/api/public/v1/elections",
    method: "GET",
    ip: "203.0.113.7",
    userId: null,
    keyId: null,
    ...over,
  };
}

describe("templatizePath", () => {
  it("collapses numeric and ObjectId segments to :id", () => {
    expect(templatizePath("/api/public/v1/elections/507f1f77bcf86cd799439011")).toBe(
      "/api/public/v1/elections/:id"
    );
    expect(templatizePath("/api/public/v1/character/42/career")).toBe(
      "/api/public/v1/character/:id/career"
    );
  });

  it("leaves id-free paths untouched", () => {
    expect(templatizePath("/api/public/v1/leaderboard")).toBe("/api/public/v1/leaderboard");
  });
});

describe("actorOf", () => {
  it("prefers userId, then keyId, then ip", () => {
    expect(actorOf(row({ userId: "u1", keyId: "k1", timestamp: new Date() }))).toEqual({
      actor: "u1",
      actorType: "user",
    });
    expect(actorOf(row({ keyId: "k1", timestamp: new Date() }))).toEqual({
      actor: "k1",
      actorType: "key",
    });
    expect(actorOf(row({ ip: "1.2.3.4", timestamp: new Date() }))).toEqual({
      actor: "1.2.3.4",
      actorType: "ip",
    });
  });
});

describe("detectPolling", () => {
  it("flags a near-constant cadence above the sample floor", () => {
    const base = 1_700_000_000_000;
    const ts = Array.from({ length: 30 }, (_, i) => base + i * 5000); // every 5s, exact
    const signal = detectPolling(ts);
    expect(signal).not.toBeNull();
    expect(signal!.intervalMs).toBe(5000);
    expect(signal!.coefficientOfVariation).toBeLessThanOrEqual(0.1);
  });

  it("ignores irregular human-like cadence", () => {
    const base = 1_700_000_000_000;
    const gaps = [1000, 9000, 300, 60_000, 2000, 45_000, 800, 30_000, 5000, 120_000];
    let t = base;
    const ts = [base, ...gaps.map((g) => (t += g))];
    // pad to clear the sample floor with more irregular gaps
    for (let i = 0; i < 20; i++) ts.push((t += 1000 + Math.round(Math.random() * 50_000)));
    expect(detectPolling(ts)).toBeNull();
  });

  it("returns null below the sample floor", () => {
    expect(detectPolling([1, 2, 3])).toBeNull();
  });

  it("returns null for a simultaneous burst (zero mean interval)", () => {
    const ts = Array.from({ length: 30 }, () => 1_700_000_000_000);
    expect(detectPolling(ts)).toBeNull();
  });
});

describe("detectEnumeration", () => {
  it("flags many distinct ids under one template", () => {
    const rows = Array.from({ length: 35 }, (_, i) =>
      row({ path: `/api/public/v1/elections/${i}`, timestamp: new Date() })
    );
    const signals = detectEnumeration(rows);
    expect(signals).toHaveLength(1);
    expect(signals[0].template).toBe("/api/public/v1/elections/:id");
    expect(signals[0].distinctIds).toBe(35);
  });

  it("does not flag a handful of ids", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ path: `/api/public/v1/elections/${i}`, timestamp: new Date() })
    );
    expect(detectEnumeration(rows)).toHaveLength(0);
  });
});

describe("analyzeActor / detectAbuse", () => {
  it("returns null when nothing fires", () => {
    const rows = [row({ timestamp: new Date() })];
    expect(analyzeActor(rows)).toBeNull();
  });

  it("flags high volume", () => {
    const rows = Array.from({ length: 600 }, () => row({ timestamp: new Date() }));
    const finding = analyzeActor(rows, { highVolume: 600 });
    expect(finding).not.toBeNull();
    expect(finding!.signals.some((s) => s.type === "high_volume")).toBe(true);
  });

  it("groups by actor and sorts by request count", () => {
    const base = 1_700_000_000_000;
    const enumerator = Array.from({ length: 35 }, (_, i) =>
      row({ userId: "heavy", path: `/api/public/v1/character/${i}`, timestamp: new Date(base + i) })
    );
    const quiet = [row({ userId: "light", timestamp: new Date(base) })];
    const findings = detectAbuse([...quiet, ...enumerator]);
    expect(findings).toHaveLength(1);
    expect(findings[0].actor).toBe("heavy");
    expect(findings[0].signals.some((s) => s.type === "id_enumeration")).toBe(true);
  });
});

describe("persistence helpers", () => {
  function dbWith(accessRows: unknown[], insertOne = vi.fn()) {
    const collections: Record<string, unknown> = {
      apiAccessLog: {
        find: () => ({ project: () => ({ toArray: async () => accessRows }) }),
      },
      apiAbuseScans: { insertOne },
    };
    return { collection: (name: string) => collections[name] } as never;
  }

  it("persistApiAbuseScan writes a scan summary doc", async () => {
    const insertOne = vi.fn().mockResolvedValue({ insertedId: "s1" });
    const scan = await persistApiAbuseScan(dbWith([], insertOne));
    expect(insertOne).toHaveBeenCalledTimes(1);
    const doc = insertOne.mock.calls[0][0];
    expect(doc.detectedAt).toBeInstanceOf(Date);
    expect(doc.flaggedActors).toBe(0);
    expect(scan.findings).toEqual([]);
  });

  it("getLatestApiAbuseScan returns the most recent doc or null", async () => {
    const latestDoc = {
      detectedAt: new Date("2026-06-13T00:00:00Z"),
      windowMs: 3_600_000,
      scannedRows: 5,
      flaggedActors: 1,
      findings: [],
    };
    const db = {
      collection: () => ({
        find: () => ({ sort: () => ({ limit: () => ({ next: async () => latestDoc }) }) }),
      }),
    } as never;
    const result = await getLatestApiAbuseScan(db);
    expect(result?.flaggedActors).toBe(1);

    const emptyDb = {
      collection: () => ({
        find: () => ({ sort: () => ({ limit: () => ({ next: async () => null }) }) }),
      }),
    } as never;
    expect(await getLatestApiAbuseScan(emptyDb)).toBeNull();
  });
});
