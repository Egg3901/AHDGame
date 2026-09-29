/**
 * The reset-era rollout is not active until each full runtime path is merged.
 * A ready switch needs its data migration, UI, turn path, and rollback test.
 * The admin API rejects v2 while its system is marked unavailable.
 */

import type { ResetSystem } from "./rules";

export const RESET_V2_READY: Readonly<Record<ResetSystem, boolean>> = {
  metrics: false,
  legislation: false,
  cabinet: false,
};
