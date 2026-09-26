import { expect, it } from "vitest";
import type * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./scrubSentryEvent";

it("removes account and request data while preserving the diagnostic stack", () => {
  const event = {
    user: { email: "person@example.com" },
    request: { url: "https://game.example/path?email=person@example.com", data: "secret" },
    exception: {
      values: [
        {
          value: "Failure for person@example.com",
          stacktrace: { frames: [{ filename: "app.ts" }] },
        },
      ],
    },
    breadcrumbs: [{ message: "person@example.com clicked", data: { input: "private" } }],
    extra: { player: "private" },
  };

  const result = scrubSentryEvent(event as unknown as Sentry.ErrorEvent);
  expect(result.user).toBeUndefined();
  expect(result.request).toEqual({ url: "https://game.example/path" });
  expect(result.exception?.values?.[0]?.value).toBe("Failure for [email]");
  expect(result.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe("app.ts");
  expect(result.breadcrumbs?.[0]).toEqual({ message: "[email] clicked" });
  expect(result.extra).toBeUndefined();
});
