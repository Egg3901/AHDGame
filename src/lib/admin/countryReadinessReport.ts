import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_READINESS_EXPECTATIONS,
  type ReadinessCheck,
} from "@/lib/constants/countryReadinessExpectations";
import { expectedRegionCount } from "@/lib/admin/seedDiagnostic/expectations";

/** Best-effort preset lookup; null when the world has no gameState yet. */
async function readPreset(db: Db): Promise<string | null> {
  const gs = await db
    .collection<{ preset?: string }>("gameState")
    .findOne({ _id: "current" as never });
  return typeof gs?.preset === "string" ? gs.preset : null;
}

export interface CountryReadinessReport {
  ready: boolean;
  summary: { ok: number; warning: number; missing: number };
  checks: ReadinessCheck[];
}

/**
 * Generate a per-country readiness report. Driven by
 * COUNTRY_READINESS_EXPECTATIONS so every supported country gets the same
 * diagnostic.
 *
 * Returns null when the country has no expectations entry (caller should
 * 404). Reads only — never writes.
 *
 * `preset` makes the region-derived expectations era-aware. The entries in
 * COUNTRY_READINESS_EXPECTATIONS describe the modern world, but region counts
 * are era-dependent — 1953/1979 seed the 11 western Länder while 1991+ seed the
 * reunified 16 — so a flat expectation reports a correct historical seed as
 * incomplete. Pass it when the caller knows the preset; otherwise it is read
 * from gameState, and when neither is available the authored entry is used
 * as-is rather than assuming a modern default.
 */
export async function buildCountryReadinessReport(
  db: Db,
  countryId: CountryId,
  preset?: string
): Promise<CountryReadinessReport | null> {
  const expect = COUNTRY_READINESS_EXPECTATIONS[countryId];
  if (!expect) return null;

  const resolvedPreset = preset ?? (await readPreset(db));
  // null when the country has no registered era bundle — keep the static entry.
  const eraRegions = resolvedPreset ? expectedRegionCount(countryId, resolvedPreset) : null;

  const checks: ReadinessCheck[] = [];

  const expectedRegions = eraRegions ?? expect.regionCount;
  const regionCount = await db.collection("states").countDocuments({ countryId });
  checks.push({
    name: "Regions",
    status: regionCount === expectedRegions ? "ok" : regionCount > 0 ? "warning" : "missing",
    count: regionCount,
    detail: `Expected ${expectedRegions}, found ${regionCount}`,
  });

  const partyCount = await db.collection("politicalParties").countDocuments({ countryId });
  checks.push({
    name: "Parties",
    status:
      partyCount >= expect.partyMin
        ? "ok"
        : partyCount > 0 || expect.partyMin === 0
          ? "warning"
          : "missing",
    count: partyCount,
    detail: `Expected ≥${expect.partyMin} (${expect.partyRoster}), found ${partyCount}`,
  });

  const orgCount = await db.collection("statePartyOrg").countDocuments({ countryId });
  checks.push({
    name: "StatePartyOrg",
    status:
      orgCount >= expect.statePartyOrgMin
        ? "ok"
        : orgCount > 0 || expect.statePartyOrgMin === 0
          ? "warning"
          : "missing",
    count: orgCount,
    detail: `Expected ≥${expect.statePartyOrgMin}, found ${orgCount}`,
  });

  const seatCount = await db.collection("seats").countDocuments({ countryId });
  checks.push({
    name: "Seats",
    status:
      seatCount >= expect.seatMin
        ? "ok"
        : seatCount > 0 || expect.seatMin === 0
          ? "warning"
          : "missing",
    count: seatCount,
    detail: `${expect.seatNote}, found ${seatCount}`,
  });

  const nppCount = await db.collection("npps").countDocuments({ countryId });
  checks.push({
    name: "NPPs",
    status:
      nppCount >= expect.nppMin
        ? "ok"
        : nppCount > 0 || expect.nppMin === 0
          ? "warning"
          : "missing",
    count: nppCount,
    detail: `${expect.nppNote}, found ${nppCount}`,
  });

  const officialCount = await db.collection("electedOfficials").countDocuments({ countryId });
  checks.push({
    name: "ElectedOfficials",
    status:
      officialCount >= expect.officialMin
        ? "ok"
        : officialCount > 0 || expect.officialMin === 0
          ? "warning"
          : "missing",
    count: officialCount,
    detail: `Expected ≥${expect.officialMin}, found ${officialCount}`,
  });

  const expectedDemographics = eraRegions ?? expect.demographicsCount;
  const demoCount = await db.collection("stateDemographics").countDocuments({ countryId });
  checks.push({
    name: "Demographics",
    status: demoCount === expectedDemographics ? "ok" : demoCount > 0 ? "warning" : "missing",
    count: demoCount,
    detail: `Expected ${expectedDemographics}, found ${demoCount}`,
  });

  // macroMetrics, not stateMetrics: the legacy collection stopped being written
  // in step-6 Phase 3, so counting it reported EVERY country as missing its
  // region metrics. macroMetrics is where seeded region metrics live now.
  const expectedMetrics = eraRegions ?? expect.stateMetricsCount;
  const metricsCount = await db
    .collection<{ _id: string }>("macroMetrics")
    .countDocuments(expect.stateMetricsFilter);
  checks.push({
    name: "RegionMetrics",
    status: metricsCount >= expectedMetrics ? "ok" : metricsCount > 0 ? "warning" : "missing",
    count: metricsCount,
    detail: `Expected ≥${expectedMetrics}, found ${metricsCount}`,
  });

  // legislationTypes docs carry `countryScope` (lowercase id), never `countryId`.
  const legTypeCount = await db
    .collection("legislationTypes")
    .countDocuments({ countryScope: countryId.toLowerCase() });
  checks.push({
    name: "LegislationTypes",
    status:
      legTypeCount >= expect.legislationTypesMin
        ? "ok"
        : legTypeCount > 0 || expect.legislationTypesMin === 0
          ? "warning"
          : "missing",
    count: legTypeCount,
    detail: `Found ${legTypeCount} ${countryId} legislation types`,
  });

  if (expect.extras) {
    for (const extra of expect.extras) {
      checks.push(await extra(db));
    }
  }

  const ok = checks.filter((c) => c.status === "ok").length;
  const warning = checks.filter((c) => c.status === "warning").length;
  const missing = checks.filter((c) => c.status === "missing").length;
  return {
    ready: missing === 0 && warning === 0,
    summary: { ok, warning, missing },
    checks,
  };
}
