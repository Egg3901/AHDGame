import { describe, it, expect } from "vitest";

describe("GET /api/error-codes", () => {
  it("returns 200 with versioned error catalog", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty("version");
    expect(typeof json.version).toBe("string");
    expect(json).toHaveProperty("errors");
    expect(Array.isArray(json.errors)).toBe(true);
    expect(json.errors.length).toBeGreaterThan(0);
  });

  it("includes required fields on each error entry", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    for (const entry of json.errors) {
      expect(entry).toHaveProperty("code");
      expect(entry).toHaveProperty("httpStatus");
      expect(entry).toHaveProperty("category");
      expect(entry).toHaveProperty("message");
      expect(typeof entry.code).toBe("string");
      expect(typeof entry.httpStatus).toBe("number");
    }
  });

  it("includes all standard error codes", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    const codes = json.errors.map((e: { code: string }) => e.code);
    expect(codes).toContain("BAD_REQUEST");
    expect(codes).toContain("UNAUTHORIZED");
    expect(codes).toContain("FORBIDDEN");
    expect(codes).toContain("NOT_FOUND");
    expect(codes).toContain("INTERNAL_ERROR");
  });
});
