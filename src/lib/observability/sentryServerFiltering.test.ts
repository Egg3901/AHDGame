import { describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import "../../../sentry.server.config";

vi.mock("@sentry/nextjs", () => ({ init: vi.fn() }));

const beforeSend = vi.mocked(Sentry.init).mock.calls[0]?.[0]?.beforeSend;
if (!beforeSend) throw new Error("Server Sentry beforeSend is not configured");

function disconnectEvent(): Sentry.ErrorEvent {
  return {
    type: "error",
    exception: {
      values: [
        {
          type: "Error",
          value: "The destination stream closed early.",
          mechanism: { type: "auto.function.nextjs.on_request_error", handled: false },
          stacktrace: {
            frames: [
              { filename: "node:internal/streams/destroy", in_app: false },
              { filename: "node:events", in_app: false },
              {
                filename:
                  "/app/node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",
                in_app: false,
              },
            ],
          },
        },
      ],
    },
  };
}

describe("server Sentry disconnect filtering", () => {
  it("drops the captured Next.js rendering stream close without app frames", () => {
    expect(beforeSend(disconnectEvent(), {})).toBeNull();
  });

  it("retains a stream close that reaches application code", () => {
    const event = disconnectEvent();
    event.exception!.values![0].stacktrace!.frames!.push({
      filename: "src/lib/render.ts",
      in_app: true,
    });
    expect(beforeSend(event, {})).not.toBeNull();
  });

  it("retains an app frame even when the SDK omits the in_app flag", () => {
    const event = disconnectEvent();
    event.exception!.values![0].stacktrace!.frames!.push({ filename: "src/lib/render.ts" });
    expect(beforeSend(event, {})).not.toBeNull();
  });

  it("retains stream failures without the Next.js request-error mechanism", () => {
    const event = disconnectEvent();
    event.exception!.values![0].mechanism = { type: "generic", handled: false };
    expect(beforeSend(event, {})).not.toBeNull();
  });

  it("retains incomplete stacks and actual stream-write errors", () => {
    const noFrames = disconnectEvent();
    noFrames.exception!.values![0].stacktrace = undefined;
    expect(beforeSend(noFrames, {})).not.toBeNull();
    const writeError = disconnectEvent();
    writeError.exception!.values![0].value = "The destination stream errored while writing data.";
    expect(beforeSend(writeError, {})).not.toBeNull();
  });

  it("retains another exception chained to the framework disconnect", () => {
    const event = disconnectEvent();
    event.exception!.values!.push({ type: "TypeError", value: "render failed" });
    expect(beforeSend(event, {})).not.toBeNull();
  });
});
