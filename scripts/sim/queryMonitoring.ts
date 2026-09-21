/** Query diagnostics are explicit because Mongo monitoring decodes reply batches again. */
export function worldsimQueryMonitoringRequested(
  argv: readonly string[],
  env: Record<string, string | undefined>
): boolean {
  return (
    argv.includes("--profile-queries") ||
    env.AHD_TURN_ROUNDTRIP_MONITOR === "1" ||
    env.AHD_TURN_ROUNDTRIP_PROFILE === "1"
  );
}
