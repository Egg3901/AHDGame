import { describe, expect, it, vi } from "vitest";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { hu2014RegionSeats, runHuAssemblyReform } from "./huAssemblyReform";

vi.mock("@/lib/db/runRequiredTransaction", () => ({
  runRequiredTransaction: (body: (session: ClientSession) => Promise<unknown>) =>
    body({ inTransaction: () => true } as ClientSession),
}));
const now = new Date("2026-01-01T00:00:00.000Z");
function setup(options: { approved?: boolean; preset?: string; settled?: boolean } = {}) {
  const db = createInMemoryDb();
  db.seed("gameState", [
    {
      _id: "current",
      preset: options.preset ?? "1991-default",
      ...(options.settled ? { huAssemblyReformedAtYear: 2014 } : {}),
    },
  ]);
  db.seed("countryGameStates", [
    { _id: "HU", ...(options.approved === false ? {} : { huElectoralSystem2011SinceTurn: 1005 }) },
  ]);
  db.seed(
    "states",
    huRegions1991.map((row) => ({ ...row }))
  );
  const capacities = hu2014RegionSeats(huRegions1991);
  db.seed(
    "elections",
    huRegions1991.map((region) => ({
      _id: new ObjectId(),
      state: String(region._id),
      countryId: "HU",
      electionType: "nationalAssembly",
      status: "resolved",
      cycle: 6,
      totalSeats: capacities[String(region._id)],
      hungarianModernAssembly: {
        ruleVersion: "mixed-2011-v1",
        authorizedOnTurn: 1005,
        reason: "parliamentary_decision",
      },
    }))
  );
  db.seed(
    "electedOfficials",
    huRegions1991.map((region) => ({
      _id: new ObjectId(),
      state: String(region._id),
      countryId: "HU",
      officeType: "assemblyDelegate",
      nppId: new ObjectId(),
      seatsHeld: capacities[String(region._id)],
    }))
  );
  db.seed("governmentFormations", [{ _id: "HU", totalSeats: 386, majorityThreshold: 194 }]);
  return { db, capacities };
}
function unchanged(db: ReturnType<typeof createInMemoryDb>) {
  expect(db.collection("states").docs.reduce((sum, row) => sum + row.houseDistricts, 0)).toBe(386);
  expect(db.collection("governmentFormations").docs[0].totalSeats).toBe(386);
  expect(db.collection("gameState").docs[0]).not.toHaveProperty("huAssemblyReformedAtYear");
}
describe("Authorized modern Hungarian Assembly completion", () => {
  it("keeps 386 seats indefinitely when no electoral bill was authorized", async () => {
    const { db } = setup({ approved: false });
    expect(await runHuAssemblyReform(db as unknown as Db, 2030, now)).toBe(false);
    unchanged(db);
  });
  it("waits for the effective date even with approval", async () => {
    const { db } = setup();
    expect(await runHuAssemblyReform(db as unknown as Db, 2011, now)).toBe(false);
    unchanged(db);
  });
  it("records the actual alternate-history handover year without reassigning any deputy", async () => {
    const { db } = setup();
    const mandates = structuredClone(
      db
        .collection("electedOfficials")
        .docs.map((row) => ({ state: row.state, seatsHeld: row.seatsHeld }))
    );
    expect(await runHuAssemblyReform(db as unknown as Db, 2018, now)).toBe(true);
    expect(db.collection("states").docs.reduce((sum, row) => sum + row.houseDistricts, 0)).toBe(
      199
    );
    expect(db.collection("governmentFormations").docs[0]).toMatchObject({
      totalSeats: 199,
      majorityThreshold: 100,
    });
    expect(db.collection("gameState").docs[0].huAssemblyReformedAtYear).toBe(2018);
    expect(
      db
        .collection("electedOfficials")
        .docs.map((row) => ({ state: row.state, seatsHeld: row.seatsHeld }))
    ).toEqual(mandates);
    expect(await runHuAssemblyReform(db as unknown as Db, 2019, now)).toBe(false);
  });
  it.each(["partial", "mixed-cycle", "missing-marker", "wrong-capacity", "unseated"])(
    "rejects a %s handover",
    async (kind) => {
      const { db } = setup();
      const elections = db.collection("elections").docs;
      if (kind === "partial") elections[0].status = "completed";
      if (kind === "mixed-cycle") elections[0].cycle = 7;
      if (kind === "missing-marker") delete elections[0].hungarianModernAssembly;
      if (kind === "wrong-capacity") elections[0].totalSeats++;
      if (kind === "unseated") db.collection("electedOfficials").docs[0].seatsHeld--;
      expect(await runHuAssemblyReform(db as unknown as Db, 2014, now)).toBe(false);
      unchanged(db);
    }
  );
  it("refuses to turn a human into a multi-seat delegation", async () => {
    const { db } = setup();
    db.collection("electedOfficials").docs[0].characterId = new ObjectId();
    expect(await runHuAssemblyReform(db as unknown as Db, 2014, now)).toBe(false);
    unchanged(db);
  });
  it("preserves completed legacy settlements and other eras", async () => {
    const { db: legacy } = setup({ settled: true, approved: false });
    expect(await runHuAssemblyReform(legacy as unknown as Db, 2020, now)).toBe(false);
    const { db } = setup({ preset: "2019-default" });
    expect(await runHuAssemblyReform(db as unknown as Db, 2020, now)).toBe(false);
    unchanged(db);
  });
});
