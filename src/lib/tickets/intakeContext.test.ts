import { describe, expect, it } from "vitest";
import {
  sanitizeSupportPath,
  classifySupportRuntime,
  recentSupportVisits,
  buildIntakeQuestions,
  type TicketVisit,
} from "./intakeContext";
const now = new Date("2026-01-02T12:00:00Z");
const visit = (path: string, extra: Partial<TicketVisit> = {}): TicketVisit => ({
  path,
  recordedAt: now,
  platform: "android",
  device: "mobile",
  gameVersion: "1.2.3",
  ...extra,
});
describe("ticket intake context", () => {
  it("strips private query values and rejects sensitive or external paths", () => {
    expect(sanitizeSupportPath("/market?token=private#secret")).toBe("/market");
    for (const path of [
      "//evil.test/x",
      "/account/password",
      "/admin/users",
      "/auth/callback",
      "/a/../b",
      "/%61dmin",
      "/a\\b",
    ])
      expect(sanitizeSupportPath(path)).toBeNull();
  });
  it("projects broad device labels and only the known client version token", () => {
    expect(classifySupportRuntime("Mozilla Android Mobile AHDClient-Mobile/1.4.2")).toEqual({
      platform: "android",
      device: "mobile",
      clientVersion: "1.4.2",
    });
    expect(classifySupportRuntime("Mozilla Macintosh Mobile/15 Safari").platform).toBe("ios");
    expect(classifySupportRuntime(null)).toEqual({ platform: "unknown", device: "unknown" });
  });
  it("bounds, deduplicates and excludes stale visits and non-allowlisted fields", () => {
    const result = recentSupportVisits(
      [
        visit("/market?secret=x"),
        visit("/market"),
        visit("/admin"),
        visit("/news", { recordedAt: new Date("2025-01-01") }),
        ...Array.from({ length: 8 }, (_, i) => visit(`/country/us/bill/${i}`)),
      ],
      now
    );
    expect(result).toHaveLength(5);
    expect(result[0].path).toBe("/market");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("asks every reporter to confirm platform and never claims unknown versions", () => {
    expect(buildIntakeQuestions("moderation", [], false)).toHaveLength(1);
    expect(
      buildIntakeQuestions("market button", [visit("/news"), visit("/market")], true)[0]
    ).toContain("https://ahousedividedgame.com/market>");
    expect(buildIntakeQuestions("market", [visit("/market")], true)[1]).toContain(
      "client version unknown"
    );
  });
});
