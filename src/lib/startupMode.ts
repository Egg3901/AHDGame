export function shouldStartHostedBackgroundServices(
  env: Record<string, string | undefined>
): boolean {
  return env.DISABLE_DEV_BACKGROUND !== "1" && env.SINGLEPLAYER !== "1";
}
