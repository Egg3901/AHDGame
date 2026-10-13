import type { NppAutonomyLevel } from "@/lib/db/types/gameState";

/**
 * Every NPP autonomy level, lowest first. The one list request schemas, the
 * admin panel and the client-statistics allowlist read. Adding a tier is this
 * list, the union in `gameState.ts` and `NPP_AUTONOMY_LEVEL_RANK`; the rank
 * test fails if the list and the rank map disagree.
 */
export const NPP_AUTONOMY_LEVELS = [
  "off",
  "v0",
  "v1",
  "v2",
  "v3",
  "v4",
  "v5",
  "v6",
] as const satisfies readonly NppAutonomyLevel[];
