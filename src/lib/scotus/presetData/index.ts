import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import type { ScotusPresetSeed } from "./types";
import { SCOTUS_2019_DEFAULT_SEED } from "./2019Default";
import { SCOTUS_1991_PRESET_DATA } from "./1991";
import { SCOTUS_1979_PRESET_SEED } from "./1979";
import { SCOTUS_1953_SEED } from "./1953";

/**
 * SCOTUS content extension point (#3598 core mechanics).
 *
 * ============================================================================
 * TICKETS #3599 (1953), #3600 (1979), #3601 (1991), #3602 (2019-default):
 * fill in `seats`/`docket` for your preset below. Each preset needs its own
 * historically-accurate 9-seat Original Roster and its own Docket of real
 * landmark cases from that preset's start year to present — see
 * `src/lib/scotus/presetData/types.ts` for the shape, and the ahd-scotus-context
 * / ahd-scotus-adr-* docs in ops-knowledge for the full domain glossary + ADRs.
 * Until filled in, `seedScotus` no-ops for that preset (logs and returns) so
 * the seeding hook is safe to ship ahead of content.
 * ============================================================================
 */
export const SCOTUS_PRESET_DATA: Partial<Record<ResetPresetId, ScotusPresetSeed>> = {
  "1953-default": SCOTUS_1953_SEED, // #3599: 1953 Original Roster + Docket
  "1979-default": SCOTUS_1979_PRESET_SEED, // #3600: 1979 Original Roster + Docket
  "1991-default": SCOTUS_1991_PRESET_DATA, // #3601: 1991 Original Roster + Docket
  "2019-default": SCOTUS_2019_DEFAULT_SEED, // #3602: 2019-default Original Roster + Docket
};

export function getScotusPresetSeed(preset: string): ScotusPresetSeed | undefined {
  return SCOTUS_PRESET_DATA[preset as ResetPresetId];
}
