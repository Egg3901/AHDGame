import { describe, expect, it, vi } from "vitest";
import { ENDPOINTS } from "../src/lib/publicApi/catalog";
import { callPublicApi, endpointToolName, endpointUrl } from "./publicApiMcp";

describe("public API MCP bridge", () => {
  it("gives every catalogued route a unique tool name", () => {
    const names = ENDPOINTS.map(endpointToolName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("offers key introspection as a dedicated tool", () => {
    expect(
      endpointToolName({
        method: "GET",
        path: "/api/v1/key",
        description: "Key capabilities",
        params: [],
      })
    ).toBe("get_key_capabilities");
  });

  it("builds only catalogued URL parameters", () => {
    const endpoint = ENDPOINTS.find(
      (entry) => entry.path === "/api/public/v1/country/[code]/metrics"
    )!;
    expect(
      endpointUrl(endpoint, { code: "US", category: "health" }, "https://example.com").href
    ).toBe("https://example.com/api/public/v1/country/US/metrics?category=health");
    expect(() => endpointUrl(endpoint, { code: "US", rogue: "1" }, "https://example.com")).toThrow(
      "Unknown parameter"
    );
    expect(() => endpointUrl(endpoint, {}, "https://example.com")).toThrow(
      "Missing required parameter"
    );
  });

  it("uses a scoped key and reports upstream authorization failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const endpoint = ENDPOINTS.find((entry) => entry.path === "/api/public/v1/game")!;
    await expect(callPublicApi(endpoint, {}, "https://example.com", "key")).rejects.toThrow(
      "API returned 401"
    );
    expect(fetchMock.mock.calls[0][1].headers["X-API-Key"]).toBe("key");
    vi.unstubAllGlobals();
  });

  it("rejects oversized responses before reading them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x", { headers: { "content-length": "2000001" } }))
    );
    const endpoint = ENDPOINTS.find((entry) => entry.path === "/api/public/v1/game")!;
    await expect(callPublicApi(endpoint, {}, "https://example.com", "key")).rejects.toThrow(
      "size limit"
    );
    vi.unstubAllGlobals();
  });
});
