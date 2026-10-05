import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { discoverCollectionCalls } from "../../../../scripts/architecture/collectionDiscovery";
import { LEGACY_DYNAMIC_COLLECTION_SITES } from "../../../../scripts/architecture/collectionDiscoveryExceptions";
import { getCollectionCategory, SEED_MANIFEST } from "./seedManifest";

type DiscoveryFixtureDb = {
  collection(name: "fixtureLiteral" | "fixtureUnionA" | "fixtureUnionB"): unknown;
};

function discoveryFixture(db: DiscoveryFixtureDb, choice: "fixtureUnionA" | "fixtureUnionB"): void {
  db.collection("fixtureLiteral");
  db.collection(choice);
}

function discoveryDynamicFixture(db: { collection(name: string): unknown }, name: string): void {
  db.collection(name);
}

function discoveryForwarder(
  db: { collection(name: string): unknown },
  collectionName: string
): void {
  db.collection(collectionName);
}

function discoveryForwarderCallsites(
  db: { collection(name: string): unknown },
  dynamicCollectionName: string
): void {
  discoveryForwarder(db, "fixtureForwardedLiteral");
  discoveryForwarder(db, dynamicCollectionName);
}

describe("seed manifest source discovery", () => {
  const repositoryRoot = process.cwd();
  const discovery = discoverCollectionCalls(repositoryRoot, [fileURLToPath(import.meta.url)]);
  const testFile = fileURLToPath(import.meta.url).replace(`${repositoryRoot}/`, "");
  const productionCalls = discovery.calls.filter(
    (call) => call.file.startsWith("src/") && call.file !== testFile
  );
  const productionUnresolved = discovery.unresolved.filter(
    (call) => call.file.startsWith("src/") && call.file !== testFile
  );
  const discoveredNames = new Set(productionCalls.flatMap((call) => call.names));
  const missing = [...discoveredNames].filter((name) => !getCollectionCategory(name)).sort();

  it("classifies every collection name used by production src", () => {
    expect(missing, `unclassified production collection names: ${missing.join(", ")}`).toEqual([]);
  });

  it("wipes every audited world collection and preserves operational records", () => {
    for (const name of [
      "truces",
      "vietnamEscalation",
      "appliedWorldTransitions",
      "sphereFlowLedger",
      "bankingTelemetry",
      "acquisitionSettlements",
      "mergerReviews",
      "indexListingPetitions",
      "speakerLeadershipBallots",
      "senateLeadershipBallots",
      "bargainingRatificationBallots",
      "balanceSnapshotCheckpoints",
      "equityLiquidityFacilitySnapshots",
      "nppOperatorDiagnostics",
      "capacityDecisionFunnels",
      "bondSaleIntents",
      "ngChamberLeadershipElections",
      "ngChamberLeadershipNominations",
    ]) {
      expect(getCollectionCategory(name), name).toBe("runtime");
    }
    for (const name of [
      "authSourceOwnershipProofs",
      "broadcastDms",
      "healBackups",
      "healRuns",
      "healTokens",
      "passwordResets",
      "sourceFenceConsumptions",
      "sourceFenceReceipts",
    ]) {
      expect(getCollectionCategory(name), name).toBe("preserved");
    }
  });

  it("reports broad string parameters for exact review", () => {
    const fixture = discovery.unresolved.find(
      (call) => call.file === testFile && call.argument === "name"
    );
    expect(fixture).toMatchObject({ owner: "discoveryDynamicFixture", type: "string" });
    expect(productionUnresolved.every((call) => call.file !== testFile)).toBe(true);
    expect(
      discovery.unresolved.some(
        (call) =>
          call.file === testFile &&
          call.owner === "discoveryForwarder" &&
          call.argument === "collectionName"
      )
    ).toBe(true);
  });

  it("requires review when a dynamic collection site changes or is added", () => {
    const counts = new Map<string, number>();
    for (const { file, owner, argument, scopeHash } of productionUnresolved) {
      const key = JSON.stringify([file, owner, argument, scopeHash]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const actual = [...counts]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const expected = LEGACY_DYNAMIC_COLLECTION_SITES.map(
      ({ file, owner, argument, scopeHash, count }) => ({
        key: JSON.stringify([file, owner, argument, scopeHash]),
        count,
      })
    ).sort((a, b) => a.key.localeCompare(b.key));
    expect(actual).toEqual(expected);
  });

  it("finds literal and finite-union function-parameter fixture patterns", () => {
    const fixtureCalls = discovery.calls.filter((call) =>
      call.file.includes("seedManifestDiscovery.test.ts")
    );
    expect(fixtureCalls.flatMap((call) => call.names)).toEqual([
      "fixtureLiteral",
      "fixtureUnionA",
      "fixtureUnionB",
      "fixtureForwardedLiteral",
    ]);
    expect(
      fixtureCalls.flatMap((call) => call.names).every((name) => !getCollectionCategory(name))
    ).toBe(true);
    expect(SEED_MANIFEST.some((entry) => entry.name === "fixtureLiteral")).toBe(false);
  });
});
