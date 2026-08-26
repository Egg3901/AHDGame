import type { ActiveModifier } from "@/lib/utils/approvalModifiers";

/**
 * Combine the two sources of national approval modifiers this page can read.
 *
 * The metrics endpoint recomputes metric conditions live and is preferred for
 * those. It does NOT carry the national providers — the head-of-government
 * address bump, international joint statements, and the war block — because
 * those read conflicts, personnel and org state, which is turn-phase work
 * rather than page-render work. They are stored by the snapshot and arrive
 * through the approval endpoint alone.
 *
 * Preferring one source outright, as this page used to, silently dropped every
 * one of them: a player would watch approval fall through a long war with
 * nothing on screen to explain it.
 *
 * Only NON-metric modifiers are appended. Both endpoints derive metric
 * conditions from the same evaluator, so taking the metrics endpoint's copy
 * wholesale is right and appending the approval endpoint's would risk showing a
 * condition from an older snapshot beside a freshly recomputed set. The id
 * check is a second guard against listing the same effect twice.
 */
export function mergeApprovalModifiers(
  fromMetrics: ActiveModifier[] | undefined,
  fromApproval: ActiveModifier[] | undefined
): ActiveModifier[] {
  const stored = fromApproval ?? [];
  if (!fromMetrics) return stored;

  const seen = new Set(fromMetrics.map((modifier) => modifier.id));
  const national = stored.filter(
    (modifier) => modifier.source !== "metric" && !seen.has(modifier.id)
  );
  return [...fromMetrics, ...national];
}
