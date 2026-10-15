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
      type: undefined,
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

describe("AHDClient shell plugin refusals", () => {
  const refusal = (value: string): Sentry.ErrorEvent => ({
    type: undefined,
    exception: {
      values: [
        {
          type: "UnhandledRejection",
          value: `Non-Error promise rejection captured with value: ${value}`,
        },
      ],
    },
  });

  it("drops the refusal only inside the shell and keeps other rejections", () => {
    initSentryClient();
    const beforeSend = vi.mocked(Sentry.init).mock.calls.at(-1)![0].beforeSend!;
    const linkRefusal = refusal("Command plugin:opener|open_url not allowed by ACL");

    vi.stubGlobal("window", {});
    expect(beforeSend(linkRefusal, {})).toBe(linkRefusal);

    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(beforeSend(linkRefusal, {})).toBeNull();
    const other = refusal("Command plugin:fs|read_file not allowed by ACL");
    expect(beforeSend(other, {})).toBe(other);
    vi.unstubAllGlobals();
  });
});
