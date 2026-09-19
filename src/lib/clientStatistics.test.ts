import { describe, expect, it } from "vitest";
import {
  METRIC_DEFINITION_VERSION,
  REPORT_VERSION,
  RETENTION_MS,
  clientStatisticsReportSchema,
  coarseDayUtc,
  hashFeatureFlags,
  toStoredDocument,
  turnBucket,
} from "./clientStatistics";

function validReport() {
  return {
    version: REPORT_VERSION,
    createdAt: "2026-09-06T12:34:56.000Z",
    appMajorVersion: 2,
    setup: {
      era: "2019",
      mode: "normal",
      difficulty: "normal",
      autonomy: "v1",
      featureFlags: {
        forexEnabled: true,
        rpgStatsEnabled: false,
        onboardingChecklistEnabled: true,
      },
    },
    metrics: {
      partyCount: 12,
      gdpTotal: 1e12,
      gdpGrowthPercent: 2.5,
      populationGrowthPercent: 0.8,
      governmentApprovalPercent: 51,
      electionCountActive: 3,
      governmentFormationCount: 2,
      legislativeSeatTotal: 435,
      executiveControlSharePercent: 80,
      revenueBySector: { energy: 5e9 },
      minStability: 10,
      maxStability: 90,
    },
    turn: 42,
  };
}

describe("clientStatisticsReportSchema", () => {
  it("accepts a fully allowlisted report", () => {
    expect(clientStatisticsReportSchema.safeParse(validReport()).success).toBe(true);
  });

  it("accepts minimal metrics and null turn", () => {
    const report = {
      ...validReport(),
      metrics: {},
      turn: null,
      appMajorVersion: null,
      setup: { ...validReport().setup, featureFlags: {} },
    };
    expect(clientStatisticsReportSchema.safeParse(report).success).toBe(true);
  });

  it("accepts every allowlisted era, mode, difficulty, and autonomy value", () => {
    const base = validReport();
    for (const era of ["1953", "1979", "1991", "1999", "2007", "2019", "2023"]) {
      const parsed = clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, era },
      });
      expect(parsed.success).toBe(true);
    }
    for (const mode of ["normal", "head-of-state", "worldsim"]) {
      const parsed = clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, mode },
      });
      expect(parsed.success).toBe(true);
    }
    for (const difficulty of ["easy", "normal", "hard"]) {
      const parsed = clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, difficulty },
      });
      expect(parsed.success).toBe(true);
    }
    for (const autonomy of ["off", "v0", "v1", "v2", "v3", "v4", "v5"]) {
      const parsed = clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, autonomy },
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("accepts optional appRelease and metricDefinitionVersion", () => {
    const parsed = clientStatisticsReportSchema.safeParse({
      ...validReport(),
      appRelease: "2.3.19",
      metricDefinitionVersion: METRIC_DEFINITION_VERSION,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects git revisions, free text, and overlong appRelease values", () => {
    const base = validReport();
    expect(
      clientStatisticsReportSchema.safeParse({ ...base, appRelease: "deadbeefdeadbeef" }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({ ...base, appRelease: "2.3.19-dirty" }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({ ...base, metricDefinitionVersion: 0 }).success
    ).toBe(false);
  });

  it("rejects unknown top-level keys such as account ids", () => {
    const parsed = clientStatisticsReportSchema.safeParse({
      ...validReport(),
      accountId: "507f1f77bcf86cd799439011",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects identifier keys smuggled into setup or metrics", () => {
    const base = validReport();
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, displayName: "Ada" },
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        metrics: { ...base.metrics, countryName: "Freedonia" },
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        metrics: { ...base.metrics, partyName: "Labour" },
      }).success
    ).toBe(false);
  });

  it("rejects free text, git revisions, and unknown provenance keys", () => {
    const base = validReport();
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        appRelease: "2.3.19-deadbeef",
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        appRelease: "c4510c3f",
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        codeRevision: "c4510c3fabc",
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        appRelease: "2.3.19",
        metricDefinitionVersion: METRIC_DEFINITION_VERSION,
      }).success
    ).toBe(true);
  });

  it("rejects feature flags outside the game allowlist", () => {
    const base = validReport();
    const parsed = clientStatisticsReportSchema.safeParse({
      ...base,
      setup: {
        ...base.setup,
        featureFlags: { forexEnabled: true, customFlag: true },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects sector keys outside the game sector types", () => {
    const base = validReport();
    const parsed = clientStatisticsReportSchema.safeParse({
      ...base,
      metrics: { revenueBySector: { notASector: 100 } },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects out-of-range numerics and inverted stability bounds", () => {
    const base = validReport();
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        metrics: { unemploymentRatePercent: 101 },
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        metrics: { minStability: 80, maxStability: 20 },
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        metrics: { partyCount: 1.5 },
      }).success
    ).toBe(false);
  });

  it("rejects non-finite numerics", () => {
    const base = validReport();
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        metrics: { gdpTotal: Number.NaN },
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        metrics: { gdpTotal: Number.POSITIVE_INFINITY },
      }).success
    ).toBe(false);
  });

  it("rejects wrong versions and non-allowlisted setup tokens", () => {
    const base = validReport();
    expect(clientStatisticsReportSchema.safeParse({ ...base, version: 2 }).success).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, era: "2030" },
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, difficulty: "brutal" },
      }).success
    ).toBe(false);
    expect(
      clientStatisticsReportSchema.safeParse({
        ...base,
        setup: { ...base.setup, mode: "sandbox" },
      }).success
    ).toBe(false);
  });
});

describe("toStoredDocument", () => {
  it("normalizes createdAt to the coarse UTC day and sets a 30-day expiry", () => {
    const parsed = clientStatisticsReportSchema.safeParse(validReport());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const doc = toStoredDocument(parsed.data, Date.parse("2026-09-06T12:34:56.000Z"));
    expect(doc.createdAt).toEqual(new Date("2026-09-06T00:00:00.000Z"));
    expect(doc.expiresAt.getTime() - doc.createdAt.getTime()).toBe(RETENTION_MS);
    expect(doc.version).toBe(REPORT_VERSION);
    expect(doc.turn).toBe(42);
    expect(Object.keys(doc).sort()).toEqual(
      ["appMajorVersion", "createdAt", "expiresAt", "metrics", "setup", "turn", "version"].sort()
    );
  });

  it("discards the client timestamp instead of storing it", () => {
    const parsed = clientStatisticsReportSchema.safeParse({
      ...validReport(),
      createdAt: "2020-01-15T08:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const doc = toStoredDocument(parsed.data, Date.parse("2026-09-06T12:34:56.000Z"));
    expect(doc.createdAt).toEqual(new Date("2026-09-06T00:00:00.000Z"));
  });
});

describe("coarseDayUtc", () => {
  it("truncates to UTC midnight", () => {
    expect(coarseDayUtc(Date.parse("2026-09-06T23:59:59.999Z"))).toEqual(
      new Date("2026-09-06T00:00:00.000Z")
    );
  });
});

describe("turnBucket", () => {
  it("maps turns into bounded inclusive buckets", () => {
    expect(turnBucket(0)).toBe("0-11");
    expect(turnBucket(11)).toBe("0-11");
    expect(turnBucket(12)).toBe("12-47");
    expect(turnBucket(47)).toBe("12-47");
    expect(turnBucket(48)).toBe("48-95");
    expect(turnBucket(95)).toBe("48-95");
    expect(turnBucket(96)).toBe("96-239");
    expect(turnBucket(239)).toBe("96-239");
    expect(turnBucket(240)).toBe("240+");
    expect(turnBucket(null)).toBe("unknown");
    expect(turnBucket(-1)).toBe("unknown");
  });
});

describe("hashFeatureFlags", () => {
  it("is stable for the same allowlisted flags regardless of insertion order", () => {
    const a = hashFeatureFlags({ rpgStatsEnabled: false, forexEnabled: true });
    const b = hashFeatureFlags({ forexEnabled: true, rpgStatsEnabled: false });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when an allowlisted flag value changes", () => {
    const on = hashFeatureFlags({ forexEnabled: true });
    const off = hashFeatureFlags({ forexEnabled: false });
    expect(on).not.toBe(off);
  });

  it("hashes missing or empty maps as none so they do not mix with flagged reports", () => {
    expect(hashFeatureFlags(undefined)).toBe("none");
    expect(hashFeatureFlags({})).toBe("none");
    expect(hashFeatureFlags({ forexEnabled: true })).not.toBe("none");
  });

  it("ignores unknown flag names instead of hashing them", () => {
    const allowlisted = hashFeatureFlags({ forexEnabled: true });
    const smuggled = hashFeatureFlags({
      forexEnabled: true,
      customPlayerFlag: true,
    } as Record<string, boolean>);
    expect(smuggled).toBe(allowlisted);
  });
});

describe("toStoredDocument optional provenance", () => {
  it("stores bounded appRelease and metricDefinitionVersion when present", () => {
    const parsed = clientStatisticsReportSchema.safeParse({
      ...validReport(),
      appRelease: "2.3.19",
      metricDefinitionVersion: 2,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const doc = toStoredDocument(parsed.data, Date.parse("2026-09-06T12:34:56.000Z"));
    expect(doc.appRelease).toBe("2.3.19");
    expect(doc.metricDefinitionVersion).toBe(2);
    expect(doc.expiresAt.getTime() - doc.createdAt.getTime()).toBe(RETENTION_MS);
  });
});
