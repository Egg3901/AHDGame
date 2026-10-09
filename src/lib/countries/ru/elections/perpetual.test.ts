import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const ruElectionsLive = vi.fn();
const loadRuntimeCountryOffices = vi.fn();
const ensureRegionalDelegateElections = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/perpetualElections/shared", () => ({
  ruElectionsLive: (...args: unknown[]) => ruElectionsLive(...args),
  ensureRegionalDelegateElections: (...args: unknown[]) => ensureRegionalDelegateElections(...args),
  ensureRegionalGovernorElections: vi.fn(),
  seatsFromRegionField: (regions: { _id: string; houseDistricts?: number }[]) =>
    Object.fromEntries(regions.map((r) => [r._id, r.houseDistricts ?? 0])),
}));
vi.mock("@/lib/countries/runtimeOffices", () => ({
  loadRuntimeCountryOffices: (...args: unknown[]) => loadRuntimeCountryOffices(...args),
}));

const { ruUnionCongressLive, ensureRUUnionCongressElections } = await import("./perpetual");
const db = {} as Db;

describe("RU Union Congress elections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs while the Union Congress is the live lower chamber", async () => {
    ruElectionsLive.mockResolvedValue(true);
    loadRuntimeCountryOffices.mockResolvedValue({ lowerOfficeType: "unionCongressDeputy" });
    await expect(ruUnionCongressLive(db)).resolves.toBe(true);
  });

  it("stops once the Soviet succession seats a Russian chamber", async () => {
    ruElectionsLive.mockResolvedValue(true);
    for (const lowerOfficeType of ["congressDeputy", "dumaDeputy", "supremeSovietDeputy"]) {
      loadRuntimeCountryOffices.mockResolvedValue({ lowerOfficeType });
      await expect(ruUnionCongressLive(db)).resolves.toBe(false);
    }
  });

  it("stays off when RU elections are not live", async () => {
    ruElectionsLive.mockResolvedValue(false);
    await expect(ruUnionCongressLive(db)).resolves.toBe(false);
    expect(loadRuntimeCountryOffices).not.toHaveBeenCalled();
  });

  it("spawns per-region multi-seat races sized from houseDistricts", async () => {
    await ensureRUUnionCongressElections(new Date("2026-10-09T00:00:00Z"), 55);
    expect(ensureRegionalDelegateElections).toHaveBeenCalledTimes(1);
    const [spec, , turn] = ensureRegionalDelegateElections.mock.calls[0];
    expect(turn).toBe(55);
    expect(spec).toMatchObject({
      countryId: "RU",
      electionType: "unionCongressDeputy",
      statusGated: true,
      openPrimaryImmediately: true,
      electionsLiveGate: ruUnionCongressLive,
    });
    expect(
      spec.seatsForRegions([
        { _id: "CEN", houseDistricts: 236 },
        { _id: "SU_UKR", houseDistricts: 404 },
      ])
    ).toEqual({ CEN: 236, SU_UKR: 404 });
  });
});
