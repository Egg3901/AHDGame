import { describe, expect, it } from "vitest";
import {
  describeSentryIngest,
  formatSentryIngestLog,
  resolvePublicSentryDsn,
  SENTRY_DEFAULT_ORG,
} from "./sentryIngest";

describe("resolvePublicSentryDsn", () => {
  it("prefers the explicit public DSN", () => {
    expect(
      resolvePublicSentryDsn({
        NEXT_PUBLIC_SENTRY_DSN: "https://a@h/1",
        SENTRY_DSN: "https://b@h/2",
      })
    ).toBe("https://a@h/1");
  });
  it("falls back to the server DSN so browser errors are not dropped", () => {
    expect(resolvePublicSentryDsn({ SENTRY_DSN: " https://b@h/2 " })).toBe("https://b@h/2");
  });
  it("is undefined when neither is set", () => {
    expect(resolvePublicSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: "  " })).toBeUndefined();
  });
});

describe("describeSentryIngest", () => {
  const railway = { RAILWAY_ENVIRONMENT_NAME: "production" };
  it("reports host and project but never the key", () => {
    const s = describeSentryIngest({
      ...railway,
      SENTRY_DSN: "https://secretkey@o1.ingest.us.sentry.io/42",
    });
    expect(s).toEqual({
      enabled: true,
      host: "o1.ingest.us.sentry.io",
      projectId: "42",
      problem: null,
    });
    expect(formatSentryIngestLog(s)).not.toContain("secretkey");
  });
  it("flags a missing DSN on Railway", () => {
    expect(describeSentryIngest(railway).problem).toBe("missing-dsn");
  });
  it("flags a malformed DSN", () => {
    expect(describeSentryIngest({ ...railway, SENTRY_DSN: "not a dsn" }).problem).toBe(
      "invalid-dsn"
    );
    expect(describeSentryIngest({ ...railway, SENTRY_DSN: "https://h/1" }).problem).toBe(
      "invalid-dsn"
    );
  });
  it("is disabled off Railway", () => {
    expect(describeSentryIngest({ SENTRY_DSN: "https://k@h/1" }).problem).toBe(
      "disabled-environment"
    );
  });
  it("defaults to the real organization slug", () => {
    expect(SENTRY_DEFAULT_ORG).toBe("ahousedivided");
  });
});
