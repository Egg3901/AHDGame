import { ENDPOINTS } from "./catalog";

const INTEGER_PARAMS = new Set([
  "beforeTurn",
  "fromTurn",
  "history",
  "limit",
  "page",
  "pageSize",
  "toTurn",
]);
const BOOLEAN_PARAMS = new Set(["includePending", "results"]);

function openApiPath(path: string) {
  return path.replace(/\[([^\]]+)\]/g, "{$1}");
}

function parameterSchema(name: string) {
  if (BOOLEAN_PARAMS.has(name)) return { type: "boolean" };
  if (INTEGER_PARAMS.has(name)) return { type: "integer", minimum: 0 };
  return { type: "string" };
}

function operationId(path: string) {
  return `get_${
    path
      .replace(/^\/api\/public\/v1\/?/, "")
      .replace(/\[([^\]]+)\]/g, "by_$1")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "root"
  }`;
}

function tagFor(path: string) {
  return path.replace(/^\/api\/public\/v1\/?/, "").split("/")[0] || "meta";
}

export function buildPublicV1OpenApiDocument(baseUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const endpoint of ENDPOINTS) {
    const successSchema = endpoint.path.endsWith("/openapi.json")
      ? {
          type: "object",
          required: ["openapi", "info", "paths"],
          properties: {
            openapi: { type: "string" },
            info: { type: "object" },
            paths: { type: "object" },
          },
          additionalProperties: true,
        }
      : { $ref: "#/components/schemas/Success" };
    paths[openApiPath(endpoint.path)] = {
      get: {
        operationId: operationId(endpoint.path),
        summary: endpoint.description,
        tags: [tagFor(endpoint.path)],
        security: [{ ApiKeyAuth: [] }, { BotTokenAuth: [] }],
        parameters: endpoint.params.map((parameter) => ({
          name: parameter.name,
          in: "inPath" in parameter && parameter.inPath ? "path" : "query",
          required: "inPath" in parameter && parameter.inPath ? true : parameter.required,
          schema: parameterSchema(parameter.name),
        })),
        responses: {
          "200": {
            description: "Successful response",
            headers: {
              "X-RateLimit-Limit": { schema: { type: "integer" } },
              "X-RateLimit-Remaining": { schema: { type: "integer" } },
              "X-RateLimit-Reset": { schema: { type: "integer" } },
            },
            content: {
              "application/json": { schema: successSchema },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/ServerError" },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "A House Divided Public API",
      version: "1.1.0",
      description:
        "Read-only public game-state interface. Version 1 is additive-only: existing fields are not removed or renamed.",
    },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Personal API key with public or private scope.",
        },
        BotTokenAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Bot-Token",
          description: "Legacy server bot token.",
        },
      },
      schemas: {
        Success: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean", const: true } },
          additionalProperties: true,
        },
        Error: {
          type: "object",
          required: ["ok", "error", "code"],
          properties: {
            ok: { type: "boolean", const: false },
            error: { type: "string" },
            code: { type: "string" },
          },
          additionalProperties: true,
        },
      },
      responses: {
        BadRequest: {
          description: "Invalid path or query parameter",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Unauthorized: {
          description: "Missing or invalid API key",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        RateLimited: {
          description: "Rate limit exceeded",
          headers: { "Retry-After": { schema: { type: "integer" } } },
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        ServerError: {
          description: "Unexpected server error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  } as const;
}
