import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";

vi.mock("@/lib/turn/perpetualElections", () => ({
  ensureIEElections: vi.fn(),
  ensureIELocalCouncilElections: vi.fn(),
  ensureIECathaoirleachElections: vi.fn(),
  ensureDEElections: vi.fn(),
}));
vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  updateParliamentaryGovernmentSeats: vi.fn(),
}));

const { reseedJoinedRegionElections } = await import("./reseedJoinedRegionElections");
const perpetual = await import("@/lib/turn/perpetualElections");
const parl = await import("@/lib/turn/parliamentaryGovernment");

describe("reseedJoinedRegionElections", () => {
  beforeEach(() => vi.clearAllMocks());
  const db = {} as unknown as Db;
  const now = new Date();

  it("seeds the IE Dáil/council/cathaoirleach races + settles the chamber for an IE join", async () => {
    await reseedJoinedRegionElections(db, "IE", now);
    expect(perpetual.ensureIEElections).toHaveBeenCalledWith(now);
    expect(perpetual.ensureIELocalCouncilElections).toHaveBeenCalledWith(now);
    expect(perpetual.ensureIECathaoirleachElections).toHaveBeenCalledWith(now);
    expect(parl.updateParliamentaryGovernmentSeats).toHaveBeenCalledWith(db, "IE");
  });

  it("re-seeds Bundestag races and resizes the chamber when a region joins Germany", async () => {
    await reseedJoinedRegionElections(db, "DE", now);
    expect(perpetual.ensureDEElections).toHaveBeenCalledWith(now);
    expect(parl.updateParliamentaryGovernmentSeats).toHaveBeenCalledWith(db, "DE");
    // Ireland's spawners are not Germany's.
    expect(perpetual.ensureIEElections).not.toHaveBeenCalled();
  });

  it("no-ops for a country with no registered spawners", async () => {
    await reseedJoinedRegionElections(db, "US", now);
    expect(perpetual.ensureIEElections).not.toHaveBeenCalled();
    expect(perpetual.ensureDEElections).not.toHaveBeenCalled();
    expect(parl.updateParliamentaryGovernmentSeats).not.toHaveBeenCalled();
  });
});
