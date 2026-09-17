/**
 * Partially redact an IP for display to a non-admin moderator.
 *
 * Hoisted into its own leaf module so consumers can reach it without importing
 * `@/lib/altDetection/signals`, which value-imports `@/lib/turn/suspiciousDetection`
 * and drags the turn system in with it. `signals.ts` re-exports this, so there
 * is still exactly one definition.
 */
export function maskIp(ip: string): string {
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return `${parts[0] ?? ""}:${parts[1] ?? ""}::xxxx`;
  }
  const parts = ip.split(".");
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
  return "xxx.xxx.xxx.xxx";
}
