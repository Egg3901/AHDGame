import { writePersistedNumber } from "./persisted";
import type { VietnamDials } from "@/lib/crises/vietnamEscalation";

/**
 * Push the Vietnam ladder's derived dials into the Cold War console's shared
 * state.
 *
 * These four keys are the console's own dials, already read by every board:
 * `ahd_defcon` by the DEFCON readout, the detente board's stand-down gate and
 * the home front's whole metric computation; the two cohesion keys by the
 * proxy-war supply model and by the crisis board's credibility multiplier. So
 * writing them is not decoration: an escalating war really does drop readiness,
 * really does change what a bloc can supply, really does harden the home front
 * and really does close off the stand-down the detente board offers.
 *
 * The server ladder is the source of truth. The console is a view of it.
 */
export const VIETNAM_DIAL_KEYS = {
  defcon: "ahd_defcon",
  westCohesion: "ahd_west_cohesion",
  eastCohesion: "ahd_east_cohesion",
} as const;

export function syncVietnamDials(dials: VietnamDials): void {
  writePersistedNumber(VIETNAM_DIAL_KEYS.defcon, dials.defcon);
  writePersistedNumber(VIETNAM_DIAL_KEYS.westCohesion, dials.cohesionWest);
  writePersistedNumber(VIETNAM_DIAL_KEYS.eastCohesion, dials.cohesionEast);
}
