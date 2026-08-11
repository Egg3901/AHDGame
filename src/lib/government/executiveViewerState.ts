/**
 * Typed client-side view of the `/api/country/[code]/executive` response
 * fields consumed by the legislature pages (UK/DE/JP/IE/devolved), plus the
 * mapping for the "Dissolve Parliament" (snap election) UI.
 *
 * Server semantics (src/app/api/country/[code]/executive/route.ts):
 * - `isPrimeMinister` — the viewer's character is the sitting PM
 *   (`govFormation.pmCharacterId` matches the viewer's character).
 * - `snapElectionsAllowed` — `supportsSnapElections(config) && isPrimeMinister`,
 *   i.e. "this viewer may call a snap election in this country". It is a
 *   composite permission flag, NOT a pure viewer-identity flag. The per-term
 *   limit and cooldown are reported separately (`snapElectionsRemaining`,
 *   `snapCooldownTurnsRemaining`) and gate the button's disabled state.
 *
 * Mapping `snapElectionsAllowed` onto "viewer is the sitting PM" (issue #2810)
 * silently conflated the two: a sitting PM in a country whose config disables
 * snap elections would read as "not the PM", and any server-side relaxation of
 * the composite flag would have shown the dissolve UI to non-PMs. Keep the two
 * concepts separate and gate the dissolve UI on both.
 */
import type {
  AppointmentVotePayload,
  NoConfidenceVotePayload,
} from "@/types/parliamentaryGovernment";

/** `government` object as serialized by the executive route (Dates → ISO strings). */
export type ExecutiveGovernmentPayload = {
  status: "pending" | "formed";
  formationType: "majority" | "coalition" | "minority" | "admin" | null;
  lostMajority: boolean;
  pmName: string | null;
  pmCharacterId: string | null;
  governingPartyId: string | null;
  coalitionId: number | null;
  coalitionPartyIds: string[] | null;
  totalSeatsSupporting: number;
  majorityThreshold: number;
  seatsByParty: Record<string, number>;
  totalSeats: number;
  formedAt: string | null;
} | null;

/**
 * Subset of the executive route's JSON response consumed by the legislature
 * pages. Fields are optional so partial/older payloads degrade to safe
 * defaults instead of throwing.
 */
export type ExecutiveGovernmentResponse = {
  government?: ExecutiveGovernmentPayload;
  activeAppointmentVotes?: AppointmentVotePayload[];
  activeNoConfidenceVote?: NoConfidenceVotePayload | null;
  viewerMayAppoint?: boolean;
  viewerMayProposeNoConfidence?: boolean;
  noConfidenceCooldownTurns?: number | null;
  viewerIsCommonsMp?: boolean;
  viewerVotes?: Record<string, "aye" | "nay">;
  viewerWhippedFrom?: Record<string, string>;
  isAdmin?: boolean;
  /** Viewer's character is the sitting PM. Use this for identity checks. */
  isPrimeMinister?: boolean;
  /** Country permits snap elections AND viewer is the sitting PM. */
  snapElectionsAllowed?: boolean;
  snapElectionsUsed?: number;
  snapElectionsRemaining?: number;
  snapCooldownTurnsRemaining?: number;
};

export type SnapElectionViewerState = {
  /** True iff the viewer is the sitting PM (from `isPrimeMinister`). */
  viewerIsSittingPM: boolean;
  /** True iff the viewer may call a snap election here (server composite flag). */
  snapElectionsAllowed: boolean;
  snapElectionsUsed: number;
  snapElectionsRemaining: number;
  snapCooldownTurnsRemaining: number;
};

/**
 * Normalize the executive response's snap-election fields for the legislature
 * pages. The dissolve-parliament UI should render when
 * `viewerIsSittingPM && snapElectionsAllowed` (and the government is formed);
 * the limit/cooldown counters only disable the button, not hide it.
 */
export function mapSnapElectionViewerState(
  data: ExecutiveGovernmentResponse | null | undefined
): SnapElectionViewerState {
  return {
    viewerIsSittingPM: data?.isPrimeMinister ?? false,
    snapElectionsAllowed: data?.snapElectionsAllowed ?? false,
    snapElectionsUsed: data?.snapElectionsUsed ?? 0,
    snapElectionsRemaining: data?.snapElectionsRemaining ?? 0,
    snapCooldownTurnsRemaining: data?.snapCooldownTurnsRemaining ?? 0,
  };
}
