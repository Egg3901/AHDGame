import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCollectionCategory,
  getRuntimeCollectionNames,
  getReferenceCollectionNames,
  getPreservedCollectionNames,
} from "./seedManifest";

const COLLECTIONS_DIR = join(process.cwd(), "src/lib/db/collections");

/**
 * A collection missing from SEED_MANIFEST is invisible to `resetGameWorld`,
 * which sweeps `getRuntimeCollectionNames()` — so it silently survives every
 * world reset. `covertNuclearPrograms` did exactly that: per-country covert
 * programme stage, progress and breakout turn carried across resets, so a
 * fresh world could open with a country already mid-breakout (flagged in
 * #1246, fixed here).
 *
 * Nothing caught the omission, because the reset tests iterate the manifest —
 * they verify what IS classified, never what is missing. This closes that by
 * walking the other way: every collection name a `src/lib/db/collections/`
 * module declares must carry a manifest classification.
 */
describe("seed manifest classification coverage", () => {
  it("wipes funded bank-failure receipts with the world they belong to", () => {
    expect(getCollectionCategory("bankFailurePoliticalEvents")).toBe("runtime");
    expect(getRuntimeCollectionNames()).toContain("bankFailurePoliticalEvents");
  });
  it("resets the federation publication and protected-choice journals", () => {
    for (const name of [
      "russianConstitutionalProposals",
      "russianPresidentialElectionResults",
      "russianPresidentialOfficeArchives",
      "russianDumaElectionResults",
      "russianDumaRepeatOpenings",
      "russianCouncilElectionOpenings",
      "russianCouncilElectionResults",
      "russianAssemblySeatings",
      "russianDumaConvocations",
      "russianCouncilFormationProposals",
      "russianRegionalAuthorities",
      "russianCouncilCompositionSeatings",
      "russianAssemblyOfficeArchives",
      "federationRelocations",
      "federationPublicationPreparations",
      "federationPreparedEffects",
      "federationArchivedRegionRows",
      "federationArchivedPoliticalRows",
      "federationCustodyRecords",
      "federationArchivedPublicCorporations",
      "federationPublicCorporationRebases",
      "federationPrivateFirmHolds",
      "federationResidentHolds",
      "federationFiscalAccounts",
      "federationLegacyServiceTurns",
      "federationContinuingServiceTurns",
      "federationFacilityClaims",
      "federationFacilityPaymentTurns",
    ]) {
      expect(getCollectionCategory(name)).toBe("runtime");
    }
  });
  const declared = readdirSync(COLLECTIONS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => {
      const src = readFileSync(join(COLLECTIONS_DIR, f), "utf8");
      return [...src.matchAll(/export const [A-Z0-9_]*COLLECTION[A-Z0-9_]* = "([^"]+)"/g)].map(
        (m) => ({ file: f, name: m[1] })
      );
    });

  it("finds the declared collection constants to check", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it.each(declared)("classifies $name (declared in $file)", ({ name }) => {
    expect(
      getCollectionCategory(name),
      `collection "${name}" has no SEED_MANIFEST entry, so resetGameWorld will never wipe it — add it to SEED_MANIFEST`
    ).toBeDefined();
  });
});

describe("runtime lifecycle category determines reset selection", () => {
  it.each([
    "conflicts",
    "peaceOffers",
    "politicalMetricsHistory",
    "politicalMetricsRegionHistory",
    "politicalCabinetContribution",
    "nationalManpower",
    "regionalBudgets",
    "unions",
    "unionEndorsements",
    "unionLeaderVotes",
    "unionOrganizers",
    "bargainingCampaigns",
    "collectiveAgreements",
    "manufacturingProductProjectsV2",
    "landeslisten",
    "fundFloatSettlements",
    "bg1991ListReplacements",
    "bgGrandConstituencyByElections",
  ])("wipes %s instead of treating it as reference data", (name) => {
    expect(getCollectionCategory(name)).toBe("runtime");
    expect(getRuntimeCollectionNames()).toContain(name);
    expect(getReferenceCollectionNames()).not.toContain(name);
    expect(getPreservedCollectionNames()).not.toContain(name);
  });

  it.each([
    // Wiki
    "wikiPages",
    "wikiTemplates",
    "wikiReports",
    "manualOfficeHistory",
    "politicianOverrides",
    "eventDefinitions",
    // Accounts, sessions, bans
    "users",
    "unifiedSessions",
    "bannedIps",
    "userApiKeys",
    "userSubscriptions",
    // Identity and moderation evidence
    "identityObservations",
    "altLinks",
    "altClusters",
    "suspiciousCharacters",
    "modAuditLog",
    "adminLogs",
    "playerMailReports",
    "playerContentReports",
    // Site analytics and staff tooling
    "siteTrafficPageviews",
    "codeQualitySnapshots",
    "apiAccessLog",
  ])("keeps cross-game collection %s out of the reset sweep", (name) => {
    expect(getCollectionCategory(name)).toBe("preserved");
    expect(getRuntimeCollectionNames()).not.toContain(name);
  });

  it("preserves Patreon leases and support audit history across world resets", () => {
    for (const name of ["cronLocks", "patreonReconcileUnmatched", "patreonReconcileRuns"]) {
      expect(getCollectionCategory(name)).toBe("preserved");
      expect(getPreservedCollectionNames()).toContain(name);
      expect(getRuntimeCollectionNames()).not.toContain(name);
      expect(getReferenceCollectionNames()).not.toContain(name);
    }
  });

  it("keeps actual world reference and account collections in their own lifecycle", () => {
    expect(getReferenceCollectionNames()).toContain("states");
    expect(getRuntimeCollectionNames()).not.toContain("states");
    expect(getPreservedCollectionNames()).toContain("users");
    expect(getRuntimeCollectionNames()).not.toContain("users");
  });
});
