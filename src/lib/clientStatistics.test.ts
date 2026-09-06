import { describe, expect, it } from "vitest";
import {
  REPORT_VERSION,
  RETENTION_MS,
  clientStatisticsReportSchema,
  coarseDayUtc,
  toStoredDocument,
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
