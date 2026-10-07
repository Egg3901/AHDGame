/**
 * Compile-time release availability. These switches make the independently
 * staged v2 selectors available to admins; a system still cannot activate in a
 * world without its matching, verified opening-seed receipt.
 */

import type { ResetSystem } from "./rules";

export const RESET_V2_READY: Readonly<Record<ResetSystem, boolean>> = {
  metrics: true,
  legislation: true,
  cabinet: true,
  demographics: true,
};
