import { describe, expect, it } from "vitest";

import { HttpError } from "@/lib/observability/fetchJson";

import { isGatewayStatus, isTransientRequestFailure, isTransportFailure } from "./transient";

describe("transient request classification", () => {
  it("treats browser network drops and timeouts as transport failures", () => {
    expect(isTransportFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransportFailure(new TypeError("Load failed"))).toBe(true);
    expect(
      isTransportFailure(new TypeError("NetworkError when attempting to fetch resource."))
    ).toBe(true);
    expect(isTransportFailure(new DOMException("signal timed out", "TimeoutError"))).toBe(true);
  });

  it("keeps application errors and caller aborts out of the transient bucket", () => {
    expect(isTransportFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isTransportFailure(new SyntaxError("Unexpected end of JSON input"))).toBe(false);
    expect(isTransportFailure(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isTransportFailure("Failed to fetch")).toBe(false);
    expect(isTransportFailure(null)).toBe(false);
  });

  it("classifies only gateway statuses as transient HTTP failures", () => {
    expect([502, 503, 504].every(isGatewayStatus)).toBe(true);
    expect(isGatewayStatus(500)).toBe(false);
    expect(isTransientRequestFailure(new HttpError(502, "/api/x"))).toBe(true);
    expect(isTransientRequestFailure(new HttpError(500, "/api/x"))).toBe(false);
    expect(isTransientRequestFailure(new HttpError(404, "/api/x"))).toBe(false);
  });
});
