import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn((_url?: unknown, _opts?: unknown) => Promise.resolve());

vi.stubGlobal("fetch", fetchMock);

import { alertOps } from "./alertOps";

describe("observability/alertOps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISCORD_ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
  });

  afterEach(() => {
    delete process.env.DISCORD_ALERT_WEBHOOK_URL;
  });

  it("sends a Discord webhook for fatal errors", () => {
    const err = new Error("Database exploded");
    alertOps(err, { level: "fatal", tags: { component: "turn" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    const opts = call[1] as { method: string; body: string };
    expect(url).toBe("https://discord.com/api/webhooks/test");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.embeds[0].title).toBe("🚨 Fatal Error");
    expect(body.embeds[0].description).toContain("Database exploded");
    expect(body.embeds[0].fields[0].value).toContain("component=turn");
  });

  it("does not send for non-fatal errors", () => {
    alertOps(new Error("mild issue"), { level: "error" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send when webhook URL is not configured", () => {
    delete process.env.DISCORD_ALERT_WEBHOOK_URL;
    alertOps(new Error("boom"), { level: "fatal" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows fetch failures silently", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    alertOps(new Error("fatal thing"), { level: "fatal" });
    // Should not throw — just silently fail
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Wait for the promise to settle
    await new Promise((r) => setTimeout(r, 0));
  });

  it("truncates long error messages", () => {
    const longMsg = "x".repeat(5000);
    alertOps(new Error(longMsg), { level: "fatal" });
    const call2 = fetchMock.mock.calls[0] as unknown[];
    const opts2 = call2[1] as { body: string };
    const body = JSON.parse(opts2.body);
    expect(body.embeds[0].description.length).toBeLessThan(2000);
  });
});
