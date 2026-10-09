import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";

import { initSentryClient } from "./initSentryClient";
import { dropSentryLog, SENTRY_DATA_COLLECTION, SENTRY_TRACE_LIFECYCLE } from "./sentryPrivacy";

vi.mock("@sentry/nextjs", () => ({ init: vi.fn(), captureRouterTransitionStart: vi.fn() }));

type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

const runtimes: Record<string, InitOptions> = {};

beforeAll(async () => {
  const init = vi.mocked(Sentry.init);
  await import("../../../sentry.server.config");
  runtimes.server = init.mock.calls.at(-1)![0]!;
  await import("../../../sentry.edge.config");
  runtimes.edge = init.mock.calls.at(-1)![0]!;
  initSentryClient();
  runtimes.browser = init.mock.calls.at(-1)![0]!;
  expect(init).toHaveBeenCalledTimes(3);
});

describe("Sentry v11 privacy baseline", () => {
  it("turns off every v11 data collection category", () => {
    expect(SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    });
  });

  it("drops every log", () => {
    expect(dropSentryLog()).toBeNull();
  });

  for (const runtime of ["server", "edge", "browser"]) {
    describe(`${runtime} init`, () => {
      it("applies the shared data collection baseline", () => {
        expect(runtimes[runtime].dataCollection).toBe(SENTRY_DATA_COLLECTION);
      });

      it("keeps static transactions so transaction filters still run", () => {
        expect(runtimes[runtime].traceLifecycle).toBe(SENTRY_TRACE_LIFECYCLE);
        expect(SENTRY_TRACE_LIFECYCLE).toBe("static");
      });

      it("drops logs instead of relying on the removed enableLogs flag", () => {
        expect(runtimes[runtime].beforeSendLog).toBe(dropSentryLog);
      });

      it("does not pass options removed in v11", () => {
        expect(runtimes[runtime]).not.toHaveProperty("sendDefaultPii");
        expect(runtimes[runtime]).not.toHaveProperty("enableLogs");
      });

      it("scrubs user identity from error events", async () => {
        const event: Sentry.ErrorEvent = {
          type: undefined,
          user: { id: "account-1", email: "someone@example.com" },
          request: {
            url: "https://example.test/api/thing?token=abc",
            headers: { cookie: "session=1" },
            cookies: { session: "1" },
            data: { password: "x" },
            query_string: "token=abc",
          },
        };
        const sent = await runtimes[runtime].beforeSend!(event, {});
        expect(sent?.user).toBeUndefined();
        expect(sent?.request).toEqual({ url: "https://example.test/api/thing" });
      });
    });
  }

  it("keeps server and browser polling transactions filtered", () => {
    for (const runtime of ["server", "browser"]) {
      expect(runtimes[runtime].ignoreTransactions).toContain("GET /api/events");
      expect(runtimes[runtime].beforeSendTransaction).toBeTypeOf("function");
    }
  });
});
