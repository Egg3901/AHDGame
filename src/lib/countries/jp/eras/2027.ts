import type { CountryEraOverride } from "../../contract";
import { JP_2023 } from "./2023";

/**
 * Japan, 2027. Added when `origin/development`'s 2027 preset (#1687) merged in.
 *
 * ⚠️ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * ⚠️ THIS ERA REUSES 2023'S ORDER OF BATTLE, DELIBERATELY AND EXPLICITLY.
 * Upstream shipped 2027 with authored regions, census and seat rosters, but no
 * new order of battle for Japan. Reusing the 2023 force posture is the same
 * choice 1999 and 2007 make for the February 2020 Congress: the alternative is
 * inventing a 2027 force structure, which is worse than restating a known one.
 *
 * Spreading `JP_2023.institutions` rather than copying its 13 entries is what
 * keeps that reuse honest. A copy would be a second source that drifts the
 * first time 2023's posture is edited, and nothing would report the divergence
 * -- the D5 census bundles failed exactly this way, which is why
 * `japanReachable.test.ts` compares those with `toBe` rather than `toEqual`.
 *
 * No config override: 2027 uses Japan's base configuration, the same as 2023.
 */
export const JP_2027: CountryEraOverride = {
  preset: "2027-default",
  institutions: JP_2023.institutions,
};
