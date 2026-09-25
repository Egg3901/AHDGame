import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/api/errors", () => ({ handleRouteError: vi.fn() }));

import { ENDPOINTS } from "./route";
import { GET } from "./route";
import { publicApiGuard } from "@/lib/publicApi/middleware";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

describe("public v1 endpoint catalog", () => {
  it("advertises scoped MCP and CDN integration metadata", async () => {
    vi.mocked(publicApiGuard).mockResolvedValue({ ok: true, headers: {} });
    const response = await GET(new Request("https://example.com/api/public/v1/meta"));
    const body = await response.json();
    expect(body.integrations.mcp).toMatchObject({
      command: "npm run --silent api:mcp",
      credentialEnv: "AHD_API_KEY",
      access: "read-only public v1 endpoints",
    });
    expect(body.integrations.cdn.staticBaseUrl).toBe("https://cdn.ahousedividedgame.com/static/");
  });
  it("matches every implemented route exactly", () => {
    const root = join(process.cwd(), "src", "app", "api", "public", "v1");
    const implemented = routeFiles(root)
      .map((file) => `/api/public/v1/${relative(root, file).split(sep).join("/")}`)
      .map((path) => path.replace(/\/route\.ts$/, ""))
      .sort();
    const catalogued = ENDPOINTS.map((endpoint) => endpoint.path).sort();

    expect(catalogued).toEqual(implemented);
  });
});
