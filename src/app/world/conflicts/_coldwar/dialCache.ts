import { writePersistedNumber } from "./persisted";
import type { ColdWarDials } from "@/lib/coldwar/dials";

/**
 * The localStorage keys the Cold War console's boards read their dials from, and
 * the one writer that fills them from the server.
 *
 * These are the console's own keys, already read by every board: `ahd_defcon` by
 * the DEFCON readout, the detente board's stand-down gate and the whole home
 * front metric computation; the two cohesion keys by the proxy-war supply model
 * and the crisis board's credibility multiplier. Writing them is therefore not
 * decoration. A war on the ladder really does drop readiness, really does change
 * what a bloc can supply, really does harden the home front and really does close
 * off the stand-down the detente board offers.
 *
 * They are a CACHE. The server reading is the source of truth and overwrites them
 * on every load of the section (see ColdWarDialHydrator). A board's own in-session
 * adjustment survives until the next load, which is the existing behaviour and not
 * something this changes.
 */
export const CW_DIAL_KEYS = {
  defcon: "ahd_defcon",
  westCohesion: "ahd_west_cohesion",
  eastCohesion: "ahd_east_cohesion",
} as const;

/** Fill the cache from a server reading. The only writer of these three keys. */
export function writeColdWarDialCache(
  dials: Pick<ColdWarDials, "defcon" | "cohesionWest" | "cohesionEast">
): void {
  writePersistedNumber(CW_DIAL_KEYS.defcon, dials.defcon);
  writePersistedNumber(CW_DIAL_KEYS.westCohesion, dials.cohesionWest);
  writePersistedNumber(CW_DIAL_KEYS.eastCohesion, dials.cohesionEast);
}
