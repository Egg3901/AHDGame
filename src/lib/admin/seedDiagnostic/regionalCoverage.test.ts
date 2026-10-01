import { describe, expect, it } from "vitest";
import { regionalMetricCoverage } from "./regionalCoverage";

describe("regional metric identity coverage", () => {
  it.each([
    ["UK", "uk_national"],
    ["JP", "jp_national"],
    ["DE", "de_national"],
    ["BR", "br_national"],
    ["IE", "ie_national"],
    ["CN", "cn_national"],
    ["NG", "ng_national"],
  ])("accepts %s regions plus their valid national summary", (country, summary) => {
    const result = regionalMetricCoverage(country, ["r1", "r2"], ["r1", summary, "r2"]);
    expect(result).toMatchObject({ severity: "ok", expected: 2, actual: 2 });
  });

  it("reports both the missing and orphan region when total counts match", () => {
    const result = regionalMetricCoverage("UK", ["r1", "r2"], ["r1", "outdated"]);
    expect(result).toMatchObject({ severity: "warn", expected: 2, actual: 1 });
    expect(result.note).toContain("missing: r2");
    expect(result.note).toContain("orphan: outdated");
  });

  it("does not ignore another country's summary or an invented national id", () => {
    const result = regionalMetricCoverage("UK", ["r1"], ["r1", "jp_national", "fake_national"]);
    expect(result.severity).toBe("warn");
    expect(result.note).toContain("orphan: fake_national, jp_national");
  });

  it("reports duplicate identities even with complete regional coverage", () => {
    const result = regionalMetricCoverage("UK", ["r1", "r2"], ["r1", "r2", "r2"]);
    expect(result.severity).toBe("warn");
    expect(result.note).toContain("duplicates: r2");
  });

  it("treats national-only rows as missing regional substrate", () => {
    const result = regionalMetricCoverage("UK", ["r1", "r2"], ["uk_national"]);
    expect(result).toMatchObject({ severity: "critical", actual: 0 });
    expect(result.note).toContain("missing: r1, r2");
  });
});
