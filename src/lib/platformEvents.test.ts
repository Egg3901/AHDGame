import { describe, expect, it, vi } from "vitest";
import { publishPlatformEvent } from "./platformEvents";

const event = {
  type: "turn:completed" as const,
  source: "ahd" as const,
  id: "ahd:turn:42:completed",
  occurredAt: "2026-09-22T00:00:00.000Z",
  payload: { turn: 42 },
};

describe("publishPlatformEvent", () => {
  it("is disabled without explicit URL and token", async () => {
    const fetchImpl = vi.fn();
    expect(await publishPlatformEvent(event, { fetchImpl, url: "", token: "" })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries and preserves the caller when delivery fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    expect(
      await publishPlatformEvent(event, {
        fetchImpl,
        url: "https://ops.test/api/platform-events",
        token: "secret",
        attempts: 3,
      })
    ).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after delivery", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    expect(
      await publishPlatformEvent(event, {
        fetchImpl,
        url: "https://ops.test/api/platform-events",
        token: "secret",
      })
    ).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
