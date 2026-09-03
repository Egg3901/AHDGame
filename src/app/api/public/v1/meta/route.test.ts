import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/api/errors", () => ({ handleRouteError: vi.fn() }));

import { ENDPOINTS } from "./route";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

describe("public v1 endpoint catalog", () => {
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
