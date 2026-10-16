import type { NppAutonomyLevel } from "@/lib/db/types/gameState";

/**
 * NPP engine version: the code revision of autonomous-politician behavior.
 *
 * Two axes, kept apart on purpose:
 *   - `nppAutonomyLevel` is a per-world setting. It says which activities
 *     NPPs may perform in that world (off, v0 to v6).
 *   - `NPP_ENGINE_VERSION` is the code. It says how the shipped engine
 *     performs them, and is the same on every world running this build.
 *
 * Engine majors line up with autonomy tiers. Engine 0.x to 5.x are the
 * behavior that shipped with autonomy v0 to v5; engine 6.x is the overhaul,
 * and every engine-6 behavior is gated on `NPP_ENGINE_LEVEL` (v6), so a world
 * below v6 runs the engine 5 behavior unchanged.
 *
 * Bump rules, in the same pull request as the change:
 *   - minor: an NPP decision changes (what an NPP chooses, when, or how well).
 *   - patch: no decision changes (a fix that restores intended behavior, or a
 *     cost-only change such as fewer round trips).
 *   - major: a new autonomy tier.
 * Then add the matching section to `content/changelog/npp/NPP_CHANGELOG.md`;
 * `engineVersion.test.ts` fails when the two disagree. Tag the pull request
 * title `(npp engine X.Y.Z)`.
 */
export const NPP_ENGINE_VERSION = "6.20.0";

/** The autonomy tier that switches engine-6 behavior on. */
export const NPP_ENGINE_LEVEL: NppAutonomyLevel = "v6";
