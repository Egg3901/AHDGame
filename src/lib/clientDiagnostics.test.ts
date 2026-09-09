import { describe, expect, it } from "vitest";
import {
  clientDiagnosticSchema,
  toClientDiagnosticDocument,
  type ClientDiagnostic,
} from "./clientDiagnostics";

const valid = {
  schemaVersion: 1,
  clientVersion: "2.0.4",
  reason: "stalled",
  message: "Setup stopped reporting progress",
  logLines: ["local mode"],
  occurredAt: "2026-09-06T00:00:00.000Z",
} satisfies ClientDiagnostic;

describe("client diagnostics privacy contract", () => {
  it("accepts a manual desktop report with bounded runtime context", () => {
    expect(
      clientDiagnosticSchema.safeParse({
        ...valid,
        reason: "manual",
        runtime: {
          clientVersion: "2.1.1",
          platform: "desktop",
          screen: "launcher",
          game: "local game stopped",
          online: true,
          viewport: "1920x1057 @ 1x",
          language: "en-US",
          userAgent: "Mozilla/5.0",
        },
      }).success
    ).toBe(true);
  });

  it("accepts only the bounded allowlisted shape", () => {
    expect(clientDiagnosticSchema.safeParse(valid).success).toBe(true);
    expect(clientDiagnosticSchema.safeParse({ ...valid, accountId: "secret" }).success).toBe(false);
    expect(
      clientDiagnosticSchema.safeParse({ ...valid, logLines: Array(61).fill("line") }).success
    ).toBe(false);
  });

  it("expires reports after thirty days", () => {
    const stored = toClientDiagnosticDocument(valid, 0);
    expect(stored.expiresAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
