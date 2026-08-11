import { describe, it, expect } from "vitest";
import { parseBoundedIntParam, parseJsonBody, DEFAULT_MAX_BODY_BYTES } from "./validate";
import { z } from "zod";

describe("parseBoundedIntParam", () => {
  it("clamps parsed value to min/max", () => {
    const sp = new URLSearchParams({ limit: "999" });
    expect(parseBoundedIntParam(sp, "limit", 50, 1, 100)).toBe(100);
  });

  it("uses default when param missing", () => {
    const sp = new URLSearchParams();
    expect(parseBoundedIntParam(sp, "limit", 50, 1, 200)).toBe(50);
  });

  it("uses default when parseInt is NaN", () => {
    const sp = new URLSearchParams({ limit: "nope" });
    expect(parseBoundedIntParam(sp, "limit", 50, 1, 100)).toBe(50);
  });
});

describe("parseJsonBody", () => {
  it("returns parsed data for valid JSON matching schema", async () => {
    const schema = z.object({ a: z.number(), b: z.string() });
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ a: 1, b: "x" }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ a: 1, b: "x" });
    }
  });

  it("returns error for invalid JSON", async () => {
    const schema = z.object({ a: z.number() });
    const req = new Request("http://x", {
      method: "POST",
      body: "not json",
    });
    const result = await parseJsonBody(req, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Invalid JSON body");
      expect(result.status).toBe(400);
    }
  });

  it("returns error for schema validation failure", async () => {
    const schema = z.object({ a: z.number() });
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ a: "not a number" }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("a");
      expect(result.status).toBe(400);
    }
  });

  it("applies schema transforms", async () => {
    const schema = z.object({
      name: z.string().transform((s) => s.trim()),
    });
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "  foo  " }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("foo");
    }
  });
});

describe("parseJsonBody - body size cap", () => {
  const schema = z.object({ a: z.string() });

  it("rejects with 413 when the declared Content-Length exceeds the cap", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ a: "x" }),
      headers: { "content-length": String(DEFAULT_MAX_BODY_BYTES + 1) },
    });
    const result = await parseJsonBody(req, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Request body too large");
      expect(result.status).toBe(413);
    }
  });

  it("rejects with 413 when the buffered body exceeds the cap (no reliable Content-Length)", async () => {
    const big = JSON.stringify({ a: "x".repeat(DEFAULT_MAX_BODY_BYTES + 10) });
    // Stream the body so no Content-Length is declared (chunked-transfer path).
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const req = new Request("http://x", {
      method: "POST",
      body: stream,
      // @ts-expect-error duplex is required for streaming bodies in undici but missing from lib types
      duplex: "half",
    });
    const result = await parseJsonBody(req, schema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Request body too large");
      expect(result.status).toBe(413);
    }
  });

  it("honors a per-call maxBytes override", async () => {
    const body = JSON.stringify({ a: "x".repeat(64) });
    const reject = await parseJsonBody(new Request("http://x", { method: "POST", body }), schema, {
      maxBytes: 16,
    });
    expect(reject.success).toBe(false);
    if (!reject.success) expect(reject.status).toBe(413);

    const accept = await parseJsonBody(new Request("http://x", { method: "POST", body }), schema, {
      maxBytes: 1024,
    });
    expect(accept.success).toBe(true);
  });

  it("accepts bodies under the default cap unchanged", async () => {
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ a: "ok" }),
    });
    const result = await parseJsonBody(req, schema);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ a: "ok" });
  });
});
