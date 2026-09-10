import { z } from "zod";

export const CLIENT_DIAGNOSTICS_COLLECTION = "clientDiagnostics";
export const CLIENT_DIAGNOSTICS_MAX_BYTES = 40_000;

const clientDiagnosticRuntimeSchema = z
  .object({
    clientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    platform: z.enum(["android", "ios", "desktop"]),
    screen: z.string().max(80),
    game: z.string().max(80),
    online: z.boolean(),
    viewport: z.string().max(80),
    language: z.string().max(40),
    userAgent: z.string().max(500),
  })
  .strict();

export const clientDiagnosticSchema = z
  .object({
    schemaVersion: z.literal(1),
    clientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    reason: z.enum(["cancelled", "error", "manual", "stalled"]),
    message: z.string().max(500),
    logLines: z.array(z.string().max(500)).max(60),
    occurredAt: z.string().datetime(),
    runtime: clientDiagnosticRuntimeSchema.optional(),
  })
  .strict();

export type ClientDiagnostic = z.infer<typeof clientDiagnosticSchema>;

export function toClientDiagnosticDocument(report: ClientDiagnostic, now = Date.now()) {
  return {
    ...report,
    receivedAt: new Date(now),
    expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
  };
}
