import type { BillStatus } from "@/lib/db/types/legislation";

export type LegislatureBillStatusFilter = "all" | "voting" | "passed" | "failed";

const PASSED_STATUSES = new Set<BillStatus | string>(["passed_origin", "signed", "enacted"]);
const FAILED_STATUSES = new Set<BillStatus | string>([
  "failed",
  "override_failed",
  "withdrawn",
  "vetoed",
]);

export function matchesLegislatureBillStatusFilter(
  status: BillStatus | string,
  filter: LegislatureBillStatusFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "passed") return PASSED_STATUSES.has(status);
  if (filter === "failed") return FAILED_STATUSES.has(status);
  return !PASSED_STATUSES.has(status) && !FAILED_STATUSES.has(status);
}
