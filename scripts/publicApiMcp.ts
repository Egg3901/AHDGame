/** Read-only MCP bridge for the scoped public v1 API. Runs over stdio. */
import { createInterface } from "node:readline";
import { ENDPOINTS, type PublicEndpointDefinition } from "../src/lib/publicApi/catalog";

const MAX_RESPONSE_BYTES = 2_000_000;
const TIMEOUT_MS = 15_000;

/**
 * MCP spec revisions this bridge speaks. Only the stable lifecycle, ping, and
 * tools methods are implemented, which behave identically across these.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"] as const;
const DEFAULT_PROTOCOL_VERSION =
  SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];

const KEY_ENDPOINT: PublicEndpointDefinition = {
  method: "GET",
  path: "/api/v1/key",
  description: "Inspect this API key's scope and allowed operation classes.",
  params: [],
};

export function endpointToolName(endpoint: PublicEndpointDefinition): string {
  if (endpoint.path === KEY_ENDPOINT.path) return "get_key_capabilities";
  return `get_${endpoint.path
    .replace("/api/public/v1/", "")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+$/, "")}`;
}

export function endpointUrl(
  endpoint: PublicEndpointDefinition,
  args: Record<string, unknown>,
  base: string
): URL {
  let pathname = endpoint.path;
  const query = new URLSearchParams();
  for (const param of endpoint.params) {
    const raw = args[param.name];
    if (raw === undefined || raw === null || raw === "") {
      if (param.required) throw new Error(`Missing required parameter: ${param.name}`);
      continue;
    }
    // Clients occasionally send numbers despite the string schema; a finite
    // number stringifies safely within the length bound.
    const value = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
    if (typeof value !== "string" || value.length > 256)
      throw new Error(`Invalid parameter: ${param.name}`);
    if (param.inPath) pathname = pathname.replace(`[${param.name}]`, encodeURIComponent(value));
    else query.set(param.name, value);
  }
  for (const name of Object.keys(args)) {
    if (!endpoint.params.some((param) => param.name === name))
      throw new Error(`Unknown parameter: ${name}`);
  }
  const url = new URL(pathname, base);
  url.search = query.toString();
  return url;
}

export async function callPublicApi(
  endpoint: PublicEndpointDefinition,
  args: Record<string, unknown>,
  base: string,
  key: string
): Promise<string> {
  const url = endpointUrl(endpoint, args, base);
  const response = await fetch(url, {
    headers: { "X-API-Key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("API response exceeds MCP size limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("API returned no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("API response exceeds MCP size limit");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!response.ok) throw new Error(`API returned ${response.status}: ${body.slice(0, 500)}`);
  return body;
}

export interface BridgeTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string" }>;
    required: string[];
    additionalProperties: false;
  };
  endpoint: PublicEndpointDefinition;
}

export function buildTools(): BridgeTool[] {
  return [
    ...ENDPOINTS.filter(
      (endpoint) => !endpoint.path.endsWith("/meta") && !endpoint.path.endsWith("/openapi.json")
    ),
    KEY_ENDPOINT,
  ].map((endpoint) => ({
    name: endpointToolName(endpoint),
    description: endpoint.description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(
        endpoint.params.map((param) => [param.name, { type: "string" }])
      ),
      required: endpoint.params.filter((param) => param.required).map((param) => param.name),
      additionalProperties: false,
    },
    endpoint,
  }));
}

export interface BridgeContext {
  tools: BridgeTool[];
  base: string;
  apiKey: string;
}

export interface JsonRpcReply {
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const invalidParams = (id: unknown, message: string): JsonRpcReply => ({
  id,
  error: { code: -32602, message },
});

/**
 * Answers one inbound JSON-RPC message, or returns null when no reply is owed
 * (notifications and JSON-RPC responses are never answered).
 */
export async function handleRpcMessage(
  message: unknown,
  context: BridgeContext
): Promise<JsonRpcReply | null> {
  if (typeof message !== "object" || message === null || Array.isArray(message))
    return { id: null, error: { code: -32600, message: "Invalid Request" } };
  const request = message as { id?: unknown; method?: unknown; params?: unknown };
  if (request.method === undefined && ("result" in message || "error" in message)) return null;
  if (request.id === undefined || request.id === null) return null;
  const id = request.id;
  if (typeof request.method !== "string" || request.method === "")
    return { id, error: { code: -32600, message: "Invalid Request" } };
  const params =
    typeof request.params === "object" && request.params !== null && !Array.isArray(request.params)
      ? (request.params as Record<string, unknown>)
      : undefined;
  if (request.method === "initialize") {
    const requested = params?.protocolVersion;
    const protocolVersion =
      typeof requested === "string" &&
      (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
    return {
      id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "ahd-public-api", version: "1.0.1" },
      },
    };
  }
  if (request.method === "ping") return { id, result: {} };
  if (request.method === "tools/list") {
    return {
      id,
      result: {
        tools: context.tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      },
    };
  }
  if (request.method === "tools/call") {
    if (!params) return invalidParams(id, "Invalid params");
    const tool = context.tools.find((candidate) => candidate.name === params.name);
    if (!tool) return invalidParams(id, "Unknown tool");
    const args = params.arguments;
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args)))
      return invalidParams(id, "Invalid params: arguments must be an object");
    try {
      const body = await callPublicApi(
        tool.endpoint,
        (args ?? {}) as Record<string, unknown>,
        context.base,
        context.apiKey
      );
      return { id, result: { content: [{ type: "text", text: body }] } };
    } catch (error) {
      return {
        id,
        result: {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        },
      };
    }
  }
  return { id, error: { code: -32601, message: "Method not found" } };
}

async function main() {
  const key = process.env.AHD_API_KEY;
  const base = process.env.AHD_API_BASE_URL || "https://ahousedividedgame.com";
  if (!key) throw new Error("AHD_API_KEY is required (create a public-scope key in Settings)");
  const origin = new URL(base);
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) {
    throw new Error("AHD_API_BASE_URL must use HTTPS outside localhost");
  }
  const tools = buildTools();
  const names = new Set(tools.map((tool) => tool.name));
  if (names.size !== tools.length)
    throw new Error("Public API routes produce duplicate MCP tool names");
  const context: BridgeContext = { tools, base, apiKey: key };
  // A client that disappears mid-write must not crash the bridge on EPIPE.
  process.stdout.on("error", () => process.exit(0));
  const write = (reply: JsonRpcReply) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...reply }) + "\n");
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      write({ id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    const reply = await handleRpcMessage(message, context);
    if (reply) write(reply);
  }
}

if (process.argv[1]?.endsWith("publicApiMcp.ts"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
