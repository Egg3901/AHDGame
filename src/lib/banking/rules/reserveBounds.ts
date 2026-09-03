/**
 * Reserve-requirement bounds and era defaults, in a module a CLIENT component
 * can import.
 *
 * These four numbers used to live in `reserves.ts` next to the functions that
 * enforce them, which reads well and broke the production build. `reserves.ts`
 * imports `mongodb`, `gdpAnchorRate` and the banking feature flag, and
 * `gdpAnchorRate` reaches the turn engine, which reaches `sharp`. So the one
 * line in `CentralBankReserveTab.tsx` importing two constants pulled that whole
 * graph into the browser bundle, and Turbopack failed the build on `fs`, `net`,
 * `dns`, `async_hooks`, `child_process`, `tls` and a non-placeable `sharp`
 * binary. Twenty-four errors, all from one import of two numbers.
 *
 * Nothing here may import anything that touches the database, the filesystem or
 * the turn engine. Values only.
 *
 * `reserves.ts` re-exports these, so every server-side caller is unchanged and
 * there is still one definition of each number.
 */

/**
 * Provisional era default reserve ratio for historical worlds (era unit scale > 1).
 * Flagged for user review.
 */
export const RESERVE_REQUIREMENT_HISTORICAL_DEFAULT = 0.2;

/**
 * Provisional era default reserve ratio for modern worlds (era unit scale <= 1).
 * Flagged for user review.
 */
export const RESERVE_REQUIREMENT_MODERN_DEFAULT = 0.1;

/** Provisional floor on settable reserve ratios. Flagged for user review. */
export const RESERVE_REQUIREMENT_MIN = 0.05;

/** Provisional ceiling on settable reserve ratios. Flagged for user review. */
export const RESERVE_REQUIREMENT_MAX = 0.95;
