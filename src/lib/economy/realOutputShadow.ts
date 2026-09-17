/**
 * Real-output shadow experiment flag (issue #1470 acceptance item 1).
 *
 * The constant-price helpers in `@/lib/turn/gdpGrowth` are shadow-only in
 * this slice: no phase, node, or query reads them. When engine consumption
 * lands, it goes behind this flag, which is EXPLICITLY DISABLED BY DEFAULT:
 * absent, null, false, or any non-`true` value resolves to off, and it is
 * NEVER enabled in this slice. Enabling requires its own balance-gated slice
 * with a worldsim report (labels `balance` + `needs-worldsim`).
 *
 * The resolver is pure (no Db, no clock) so callers thread the config they
 * already loaded, mirroring how `sumRealizedRevenue` requires callers to
 * thread `plantsEnabled` rather than defaulting it.
 */
export function isRealOutputShadowEnabled(
  config?: { realOutputShadowEnabled?: unknown } | null
): boolean {
  return config?.realOutputShadowEnabled === true;
}

/**
 * Canonical sim-queue CLI spelling for the shadow flag (issue #1470).
 * The ONLY mapping between a simJobs `realOutputShadowEnabled` boolean and
 * runWorld argv: worker emission, runWorld parsing, the preserve-live-config
 * guard, and the MCP schema all reference this constant, never a local
 * literal. Pure, like the rest of this module.
 */
export const REAL_OUTPUT_SHADOW_CLI_FLAG = "real-output-shadow";

/**
 * Parse the canonical flag from runWorld argv. Explicit `"true"`/`"false"`
 * only: absent means unset (preset default, i.e. off), anything else throws
 * so a typo can never silently enable or disable the experiment.
 */
export function parseRealOutputShadowEnabled(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${REAL_OUTPUT_SHADOW_CLI_FLAG} must be true or false (got "${raw}")`);
}

/**
 * Flag-off identity contract: the live sector signal is ALWAYS the nominal
 * print in this slice. When the flag is on the caller may ADDITIONALLY record
 * the constant-price print as a diagnostic; when off (the only production
 * state in this slice) even the diagnostic stays null so a disabled
 * experiment writes nothing and changes no number any consumer reads.
 */
export function selectShadowSectorSignal(input: {
  nominalSignal: number;
  realSignal: number | null;
  flagEnabled: boolean;
}): { signal: number; shadow: number | null } {
  return {
    signal: input.nominalSignal,
    shadow: input.flagEnabled ? input.realSignal : null,
  };
}
