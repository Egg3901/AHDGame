import { describe, it, expect } from "vitest";
import { formatStableUtc, formatRelative } from "./localTime";

describe("formatStableUtc", () => {
  it("formats to the UTC calendar day regardless of host timezone", () => {
    // 00:30 UTC on Jun 3 is still Jun 2 in US timezones; pinning UTC keeps it Jun 3,
    // so server and client always agree on the rendered text.
    expect(
      formatStableUtc("2026-06-03T00:30:00.000Z", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    ).toBe("Jun 3, 2026");
  });

  it("is deterministic for a fixed instant (date + time, UTC)", () => {
    expect(
      formatStableUtc("2026-06-02T16:52:20.000Z", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    ).toBe("Jun 2, 2026, 4:52 PM");
  });

  it("accepts Date and epoch-millis inputs", () => {
    const iso = "2026-01-15T12:00:00.000Z";
    const opts = { year: "numeric", month: "short", day: "numeric" } as const;
    const fromString = formatStableUtc(iso, opts);
    expect(formatStableUtc(new Date(iso), opts)).toBe(fromString);
    expect(formatStableUtc(Date.parse(iso), opts)).toBe(fromString);
  });
});

describe("formatRelative", () => {
  const base = Date.parse("2026-06-10T12:00:00.000Z");
  const ago = (ms: number) => new Date(base - ms);
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("returns 'just now' under a minute", () => {
    expect(formatRelative(ago(30 * SEC), base)).toBe("just now");
  });

  it("returns minutes within the hour", () => {
    expect(formatRelative(ago(5 * MIN), base)).toBe("5m ago");
  });

  it("returns hours within the day", () => {
    expect(formatRelative(ago(3 * HOUR), base)).toBe("3h ago");
  });

  it("returns days within the week", () => {
    expect(formatRelative(ago(2 * DAY), base)).toBe("2d ago");
  });

  it("falls back to an absolute UTC date at seven days or more", () => {
    expect(formatRelative(ago(10 * DAY), base)).toBe("May 31, 2026");
  });
});
