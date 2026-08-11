import { describe, expect, it } from "vitest";

describe("/api/health", () => {
  it("uses the edge runtime for lightweight deploy probes", async () => {
    const { runtime } = await import("./route");

    expect(runtime).toBe("edge");
  });

  it("returns a 200 liveness response without depending on database availability", async () => {
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      checks: { app: "ok" },
      timestamp: expect.any(String),
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-transform");
  });
});
