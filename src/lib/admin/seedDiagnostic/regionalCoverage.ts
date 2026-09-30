import type { Filter } from "mongodb";
import { NATIONAL_SCOPE } from "@/lib/constants/nationalScope";
import { STATE_IDS } from "@/lib/constants/states";
import { check } from "./checkFactory";
import type { SeedDiagnosticCheck } from "./types";

/** Validate identities, so an orphan cannot replace a missing regional row. */
export function regionalMetricCoverage(
  countryId: string,
  regionIds: readonly string[],
  metricIds: readonly string[]
): SeedDiagnosticCheck {
  const expected = new Set(regionIds);
  const counts = new Map<string, number>();
  for (const id of metricIds) {
    if (NATIONAL_SCOPE[id] === countryId) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const missing = [...expected].filter((id) => !counts.has(id)).sort();
  const orphan = [...counts.keys()].filter((id) => !expected.has(id)).sort();
  const duplicates = [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const covered = expected.size - missing.length;
  const problems = [
    missing.length ? `missing: ${missing.join(", ")}` : null,
    orphan.length ? `orphan: ${orphan.join(", ")}` : null,
    duplicates.length ? `duplicates: ${duplicates.join(", ")}` : null,
  ].filter(Boolean);
  return check(
    `regions.${countryId}.metrics`,
    countryId,
    "macroMetrics regional coverage",
    expected.size,
    covered,
    problems.length === 0 ? "ok" : covered === 0 && expected.size > 0 ? "critical" : "warn",
    problems.length
      ? problems.join("; ")
      : "all region identities covered; national summaries excluded"
  );
}

interface ScopedTurnoutRow {
  _id: string;
  countryId?: string | null;
}

/** Only canonical US state keys may use the supported missing-country scope. */
export function seedTurnoutScopeFilter(countryId: string): Filter<ScopedTurnoutRow> {
  if (countryId !== "US") return { countryId };
  return {
    $or: [{ countryId: "US" }, { countryId: null, _id: { $in: [...STATE_IDS, "DC"] } }],
  };
}
