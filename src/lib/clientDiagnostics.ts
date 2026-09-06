import { z } from "zod";

export const CLIENT_DIAGNOSTICS_COLLECTION = "clientDiagnostics";
export const CLIENT_DIAGNOSTICS_MAX_BYTES = 40_000;

export const clientDiagnosticSchema = z
  .object({
    schemaVersion: z.literal(1),
    clientVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    reason: z.enum(["cancelled", "error", "stalled"]),
    message: z.string().max(500),
    logLines: z.array(z.string().max(500)).max(60),
    occurredAt: z.string().datetime(),
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
