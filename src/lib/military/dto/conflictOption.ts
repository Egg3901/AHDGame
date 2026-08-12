/**
 * The minimum a picker needs to name a conflict and its two sides.
 *
 * Lives here rather than beside the route that serves it: a route module is not a
 * shared contract surface, and a component importing one drags a server module
 * into the client bundle (see the architecture audit's app-imports-route check).
 */
export interface ConflictOption {
  /** ConflictDoc._id — the theater key every lookup and assignment references. */
  id: string;
  /** The public sequential number, for display and URLs only. */
  conflictId: number;
  name: string;
  sideALabel: string;
  sideBLabel: string;
}
