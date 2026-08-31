import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "./catalog";
import { buildPublicV1OpenApiDocument } from "./openapi";

describe("public v1 OpenAPI document", () => {
  it("describes every catalog route with valid path parameters and auth", () => {
    const document = buildPublicV1OpenApiDocument("https://example.test");

    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toHaveLength(ENDPOINTS.length);
    expect(document.paths).toHaveProperty("/api/public/v1/country/{code}/economy/history");
    expect(document.paths).toHaveProperty("/api/public/v1/openapi.json");
    expect(document.components.securitySchemes.ApiKeyAuth.name).toBe("X-API-Key");

    const countryHistory = document.paths["/api/public/v1/country/{code}/economy/history"] as {
      get: { parameters: Array<{ name: string; in: string; required: boolean }> };
    };
    expect(countryHistory.get.parameters).toContainEqual(
      expect.objectContaining({ name: "code", in: "path", required: true })
    );
  });
});
