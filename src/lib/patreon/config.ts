import type { PatreonTier } from "@/lib/db/types";
import { PATREON_GRACE_PERIOD_MS } from "@/lib/db/types";

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getPatreonWebhookSecret(): string | null {
  return readEnv("PATREON_WEBHOOK_SECRET") ?? null;
}

export function getPatreonTierMap(): Record<string, Exclude<PatreonTier, null>> {
  const supporterId = readEnv("PATREON_SUPPORTER_TIER_ID");
  const supporterPlusId = readEnv("PATREON_SUPPORTER_PLUS_TIER_ID");
  const supporterPlusPlusId = readEnv("PATREON_SUPPORTER_PLUS_PLUS_TIER_ID");

  const map: Record<string, Exclude<PatreonTier, null>> = {};
  if (supporterId) map[supporterId] = "supporter";
  if (supporterPlusId) map[supporterPlusId] = "supporter-plus";
  if (supporterPlusPlusId) map[supporterPlusPlusId] = "supporter-plus-plus";
  return map;
}

export function getPatreonGracePeriodMs(): number {
  return PATREON_GRACE_PERIOD_MS;
}
