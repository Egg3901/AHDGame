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
  it("preserves unrelated request diagnostics", () => {
    const event = {
      request: { url: "https://example.com/api/notifications", data: { action: "read" } },
    };
    expect(scrubPushRequest(event).request.data).toEqual({ action: "read" });
  });
});
