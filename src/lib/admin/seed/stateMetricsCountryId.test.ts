/**
 * Contract: every per-country state-metrics seeder must stamp `countryId` on
 * the documents it upserts.
 *
 * The source metrics data modules (cn/br/ie/jp/uk) omit `countryId`. After the
 * country-scope query hardening, region lookups filter by `{ _id, countryId }`,
 * so an un-stamped document is invisible and the page shows "—" for approval.
 * These seeders inject the field at upsert time; this test pins that in place.
 *
 * Asserted on macroMetrics since step-6 Phase 3: every seeded country has a
 * political board, so `splitMetricsDoc` drops the political half and
 * macroMetrics is the only store these seeders still write. The stamping
 * contract itself is unchanged — only which store carries it.
 */

import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, bulkOps } from "@/lib/test-utils/mockDb";
import { seedCNStateMetrics } from "./seedCN";
import { seedBRStateMetrics } from "./seedBR";
import { seedIEStateMetrics } from "./seedIE";
import { seedJPStateMetrics } from "./seedJP";
import { seedUKStateMetrics } from "./seedUK";

type MetricsSeeder = (
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) => Promise<void>;

const noop = () => {};

async function countryIdsStampedBy(seeder: MetricsSeeder, preset: string): Promise<Set<string>> {
  const mock = createMockDb();
  // reset=false so the seeder skips the destructive deleteMany and goes
  // straight to the upsert loop we want to inspect.
  await seeder(mock as unknown as Db, false, noop, preset);

  const calls = bulkOps(mock.collectionMocks.macroMetrics!.bulkWrite);
  const ids = new Set<string>();
  for (const call of calls) {
    const update = call[1] as { $set?: { countryId?: string } } | undefined;
    if (update?.$set?.countryId) ids.add(update.$set.countryId);
  }
  return ids;
}

describe("state-metrics seeders stamp countryId", () => {
  it.each([
    ["CN", seedCNStateMetrics, "1991-default"],
    ["CN", seedCNStateMetrics, "2019-default"],
    ["BR", seedBRStateMetrics, "2019-default"],
    ["IE", seedIEStateMetrics, "2019-default"],
    ["JP", seedJPStateMetrics, "2019-default"],
  ])("%s seeder stamps countryId on every upsert (%s)", async (cc, seeder, preset) => {
    const mock = createMockDb();
    await (seeder as MetricsSeeder)(mock as unknown as Db, false, noop, preset);
    // Step-6 Phase 3: every seeded country has a political board, so
    // splitMetricsDoc drops the political half and macroMetrics is the only
    // store these seeders still write. The stamping contract is unchanged —
    // only which store carries it.
    expect(mock.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
    const calls = bulkOps(mock.collectionMocks.macroMetrics!.bulkWrite);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const update = call[1] as { $set?: { countryId?: string } } | undefined;
      expect(update?.$set?.countryId).toBe(cc);
    }
  });

  it("UK behaves the same — it was simply the FIRST country to lose its political half", async () => {
    const mock = createMockDb();
    await (seedUKStateMetrics as MetricsSeeder)(mock as unknown as Db, false, noop, "2019-default");
    expect(mock.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
    const macroCalls = bulkOps(mock.collectionMocks.macroMetrics!.bulkWrite);
    expect(macroCalls.length).toBeGreaterThan(0);
    for (const call of macroCalls) {
      const update = call[1] as { $set?: { countryId?: string } } | undefined;
      expect(update?.$set?.countryId).toBe("UK");
    }
  });

  it("CN seeder stamps exactly one countryId value", async () => {
    expect(await countryIdsStampedBy(seedCNStateMetrics, "1991-default")).toEqual(new Set(["CN"]));
  });
});
