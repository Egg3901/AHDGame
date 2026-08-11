import { describe, expect, it } from "vitest";
import { buildAutomationFlag, AUTOMATION_FLAG_TYPE } from "./automationDetection";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-06-13T05:00:00.000Z");
const params = { msPerTurn: HOUR, now };

function rows(times: string[], actionType = "attackSector") {
  return times.map((t) => ({ actionType, createdAt: new Date(t) }));
}

describe("buildAutomationFlag — no false signal", () => {
  it("returns null for an empty timeline", () => {
    expect(buildAutomationFlag([], "u", params)).toBeNull();
  });

  it("does NOT flag a rapid same-turn cluster (e.g. a ×10 batch action)", () => {
    // 10 same-type actions ~15ms apart inside ONE turn — the sanctioned batch
    // feature. With no fixed-offset cadence across consecutive turns there is no
    // signature (the rapid-fire "burst" rule was removed because it could not be
    // told apart from batch actions). See automationDetection.ts.
    const batch = rows(
      Array.from({ length: 10 }, (_, i) => new Date(100 * HOUR + 200_000 + i * 15).toISOString())
    );
    expect(buildAutomationFlag(batch, "u", params)).toBeNull();
  });
});

describe("buildAutomationFlag — cadence", () => {
  // 5 consecutive hourly actions at the same offset (:03:28) past the turn boundary.
  const fixed = rows([
    "2026-06-13T00:03:28.000Z",
    "2026-06-13T01:03:28.000Z",
    "2026-06-13T02:03:28.000Z",
    "2026-06-13T03:03:28.000Z",
    "2026-06-13T04:03:28.000Z",
  ]);

  it("flags a fixed offset over >=3 consecutive turns and reports span hours", () => {
    const flag = buildAutomationFlag(fixed, "truenozero", params);
    expect(flag).not.toBeNull();
    expect(flag!.type).toBe(AUTOMATION_FLAG_TYPE);
    expect(flag!.detail).toMatch(/Potential automation due to .* for 4 hours by truenozero/);
    expect(flag!.evidence.signature).toBe("cadence");
    expect(flag!.evidence.events).toHaveLength(5);
    expect(flag!.evidence.consecutiveTurns).toBe(5);
  });

  it("does NOT flag when a turn gap breaks the run below the minimum", () => {
    // offsets identical but turns 0,1,[gap 2],3 → longest consecutive run = 2 < 3
    const gapped = rows([
      "2026-06-13T00:03:28.000Z",
      "2026-06-13T01:03:28.000Z",
      "2026-06-13T03:03:28.000Z",
    ]);
    expect(buildAutomationFlag(gapped, "u", params)).toBeNull();
  });

  it("does NOT flag human jitter (offset varies by minutes)", () => {
    const human = rows([
      "2026-06-13T00:05:10.000Z",
      "2026-06-13T01:18:40.000Z",
      "2026-06-13T02:47:05.000Z",
      "2026-06-13T03:32:55.000Z",
    ]);
    expect(buildAutomationFlag(human, "u", params)).toBeNull();
  });

  it("flags a cross-action loop on the combined stream over consecutive turns", () => {
    const loop = [
      ...rows(
        ["2026-06-13T00:03:00.000Z", "2026-06-13T01:03:00.000Z", "2026-06-13T02:03:00.000Z"],
        "fundraise"
      ),
      ...rows(
        ["2026-06-13T00:03:05.000Z", "2026-06-13T01:03:05.000Z", "2026-06-13T02:03:05.000Z"],
        "attackSector"
      ),
    ];
    const flag = buildAutomationFlag(loop, "truenozero", params);
    expect(flag).not.toBeNull();
    expect(["cadence", "loop"]).toContain(flag!.evidence.signature);
    expect(flag!.evidence.actionTypes).toEqual(
      expect.arrayContaining(["fundraise", "attackSector"])
    );
  });
});
