/** Fixed diagnostics for acknowledged requests; never return a URL or arbitrary body text. */
const OPERATION_ROUTES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/api\/actions\/execute$/, "character_action_execute"],
  [/^\/api\/country\/[a-z]{2,3}\/parties$/i, "party_create"],
  [/^\/api\/country\/[a-z]{2,3}\/parties\/[^/]+\/influence$/i, "party_influence_national"],
  [
    /^\/api\/country\/[a-z]{2,3}\/region\/[^/]+\/party\/[^/]+\/influence$/i,
    "party_influence_regional",
  ],
  [
    /^\/api\/country\/[a-z]{2,3}\/region\/[^/]+\/party\/[^/]+\/recruitment$/i,
    "party_recruitment_regional",
  ],
  [
    /^\/api\/country\/[a-z]{2,3}\/region\/[^/]+\/party\/[^/]+\/org-building$/i,
    "party_org_building_regional",
  ],
  [
    /^\/api\/country\/[a-z]{2,3}\/region\/[^/]+\/party\/[^/]+\/leadership$/i,
    "party_leadership_regional",
  ],
  [
    /^\/api\/country\/[a-z]{2,3}\/region\/[^/]+\/party\/[^/]+\/primary-allocation$/i,
    "party_primary_allocation_regional",
  ],
  [
    /^\/api\/country\/[a-z]{2,3}\/region\/[^/]+\/party\/[^/]+\/build-org$/i,
    "party_build_org_regional",
  ],
];

// Deliberately separate from the request body: new schema values need an explicit analytics review.
const EXECUTE_ACTION_TYPES = new Set([
  "fundraise",
  "campaign",
  "advertise",
  "buildDonorBase",
  "poll",
  "pollLarge",
  "convertCash",
  "rest",
  "debatePrep",
]);

/** Supplement action_type without changing its existing route/body-action semantics. */
export function playerActionOperationProperties(
  pathname: string,
  method: string,
  body: Record<string, unknown> | null
): { action_operation: string; requested_action?: string } {
  const operation =
    method === "POST"
      ? (OPERATION_ROUTES.find(([pattern]) => pattern.test(pathname))?.[1] ?? "unknown")
      : "unknown";
  if (operation !== "character_action_execute") return { action_operation: operation };
  return {
    action_operation: operation,
    requested_action:
      typeof body?.actionType === "string" && EXECUTE_ACTION_TYPES.has(body.actionType)
        ? body.actionType
        : "unknown",
  };
}
