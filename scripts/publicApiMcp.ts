/** Read-only MCP bridge for the scoped public v1 API. Runs over stdio. */
import { createInterface } from "node:readline";
import { ENDPOINTS, type PublicEndpointDefinition } from "../src/lib/publicApi/catalog";

const MAX_RESPONSE_BYTES = 2_000_000;
const TIMEOUT_MS = 15_000;

export function endpointToolName(endpoint: PublicEndpointDefinition): string {
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
    const value = args[param.name];
    if (value === undefined || value === null || value === "") {
      if (param.required) throw new Error(`Missing required parameter: ${param.name}`);
      continue;
    }
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

async function main() {
  const key = process.env.AHD_API_KEY;
  const base = process.env.AHD_API_BASE_URL || "https://ahousedividedgame.com";
  if (!key) throw new Error("AHD_API_KEY is required (create a public-scope key in Settings)");
  const origin = new URL(base);
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) {
    throw new Error("AHD_API_BASE_URL must use HTTPS outside localhost");
  }
  const tools = ENDPOINTS.filter(
    (endpoint) => !endpoint.path.endsWith("/meta") && !endpoint.path.endsWith("/openapi.json")
  ).map((endpoint) => ({
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
  const names = new Set(tools.map((tool) => tool.name));
  if (names.size !== tools.length)
    throw new Error("Public API routes produce duplicate MCP tool names");
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let message: {
      id?: unknown;
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined || message.id === null) continue;
    const reply = (payload: Record<string, unknown>) =>
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, ...payload }) + "\n");
    if (message.method === "initialize") {
      reply({
        result: {
          protocolVersion: message.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "ahd-public-api", version: "1.0.0" },
        },
      });
    } else if (message.method === "tools/list") {
      reply({
        result: {
          tools: tools.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        },
      });
    } else if (message.method === "tools/call") {
      const tool = tools.find((candidate) => candidate.name === message.params?.name);
      if (!tool) {
        reply({ error: { code: -32602, message: "Unknown tool" } });
        continue;
      }
      try {
        const body = await callPublicApi(tool.endpoint, message.params?.arguments || {}, base, key);
        reply({ result: { content: [{ type: "text", text: body }] } });
      } catch (error) {
        reply({
          result: {
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
            isError: true,
          },
        });
      }
    } else reply({ error: { code: -32601, message: "Method not found" } });
  }
}

if (process.argv[1]?.endsWith("publicApiMcp.ts"))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
