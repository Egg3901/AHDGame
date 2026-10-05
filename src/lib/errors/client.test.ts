import { describe, expect, it } from "vitest";
import { readApiError, toDisplayError } from "./client";

describe("readApiError", () => {
  it("reads code, ref and message from the envelope", async () => {
    const res = new Response(JSON.stringify({ error: "nope", code: "FORBIDDEN", ref: "abc" }), {
      status: 403,
    });
    expect(await readApiError(res)).toEqual({
      message: "nope",
      code: "FORBIDDEN",
      ref: "abc",
      status: 403,
    });
  });

  it("falls back to the status code on non-JSON bodies", async () => {
    const d = await readApiError(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(d.code).toBe("SERVICE_UNAVAILABLE");
    expect(d.message).toMatch(/unavailable/i);
  });

  it("uses the x-request-id header when the body has no ref", async () => {
    const d = await readApiError(
      new Response("{}", { status: 500, headers: { "x-request-id": "hdr1" } })
    );
    expect(d.ref).toBe("hdr1");
  });
});

describe("toDisplayError", () => {
  it("reads HttpError fields", () => {
    const e = Object.assign(new Error("Request failed"), {
      name: "HttpError",
      status: 429,
      code: "RATE_LIMITED",
      ref: "r9",
      serverMessage: "slow down",
    });
    expect(toDisplayError(e)).toEqual({
      message: "slow down",
      code: "RATE_LIMITED",
      ref: "r9",
      status: 429,
    });
  });

  it("classifies fetch failures as NETWORK_ERROR", () => {
    expect(toDisplayError(new TypeError("Failed to fetch")).code).toBe("NETWORK_ERROR");
  });

  it("wraps plain errors and non-errors", () => {
    expect(toDisplayError(new Error("boom"))).toMatchObject({
      code: "CLIENT_ERROR",
      message: "boom",
    });
    expect(toDisplayError(undefined, "fallback")).toMatchObject({
      code: "CLIENT_ERROR",
      message: "fallback",
    });
  });
});
