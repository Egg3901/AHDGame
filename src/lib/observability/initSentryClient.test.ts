import { describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { initSentryClient } from "./initSentryClient";

vi.mock("@sentry/nextjs", () => ({ init: vi.fn(), captureRouterTransitionStart: vi.fn() }));
vi.mock("./scrubSentryEvent", () => ({ scrubSentryEvent: (event: unknown) => event }));

describe("market cleanup error reporting", () => {
  it("drops the tagged abort and retains an ordinary timeout or untagged abort", () => {
    initSentryClient();
    const beforeSend = vi.mocked(Sentry.init).mock.calls[0][0].beforeSend!;
    const event = (type: string, value: string): Sentry.ErrorEvent => ({
      exception: { values: [{ type, value }] },
    });
    expect(
      beforeSend(event("AbortError", "Market polling stopped after view cleanup"), {})
    ).toBeNull();
    const timeout = event("TimeoutError", "signal timed out");
    expect(beforeSend(timeout, {})).toBe(timeout);
    const abort = event("AbortError", "signal is aborted without reason");
    expect(beforeSend(abort, {})).toBe(abort);
  });
});
