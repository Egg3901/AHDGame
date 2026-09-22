import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { countriesByTier, tierFor, type ShippingPreset } from "@/lib/world/eraRoster";
import { getPresetMonetaryScope } from "@/lib/monetaryPolicy/presetMonetaryScope";

/**
 * ⚠️ Any seed-path code reaching for `getDb()` instead of taking the `db`
 * argument must land in the SAME in-memory database. `isLayer1PositionsEnabled`
 * does exactly that, and without this mock it would write to whatever
 * `MONGODB_URI` names - in this checkout, the shared Atlas testing cluster.
 */
vi.mock("@/lib/mongodb", async () => {
  const fixture = await import("@/lib/test-utils/__fixtures__/bootstrapProbe");
  return { getDb: vi.fn(async () => fixture.currentProbeDb()) };
});

/**
 * Post-seed verification: does a world that actually BUILT match what its era
 * roster says it should be?
 *
 * The static checks (S1 to S6) read declarations. This reads the built world,
 * which is the only thing that catches a seeder mishandling correct data -
 * authored party rosters were right all along, and six seeders wrote them into
 * the wrong eras anyway.
 *
 * The absence assertions are the load-bearing half. Every other check asks
 * whether data is present; asking whether it is ABSENT is what would have found
 * the eleven leaking policy blocks and the East German parties, neither of which
 * any presence check could see.
 *
 * ⚠️ `inMemoryDb`, never Atlas. The free tier caps at 500 collections
 * CLUSTER-WIDE with 224 already resident, and a bootstrapped world is roughly
 * 250 to 330. Tripping it blocks writes across the cluster, including the
 * testing world the dev server uses.
 *
 * ⚠️ Slow by nature: a Cold-War bootstrap takes ~30s. Limited to the three
 * presets that matter - the two the next reset targets plus 1953, the most
 * heavily seeded - rather than all seven. 1999/2007/2023 are unauthored
 * skeletons that cannot be reset into at all (Plan B, S2), so bootstrapping
 * them would cost two more minutes to assert almost nothing.
 */
const PRESETS: ShippingPreset[] = ["1953-default", "1991-default", "2019-default"];

/** Collections a country's presence or absence shows up in. */
const COUNTRY_SCOPED = [
  "politicalParties",
  "states",
  "statePolicies",
  "electedOfficials",
  "npps",
  "statePartyOrg",
] as const;

interface Built {
  db: Db;
  counts: Record<string, Record<string, number>>;
}

const built = new Map<string, Built>();

beforeAll(async () => {
  const { probeBootstrap } = await import("@/lib/test-utils/__fixtures__/bootstrapProbe");
  for (const preset of PRESETS) {
    const { db } = await probeBootstrap(preset);
    const counts: Record<string, Record<string, number>> = {};
    for (const collection of COUNTRY_SCOPED) {
      counts[collection] = {};
      for (const country of COUNTRY_ORDER) {
        counts[collection][country] = await db.collection(collection).countDocuments({
          countryId: country,
        });
      }
    }
    built.set(preset, { db, counts });
  }
}, 600_000);

describe("a bootstrapped world matches its era roster", () => {
  it.each(PRESETS)("%s seeds nothing for a country the era does not contain", (preset) => {
    const { counts } = built.get(preset)!;
    const leaks: string[] = [];
    for (const country of countriesByTier(preset, "absent")) {
      for (const collection of COUNTRY_SCOPED) {
        const n = counts[collection][country] ?? 0;
        if (n > 0) leaks.push(`${country} has ${n} ${collection}`);
      }
    }
    expect(leaks, leaks.join("; ")).toEqual([]);
  });

  it.each(PRESETS)("%s seeds parties and regions for every live country", (preset) => {
    const { counts } = built.get(preset)!;
    const missing: string[] = [];
    for (const country of COUNTRY_ORDER) {
      const tier = tierFor(preset, country);
      if (tier !== "player" && tier !== "econ") continue;
      if ((counts.states[country] ?? 0) === 0) missing.push(`${country} has no regions`);
      if ((counts.politicalParties[country] ?? 0) === 0) missing.push(`${country} has no parties`);
    }
    expect(missing, missing.join("; ")).toEqual([]);
  });

  it.each(PRESETS)("%s writes an enablement row matching the roster tier", async (preset) => {
    const { db } = built.get(preset)!;
    const wrong: string[] = [];
    for (const country of COUNTRY_ORDER) {
      // The US runs off the global GameState and has no row by design.
      if (country === "US") continue;
      const row = await db
        .collection<{ _id: string; enabledForPlayers?: boolean; absentInEra?: boolean }>(
          "countryGameStates"
        )
        .findOne({ _id: country as unknown as string });
      if (!row) {
        wrong.push(`${country} has no countryGameStates row`);
        continue;
      }
      const tier = tierFor(preset, country as CountryId);
      if (Boolean(row.enabledForPlayers) !== (tier === "player")) {
        wrong.push(`${country} enabledForPlayers=${row.enabledForPlayers} for tier ${tier}`);
      }
      if (Boolean(row.absentInEra) !== (tier === "absent")) {
        wrong.push(`${country} absentInEra=${row.absentInEra} for tier ${tier}`);
      }
    }
    expect(wrong, wrong.join("; ")).toEqual([]);
  });

  it.each(PRESETS)("%s gives every central bank a national fiscal document", async (preset) => {
    const { db } = built.get(preset)!;
    const banks = await db
      .collection<{ countryId: CountryId }>("centralBanks")
      .find({}, { projection: { countryId: 1 } })
      .toArray();
    const budgets = await db
      .collection<{ countryId: CountryId }>("federalBudget")
      .find({}, { projection: { countryId: 1 } })
      .toArray();
    const banked = banks.map(({ countryId }) => countryId);
    const budgeted = new Set(budgets.map(({ countryId }) => countryId));
    const scope = getPresetMonetaryScope(preset);

    expect(banked).toEqual(expect.arrayContaining(scope.centralBankCountries));
    expect(banked.every((countryId) => budgeted.has(countryId))).toBe(true);
    for (const { countryId } of scope.exclusions) expect(banked).not.toContain(countryId);
  });

  it("creates no East German party in a world after reunification", async () => {
    // End-to-end proof of the claim the changelog makes. Asserted on the BUILT
    // world, not on the seeder: `seedDDParties` is only one of the paths that
    // could put these rows there.
    for (const preset of ["1991-default", "2019-default"] as const) {
      const { counts } = built.get(preset)!;
      expect(counts.politicalParties.DD ?? 0, preset).toBe(0);
    }
    // And the control: 1953 does seed them, so the assertion above is not
    // passing because East Germany never seeds anywhere.
    expect(built.get("1953-default")!.counts.politicalParties.DD ?? 0).toBeGreaterThan(0);
  });
});
