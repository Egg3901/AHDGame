import { describe, expect, it } from "vitest";
import {
  ERROR_CATALOG,
  defaultMessageFor,
  errorCodeForStatus,
  apiErrorText,
  isErrorCode,
  newRequestRef,
  parseErrorBody,
} from "./catalog";

describe("error catalog", () => {
  it("maps statuses to catalog codes", () => {
    expect(errorCodeForStatus(401)).toBe("UNAUTHORIZED");
    expect(errorCodeForStatus(429)).toBe("RATE_LIMITED");
    expect(errorCodeForStatus(503)).toBe("SERVICE_UNAVAILABLE");
    expect(errorCodeForStatus(500)).toBe("INTERNAL_ERROR");
    expect(errorCodeForStatus(418)).toBe("BAD_REQUEST");
  });

  it("every code has copy without dashes and a retryable flag", () => {
    for (const [code, entry] of Object.entries(ERROR_CATALOG)) {
      expect(isErrorCode(code)).toBe(true);
      expect(entry.message).not.toMatch(/[–—]/);
      expect(typeof entry.retryable).toBe("boolean");
    }
  });

  it("falls back to generic copy for unknown codes", () => {
    expect(defaultMessageFor("NOPE")).toBe(ERROR_CATALOG.INTERNAL_ERROR.message);
  });

  it("generates distinct non-empty refs", () => {
    const a = newRequestRef();
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(newRequestRef()).not.toBe(a);
  });

  it("parses the flat envelope", () => {
    expect(parseErrorBody({ error: "bad", code: "BAD_REQUEST", ref: "r1" })).toEqual({
      message: "bad",
      code: "BAD_REQUEST",
      ref: "r1",
    });
    expect(parseErrorBody({ error: "x", eventId: "evt" }).ref).toBe("evt");
  });

  it("parses the nested envelope", () => {
    expect(parseErrorBody({ error: { code: "NOT_FOUND", message: "gone", ref: "r2" } })).toEqual({
      message: "gone",
      code: "NOT_FOUND",
      ref: "r2",
    });
  });

  it("tolerates junk", () => {
    expect(parseErrorBody(null)).toEqual({});
    expect(parseErrorBody("x")).toEqual({});
  });
});

describe("apiErrorText", () => {
  it("appends the code, and the ref only for server faults", () => {
    expect(apiErrorText({ error: "Not enough cash", code: "BAD_REQUEST", ref: "r1" }, "x")).toBe(
      "Not enough cash (BAD_REQUEST)"
    );
    expect(
      apiErrorText({ error: "Oops", code: "INTERNAL_ERROR", ref: "0123456789abcdef" }, "x")
    ).toBe("Oops (INTERNAL_ERROR, ref 01234567)");
  });
  it("uses the fallback when the body has no message and tolerates codeless bodies", () => {
    expect(apiErrorText({}, "Failed to save")).toBe("Failed to save");
    expect(apiErrorText({ error: "plain" }, "x")).toBe("plain");
    expect(apiErrorText(null, "fb")).toBe("fb");
  });
});
