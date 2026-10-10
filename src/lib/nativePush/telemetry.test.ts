import { describe, expect, it } from "vitest";
import { scrubPushRequest } from "./telemetry";
describe("push request telemetry", () => {
  it("removes registration bodies, cookies and headers from captured requests", () => {
    const event = {
      request: {
        url: "https://example.com/api/push/device",
        data: { installation: "private", token: "private" },
        cookies: { session: "private" },
        headers: { Authorization: "private" },
      },
    };
    expect(scrubPushRequest(event).request).toEqual({ url: "https://example.com/api/push/device" });
  });
  it("strips the cursor and session from desktop feed polls", () => {
    const event = {
      request: {
        url: "https://example.com/api/push/feed?after=507f1f77bcf86cd799439011",
        cookies: { session: "private" },
        query_string: "after=507f1f77bcf86cd799439011",
      },
    };
    expect(scrubPushRequest(event).request).toEqual({ url: "https://example.com/api/push/feed" });
  });
  it("preserves unrelated request diagnostics", () => {
    const event = {
      request: { url: "https://example.com/api/notifications", data: { action: "read" } },
    };
    expect(scrubPushRequest(event).request.data).toEqual({ action: "read" });
  });
});
