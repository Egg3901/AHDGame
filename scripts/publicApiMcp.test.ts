import { describe, expect, it, vi } from "vitest";
import { ENDPOINTS } from "../src/lib/publicApi/catalog";
import {
  buildTools,
  callPublicApi,
  endpointToolName,
  endpointUrl,
  handleRpcMessage,
  type BridgeContext,
} from "./publicApiMcp";

const context: BridgeContext = { tools: buildTools(), base: "https://example.com", apiKey: "key" };

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

  it("accepts finite numbers where the schema says string", () => {
    const endpoint = ENDPOINTS.find((entry) => entry.path === "/api/public/v1/characters/bulk")!;
    expect(endpointUrl(endpoint, { ids: 42 }, "https://example.com").href).toBe(
      "https://example.com/api/public/v1/characters/bulk?ids=42"
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

  it("answers initialize with a negotiated protocol version", async () => {
    const negotiated = await handleRpcMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      context
    );
    expect(negotiated?.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
    });
    const unsupported = await handleRpcMessage(
      { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "bogus" } },
      context
    );
    expect(unsupported?.result).toMatchObject({ protocolVersion: "2025-06-18" });
    const absent = await handleRpcMessage({ jsonrpc: "2.0", id: 3, method: "initialize" }, context);
    expect(absent?.result).toMatchObject({ protocolVersion: "2025-06-18" });
  });

  it("answers ping, including with falsy request ids", async () => {
    expect(await handleRpcMessage({ jsonrpc: "2.0", id: 0, method: "ping" }, context)).toEqual({
      id: 0,
      result: {},
    });
    expect(await handleRpcMessage({ jsonrpc: "2.0", id: "", method: "ping" }, context)).toEqual({
      id: "",
      result: {},
    });
  });

  it("lists every tool with its input schema", async () => {
    const reply = await handleRpcMessage({ jsonrpc: "2.0", id: 7, method: "tools/list" }, context);
    const tools = (reply?.result as { tools: { name: string; inputSchema: object }[] }).tools;
    expect(tools).toHaveLength(context.tools.length);
    expect(tools.map((tool) => tool.name)).toContain("get_key_capabilities");
  });

  it("calls a tool and wraps the API body as text content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    const reply = await handleRpcMessage(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_game" } },
      context
    );
    expect(reply?.result).toEqual({ content: [{ type: "text", text: '{"ok":true}' }] });
    vi.unstubAllGlobals();
  });

  it("reports tool call failures as isError results", async () => {
    const reply = await handleRpcMessage(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_country_code", arguments: {} },
      },
      context
    );
    expect(reply?.result).toMatchObject({ isError: true });
  });

  it("rejects malformed tools/call params with -32602", async () => {
    for (const params of [
      { arguments: {} },
      { name: "get_game", arguments: "nope" },
      { name: "get_game", arguments: [1, 2] },
      "positional",
    ]) {
      const reply = await handleRpcMessage(
        { jsonrpc: "2.0", id: 6, method: "tools/call", params },
        context
      );
      expect(reply?.error?.code).toBe(-32602);
    }
    const unknown = await handleRpcMessage(
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } },
      context
    );
    expect(unknown?.error).toMatchObject({ code: -32602, message: "Unknown tool" });
  });

  it("never answers notifications or inbound responses", async () => {
    for (const message of [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "tools/list" },
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, error: { code: -32000, message: "x" } },
    ]) {
      expect(await handleRpcMessage(message, context)).toBeNull();
    }
  });

  it("rejects invalid requests with -32600 instead of crashing", async () => {
    for (const message of [null, 42, "text", true, [], [{ id: 1, method: "ping" }]]) {
      const reply = await handleRpcMessage(message, context);
      expect(reply?.error?.code).toBe(-32600);
      expect(reply?.id).toBeNull();
    }
    expect(await handleRpcMessage({ jsonrpc: "2.0", id: 9 }, context)).toMatchObject({
      id: 9,
      error: { code: -32600 },
    });
    expect(await handleRpcMessage({ jsonrpc: "2.0", id: 9, method: 7 }, context)).toMatchObject({
      id: 9,
      error: { code: -32600 },
    });
  });

  it("rejects unknown methods with -32601", async () => {
    expect(
      await handleRpcMessage({ jsonrpc: "2.0", id: 8, method: "resources/list" }, context)
    ).toEqual({ id: 8, error: { code: -32601, message: "Method not found" } });
  });
});
