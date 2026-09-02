import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  REGIONAL_SUPPLEMENT_FACTOR,
  PRIMARY_POINTS_PER_LEVEL,
} from "@/lib/politicalLegislation/dynamics";
import { getLaw } from "@/lib/politicalLegislation/catalog";
import { NATIONAL_BASELINES_1953 } from "../seeds/nationalBaselines1953";
import { POLITICAL_METRIC_FAMILIES } from "../families";
import type { PoliticalMetricId } from "../types";
import {
  loadRegionPoliticalMetrics,
  type RegionPoliticalMetricsResponse,
} from "./regionPoliticalMetrics";

function regionValues(overrides: Partial<Record<PoliticalMetricId, number>> = {}) {
  const values = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) {
    values[f.id] = overrides[f.id] ?? NATIONAL_BASELINES_1953.US[f.id].value;
  }
  return values;
}

const GA_WORKER_SECURITY = 57;
const NY_WORKER_SECURITY = 73;

const DOCS = [
  {
    _id: "GA",
    countryId: "US",
    values: regionValues({ "economy.workerSecurity": GA_WORKER_SECURITY }),
    labourResiduals: { "economy.workerSecurity": -1.5 },
  },
  {
    _id: "NY",
    countryId: "US",
    values: regionValues({ "economy.workerSecurity": NY_WORKER_SECURITY }),
  },
];

// Equal populations, so the national mean of the two is a plain average.
const STATES = [
  { _id: "GA", name: "Georgia", population: 1_000_000, gdp: 7_000 },
  { _id: "NY", name: "New York", population: 1_000_000, gdp: 30_000 },
];

const TRANSIT_LAW = "us.infrastructure.transit.primary";
const SCHOOLING_LAW = "us.education.universalSchooling.primary";
/** The authored national baseline getEnactedLevels falls back to. */
const NATIONAL_SCHOOLING_BASELINE = getLaw(SCHOOLING_LAW)?.baselineLevel ?? 0;

function findMetric(res: RegionPoliticalMetricsResponse, id: string) {
  for (const cat of res.categories) {
    const m = cat.metrics.find((x) => x.id === id);
    if (m) return m;
  }
  throw new Error(`metric ${id} not found`);
}

describe("loadRegionPoliticalMetrics", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalMetrics").find().toArray.mockResolvedValue(DOCS);
    db.collection("states").find().toArray.mockResolvedValue(STATES);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 575,
      currentYear: 1963,
      preset: "1953-default",
    });
    db.collection("politicalMetricsRegionHistory").findOne.mockResolvedValue(null);
    // statePolicies is read twice: national (getEnactedLevels) and region.
    db.collection("statePolicies").find = vi
      .fn()
      .mockImplementation((filter?: { scope?: string }) => ({
        toArray: vi
          .fn()
          .mockResolvedValue(
            filter?.scope === "state"
              ? [{ legislationTypeId: TRANSIT_LAW, policyOptionIndex: 4 }]
              : []
          ),
      }));
  });

  async function load(regionId = "GA") {
    return loadRegionPoliticalMetrics("US", regionId, db as unknown as Db);
  }

  it("returns null for a region with no board doc", async () => {
    expect(await load("ZZ")).toBeNull();
  });

  it("identifies the region and carries the country comparison", async () => {
    const res = (await load())!;
    expect(res.regionId).toBe("GA");
    expect(res.regionName).toBe("Georgia");
    expect(res.regionLabel).toBe("State");
    expect(res.turn).toBe(575);
    expect(res.nationalOverall).toBeGreaterThan(0);
  });

  it("carries the region value in `value` and the country value in `national`", async () => {
    const m = findMetric((await load())!, "economy.workerSecurity");
    expect(m.value).toBe(GA_WORKER_SECURITY);
    // Equal populations, so the national mean is the plain average of the two.
    expect(m.national).toBe((GA_WORKER_SECURITY + NY_WORKER_SECURITY) / 2);
  });

  it("scores categories from THIS region's values, not the national mean", async () => {
    const res = (await load())!;
    const economy = res.categories.find((c) => c.id === "economy")!;
    // GA sits below NY on the one overridden metric, so its category score must
    // come out below the national one rather than equal to it.
    expect(economy.score).toBeLessThan(economy.nationalScore);
  });

  it("builds `overall` the same way `nationalOverall` is built, from unrounded means", async () => {
    // The two sit beside each other in the masthead with a delta between them.
    // Averaging rounded category scores here and unrounded ones there would let
    // that delta disagree with the figures on either side of it.
    const res = (await load())!;
    const exact =
      res.categories.reduce((sum, c) => {
        const metricMean = c.metrics.reduce((s, m) => s + m.value, 0) / (c.metrics.length || 1);
        return sum + metricMean;
      }, 0) / res.categories.length;
    expect(res.overall).toBeCloseTo(Math.round(exact * 10) / 10, 5);
  });

  it("projects the executive tenure the governance card needs", async () => {
    // loadDemocraticCompetition reads gameState.presidentialTenureByCountry for
    // the continuity line. Projecting it away would score every region as if no
    // executive had ever been re-elected, silently disagreeing with the
    // national page.
    await load();
    const findOne = db.collectionMocks.gameState.findOne as ReturnType<typeof vi.fn>;
    const projection = findOne.mock.calls[0][1]?.projection;
    expect(projection).toHaveProperty("presidentialTenureByCountry");
  });

  it("scores governance style from THIS region's board", async () => {
    // Both halves of the card derive from the metric values, which are per
    // region — only the competition penalty inside democratic health is a
    // country figure. Omitting the card at region scope would have dropped a
    // panel the national registry shows for no good reason.
    const ga = (await load())!;
    const ny = (await load("NY"))!;
    expect(ga.governanceStyle?.name).toBe("Governance Style");
    expect(ga.governanceStyle?.leftRight.value).toBeGreaterThanOrEqual(0);
    expect(ga.governanceStyle?.democraticHealth.value).toBeGreaterThanOrEqual(0);
    // GA and NY differ on worker security, so their scores must not be identical
    // the way they would be if this were the national aggregate.
    expect(ga.governanceStyle?.leftRight.value).not.toBe(ny.governanceStyle?.leftRight.value);
  });

  it("keeps nine categories of seven lean-ordered metrics", async () => {
    const res = (await load())!;
    expect(res.categories).toHaveLength(9);
    for (const cat of res.categories) {
      expect(cat.metrics).toHaveLength(7);
      expect(cat.metrics.map((m) => m.lean)).toEqual([-5, -3, -1, 0, 1, 3, 5]);
    }
  });

  it("supplements the target with the region's OWN enacted levels at half strength", async () => {
    const transit = findMetric((await load())!, "infrastructure.transit");
    const row = transit.modifiers.regionalLaws.find((r) => r.lawId === TRANSIT_LAW);
    expect(row?.points).toBe(PRIMARY_POINTS_PER_LEVEL * 4 * REGIONAL_SUPPLEMENT_FACTOR);
  });

  it("shows the NATIONAL level for a law in force, not the region's empty row", async () => {
    // GA has no us.education.universalSchooling.primary row in this fixture, so
    // reading Relevant Legislation off the regional levels would render level 0
    // and claim the country has no such law at all. The law in force is the
    // national one; the region's own supplement is a modifiers row instead.
    const m = findMetric((await load())!, "education.universalSchooling");
    expect(m.legislation?.primary?.level).toBe(NATIONAL_SCHOOLING_BASELINE);
  });

  it("prices a national programme against the NATIONAL economy, not one region's", async () => {
    // Pricing a federal programme against Georgia alone would understate it by
    // orders of magnitude.
    const m = findMetric((await load())!, "education.universalSchooling");
    const net = m.legislation?.primary?.annualNet ?? 0;
    expect(Math.abs(net)).toBeGreaterThan(0);
    // The two-region fixture's national GDP is the sum, so the figure must be
    // strictly larger in magnitude than the GA-only pricing would give.
    const gaShare = 7_000 / (7_000 + 30_000);
    expect(Math.abs(net) * gaShare).toBeLessThan(Math.abs(net));
  });

  it("surfaces the labour channel the engine already applies", async () => {
    const m = findMetric((await load())!, "economy.workerSecurity");
    expect(m.modifiers.labour).toBe(-1.5);
  });

  it("serves an empty history when the region has no entries yet", async () => {
    const m = findMetric((await load())!, "economy.workerSecurity");
    expect(m.history).toEqual([]);
  });

  it("serves the region's own history series when it exists", async () => {
    db.collection("politicalMetricsRegionHistory").findOne.mockResolvedValue({
      _id: "GA",
      countryId: "US",
      entries: [{ turn: 552, values: { "economy.workerSecurity": 56.54 } }],
    });
    const m = findMetric((await load())!, "economy.workerSecurity");
    expect(m.history).toEqual([{ turn: 552, value: 56.5 }]);
  });

  it("lists every region in the peer breakdown, sorted by value", async () => {
    const m = findMetric((await load())!, "economy.workerSecurity");
    expect(m.regions).toEqual([
      { regionId: "NY", name: "New York", value: NY_WORKER_SECURITY },
      { regionId: "GA", name: "Georgia", value: GA_WORKER_SECURITY },
    ]);
  });

  it("uses early-era indicators for a 1963 world", async () => {
    const m = findMetric((await load())!, "economy.workerSecurity");
    expect(m.indicators).toContain("Strike settlement rate");
    expect(m.indicators).not.toContain("Gig-work coverage");
  });
});
