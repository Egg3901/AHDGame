import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { verifyCommandEconomySeed } from "./verifyCommandEconomySeed";

const PRESET = "1953-default";
const RU_PRIMARY = "700000000000000000000081";

/**
 * Drives the four reads the verifier makes: states, SOE corporations,
 * corporateSectors, and the primary national corporation.
 */
function wire(
  db: MockDb,
  opts: {
    commandEconomyEnabled?: boolean;
    states: Array<{ countryId: string }>;
    soes: Array<{ soe: { sector: string } }>;
    sectors: Array<{ corporationId: string }>;
    primaryCorpId?: string | null;
  }
) {
  db.collection("gameConfig").findOne.mockResolvedValue(
    opts.commandEconomyEnabled === false
      ? { commandEconomyEnabled: false }
      : { commandEconomyEnabled: true }
  );
  db.collection("states").find().toArray.mockResolvedValue(opts.states);
  db.collection("corporateSectors").find().toArray.mockResolvedValue(opts.sectors);

  const corps = db.collection("corporations");
  corps.find().toArray.mockResolvedValue(opts.soes);
  corps.findOne.mockResolvedValue(
    opts.primaryCorpId === null ? null : { _id: opts.primaryCorpId ?? RU_PRIMARY }
  );
}

/** 17 healthy SOEs for the Eastern-bloc full stack. */
function fullSoeStack(sectors: string[]) {
  return sectors.map((sector) => ({ soe: { sector } }));
}

describe("verifyCommandEconomySeed", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("does not check anything when the flag is off", async () => {
    wire(db, {
      commandEconomyEnabled: false,
      states: [{ countryId: "RU" }],
      soes: [],
      sectors: [],
    });
    const report = await verifyCommandEconomySeed(db as unknown as Db, PRESET);
    expect(report).toMatchObject({ checked: false, issues: [], fatal: [] });
  });

  it("flags the live USSR failure: zero SOEs and zero producing sectors", async () => {
    wire(db, { states: [{ countryId: "RU" }], soes: [], sectors: [] });
    const report = await verifyCommandEconomySeed(db as unknown as Db, PRESET);

    expect(report.checked).toBe(true);
    expect(report.fatal).toContain("RU");
    expect(report.issues.join(" ")).toContain("ZERO producing sectors");
    expect(report.issues.join(" ")).toContain("ZERO state enterprises");
  });

  it("flags the legacy shape: sectors hanging off the sovereign issuer", async () => {
    wire(db, {
      states: [{ countryId: "RU" }],
      soes: [],
      // The exact live shape: 238 sectors, all on the primary corp.
      sectors: Array.from({ length: 238 }, () => ({ corporationId: RU_PRIMARY })),
      primaryCorpId: RU_PRIMARY,
    });
    const report = await verifyCommandEconomySeed(db as unknown as Db, PRESET);

    expect(report.fatal).toContain("RU");
    const joined = report.issues.join(" ");
    expect(joined).toContain("238 producing sector(s) hang off the sovereign issuer");
    expect(joined).toContain("ZERO state enterprises");
  });

  it("passes a correctly split command country", async () => {
    const ruReport = await (async () => {
      const { commandEconomySoeSectors } = await import("@/lib/constants/commandEconomy");
      const expected = commandEconomySoeSectors("RU");
      wire(db, {
        states: [{ countryId: "RU" }],
        soes: fullSoeStack([...expected]),
        sectors: Array.from({ length: 238 }, () => ({ corporationId: "soe-owned" })),
        primaryCorpId: RU_PRIMARY,
      });
      return verifyCommandEconomySeed(db as unknown as Db, PRESET);
    })();

    expect(ruReport.checked).toBe(true);
    expect(ruReport.issues).toEqual([]);
    expect(ruReport.fatal).toEqual([]);
  });

  it("reports a partial split without calling it fatal", async () => {
    const { commandEconomySoeSectors } = await import("@/lib/constants/commandEconomy");
    const expected = [...commandEconomySoeSectors("RU")];
    wire(db, {
      states: [{ countryId: "RU" }],
      soes: fullSoeStack(expected.slice(0, expected.length - 2)),
      sectors: Array.from({ length: 200 }, () => ({ corporationId: "soe-owned" })),
      primaryCorpId: RU_PRIMARY,
    });
    const report = await verifyCommandEconomySeed(db as unknown as Db, PRESET);

    expect(report.fatal).toEqual([]);
    expect(report.issues.join(" ")).toContain("missing 2 of");
  });

  it("ignores countries with no regions in this world", async () => {
    wire(db, { states: [{ countryId: "US" }], soes: [], sectors: [] });
    const report = await verifyCommandEconomySeed(db as unknown as Db, PRESET);
    expect(report.countries).toEqual([]);
    expect(report.fatal).toEqual([]);
  });
});
