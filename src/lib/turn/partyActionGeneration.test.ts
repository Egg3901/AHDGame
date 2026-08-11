import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { computePartyPsGain } from "./partyActionGeneration";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  NATIONAL_PASSIVE_PS_PER_TURN,
  STATE_PASSIVE_PS_PER_TURN,
  PS_INVESTMENT_MAX_TIERS,
  psInvestmentRate,
} from "./politicalStrength/strengthConstants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursorOf<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

const NAT = psInvestmentRate("US", "national"); // 5% of the legacy £250k → £12,500
const STATE = psInvestmentRate("US", "state"); // half national → £6,250

describe("computePartyPsGain — flat passive (treasury-independent)", () => {
  it("pays the national flat passive even at treasury 0", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 280,
      treasury: 0,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 1_000_000,
      psInvestmentRatePerPs: NAT,
    });
    expect(r.passive).toBe(NATIONAL_PASSIVE_PS_PER_TURN); // 20
    expect(r.investment).toBe(0); // no treasury to spend
    expect(r.investmentDebit).toBe(0);
    expect(r.clampedTo).toBe(NATIONAL_PASSIVE_PS_PER_TURN);
  });

  it("pays the state flat passive even at treasury 0", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 30,
      treasury: 0,
      passivePerTurn: STATE_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 0,
      psInvestmentRatePerPs: STATE,
    });
    expect(r.passive).toBe(STATE_PASSIVE_PS_PER_TURN); // 5
    expect(r.investment).toBe(0);
  });

  it("has no phantom / % -of-treasury stream — idle treasury yields only passive", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 280,
      treasury: 100_000_000, // huge idle treasury, no budget set
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 0,
      psInvestmentRatePerPs: NAT,
    });
    // The whole gain is the flat passive; nothing scales with treasury.
    expect(r.total).toBe(NATIONAL_PASSIVE_PS_PER_TURN);
    expect(r.clampedTo).toBe(NATIONAL_PASSIVE_PS_PER_TURN);
  });
});

describe("computePartyPsGain — explicit investment (5% rate, +20 cap)", () => {
  it("converts at the new national rate (5% of the legacy £/+1 PS)", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 280,
      treasury: 5_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: NAT * 2, // exactly +2 PS
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBeCloseTo(2);
    expect(r.investmentDebit).toBeCloseTo(NAT * 2);
  });

  it("state rate is half the national rate", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 30,
      treasury: 5_000_000,
      passivePerTurn: STATE_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: STATE * 2,
      psInvestmentRatePerPs: STATE,
    });
    expect(r.investment).toBeCloseTo(2);
    expect(r.investmentDebit).toBeCloseTo(STATE * 2);
  });

  it("caps explicit investment gain at PS_INVESTMENT_MAX_TIERS (+20)", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 280,
      treasury: 100_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 100_000_000, // way beyond the +20 cap
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBeCloseTo(PS_INVESTMENT_MAX_TIERS); // 20
    // Debit only what was actually converted, not the full budget.
    expect(r.investmentDebit).toBeCloseTo(PS_INVESTMENT_MAX_TIERS * NAT);
  });

  it("self-throttles when treasury cannot cover the budget — proportional PS", () => {
    // Budget 4×NAT, treasury only 1×NAT → spend 1×NAT, get 1 PS.
    const r = computePartyPsGain({
      current: 0,
      cap: 280,
      treasury: NAT,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: NAT * 4,
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBeCloseTo(1);
    expect(r.investmentDebit).toBeCloseTo(NAT);
  });

  it("does nothing extra when budget = 0", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 280,
      treasury: 1_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 0,
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBe(0);
    expect(r.investmentDebit).toBe(0);
  });
});

describe("computePartyPsGain — spend stream (full rate up to the hard cap)", () => {
  it("converts at the full rate regardless of how full the reserve is", () => {
    // 60% of cap — well clear of the cap, so the full +20 is bought (no soft-cap
    // band throttle since the 2026-06-28 removal).
    const r = computePartyPsGain({
      current: 168, // 60% of US national cap 280
      cap: 280,
      treasury: 50_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: NAT * 20, // budgeted for the full +20
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBeCloseTo(20);
    expect(r.investmentDebit).toBeCloseTo(20 * NAT);
  });

  it("buys only the PS that fits below the cap and debits only for that (no over-charge)", () => {
    // current 255 + passive 20 = 275, leaving 5 of headroom for spend. The chair
    // budgeted for +20 but only 5 fit, so only 5 are bought AND charged.
    const r = computePartyPsGain({
      current: 255,
      cap: 280,
      treasury: 50_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: NAT * 20,
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBeCloseTo(5);
    expect(r.investmentDebit).toBeCloseTo(5 * NAT);
    expect(r.clampedTo).toBe(280);
    expect(r.total).toBe(25); // 20 passive + 5 spend
  });

  it("buys and charges nothing when passive alone reaches the cap", () => {
    // current 270 + passive 20 would overshoot; passive is clamped to the cap and
    // the spend stream sees zero headroom, so the treasury is NOT drained.
    const r = computePartyPsGain({
      current: 270,
      cap: 280,
      treasury: 50_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: NAT * 20,
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBe(0);
    expect(r.investmentDebit).toBe(0);
    expect(r.clampedTo).toBe(280);
    expect(r.total).toBe(10); // passive clamped from 20 → 10
  });

  it("zero spend gain AND debit at hard cap; passive clamped out too", () => {
    const r = computePartyPsGain({
      current: 280,
      cap: 280,
      treasury: 5_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 1_000_000,
      psInvestmentRatePerPs: NAT,
    });
    expect(r.investment).toBe(0);
    expect(r.investmentDebit).toBe(0);
    // Already at cap → flat passive cannot push above it.
    expect(r.clampedTo).toBe(280);
    expect(r.total).toBe(0);
  });
});

describe("computePartyPsGain — clamping & cap edge cases", () => {
  it("clamps the resulting reserve to cap (passive included)", () => {
    const r = computePartyPsGain({
      current: 99,
      cap: 100,
      treasury: 1_000_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 0,
      psInvestmentRatePerPs: NAT,
    });
    // 99 + 20 passive → clamped to 100.
    expect(r.clampedTo).toBe(100);
    expect(r.total).toBe(1);
  });

  it("zero cap is a degenerate no-gain guard", () => {
    const r = computePartyPsGain({
      current: 0,
      cap: 0,
      treasury: 100_000,
      passivePerTurn: NATIONAL_PASSIVE_PS_PER_TURN,
      psInvestmentBudget: 0,
      psInvestmentRatePerPs: NAT,
    });
    expect(r.total).toBe(0);
    expect(r.clampedTo).toBe(0);
  });
});

describe("PS generation algorithm matches design constants", () => {
  it("PS investment state rate is half of national rate across countries", () => {
    for (const country of ["US", "UK", "DE", "JP"] as const) {
      expect(psInvestmentRate(country, "state")).toBe(psInvestmentRate(country, "national") / 2);
    }
  });

  it("PS investment rate is 5% of the legacy per-country rate", () => {
    // Legacy UK national £200,000 → £10,000; US £250,000 → £12,500.
    expect(psInvestmentRate("UK", "national")).toBeCloseTo(10_000);
    expect(psInvestmentRate("US", "national")).toBeCloseTo(12_500);
  });
});

describe("processPartyActionGeneration — NPP-only state PS cap clamp-down", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("clamps NPP-only over-cap rows to 7.5, drains broke ones too, and lets player-member rows grow", async () => {
    // National loop: no parties.
    db.collection("politicalParties").find.mockReturnValue(cursorOf([]));

    // One homed player character for CA_9 only. No users-find mock → the user
    // doc is "missing", which the activity helper treats as active.
    db.collection("characters").find.mockReturnValue(
      cursorOf([{ homeState: "CA", party: "9", userId: new ObjectId() }])
    );

    // Three state-party rows for party 9.
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([
        // NPP-only, over cap, funded -> clamp to 7.5
        {
          _id: "TX_9",
          countryId: "US",
          stateId: "TX",
          partyId: "9",
          politicalStrength: 30,
          treasury: 1_000_000,
        },
        // NPP-only, over 7.5, broke -> still clamp to 7.5
        {
          _id: "NY_9",
          countryId: "US",
          stateId: "NY",
          partyId: "9",
          politicalStrength: 20,
          treasury: 0,
        },
        // Player member, below full cap -> grows normally
        {
          _id: "CA_9",
          countryId: "US",
          stateId: "CA",
          partyId: "9",
          politicalStrength: 5,
          treasury: 1_000_000,
        },
      ])
    );

    const { processPartyActionGeneration } = await import("./partyActionGeneration");
    await processPartyActionGeneration(new Date("2026-06-10T00:00:00Z"), db as unknown as Db, 100);

    const spUpdates = db.collectionMocks.statePartyOrg!.updateOne.mock.calls;
    const findUpdate = (id: string) => spUpdates.find((c) => (c[0] as { _id: string })._id === id);
    const setOf = (call: unknown[] | undefined) =>
      (call?.[1] as { $set: { politicalStrength: number } }).$set;

    // TX clamped to 7.5
    const tx = findUpdate("TX_9");
    expect(tx).toBeDefined();
    expect(setOf(tx).politicalStrength).toBeCloseTo(7.5);

    // NY clamped to 7.5 despite treasury 0
    const ny = findUpdate("NY_9");
    expect(ny).toBeDefined();
    expect(setOf(ny).politicalStrength).toBeCloseTo(7.5);

    // CA grew above its starting 5 (not clamped — full cap 30)
    const ca = findUpdate("CA_9");
    expect(ca).toBeDefined();
    expect(setOf(ca).politicalStrength).toBeGreaterThan(5);

    // Ledger has decay/npp_cap_clamp rows for the two clamped states.
    const ledgerCalls = db.collectionMocks.partyPoliticalStrengthLedger!.insertMany.mock.calls;
    const rows = ledgerCalls.flatMap((c) => c[0] as Record<string, unknown>[]);
    const clampRows = rows.filter((r) => r.source === "decay" && r.action === "npp_cap_clamp");
    expect(clampRows.map((r) => r.stateId).sort()).toEqual(["NY", "TX"]);
    const txClamp = clampRows.find((r) => r.stateId === "TX")!;
    expect(txClamp.value).toBeCloseTo(7.5);
    expect(txClamp.delta).toBeCloseTo(7.5 - 30);
  });

  it("excludes inactive homed players from the state PS player-member check", async () => {
    const now = new Date("2026-06-10T00:00:00Z");
    const TURN_MS = 60 * 60 * 1000;
    const inactiveUserId = new ObjectId();

    db.collection("politicalParties").find.mockReturnValue(cursorOf([]));

    // One homed player for MO_9 — but their user has been inactive for 200 turns.
    db.collection("characters").find.mockReturnValue(
      cursorOf([{ homeState: "MO", party: "9", userId: inactiveUserId }])
    );
    db.collection("users").find.mockReturnValue(
      cursorOf([{ _id: inactiveUserId, lastActivity: new Date(now.getTime() - 200 * TURN_MS) }])
    );

    // MO_9 sits at the full cap with treasury — only the inactive player keeps it
    // from being NPP-only. With the player excluded, it must clamp to 7.5.
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([
        {
          _id: "MO_9",
          countryId: "US",
          stateId: "MO",
          partyId: "9",
          politicalStrength: 30,
          treasury: 1_000_000,
        },
      ])
    );

    const { processPartyActionGeneration } = await import("./partyActionGeneration");
    await processPartyActionGeneration(now, db as unknown as Db, 100);

    const spUpdates = db.collectionMocks.statePartyOrg!.updateOne.mock.calls;
    const mo = spUpdates.find((c) => (c[0] as { _id: string })._id === "MO_9");
    expect(mo).toBeDefined();
    expect((mo?.[1] as { $set: { politicalStrength: number } }).$set.politicalStrength).toBeCloseTo(
      7.5
    );
  });
});

describe("processPartyActionGeneration — NPP Action Points regen", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  type ApOp = {
    updateOne: { filter: { _id: unknown }; update: { $set: { nppActionPoints: number } } };
  };
  const apSetFor = (calls: unknown[][], match: (id: unknown) => boolean): number | undefined => {
    for (const call of calls) {
      const ops = call[0] as ApOp[];
      const op = ops.find((o) => match(o.updateOne.filter._id));
      if (op) return op.updateOne.update.$set.nppActionPoints;
    }
    return undefined;
  };

  it("banks national AP up to the tier cap and heals undefined balances to full", async () => {
    const majorId = new ObjectId();
    const minorId = new ObjectId();
    db.collection("politicalParties").find.mockReturnValue(
      cursorOf([
        {
          _id: majorId,
          sequentialId: 1,
          countryId: "US",
          tier: "major",
          politicalStrength: 10,
          treasury: 0,
          nppActionPoints: 150, // 150 + 16 → clamp 160
        },
        {
          _id: minorId,
          sequentialId: 2,
          countryId: "US",
          tier: "minor",
          politicalStrength: 10,
          treasury: 0,
          // nppActionPoints undefined → heal to minor cap (80)
        },
      ])
    );
    db.collection("characters").find.mockReturnValue(cursorOf([]));
    db.collection("statePartyOrg").find.mockReturnValue(cursorOf([]));

    const { processPartyActionGeneration } = await import("./partyActionGeneration");
    await processPartyActionGeneration(new Date("2026-06-10T00:00:00Z"), db as unknown as Db, 100);

    const calls = db.collectionMocks.politicalParties!.bulkWrite.mock.calls;
    expect(apSetFor(calls, (id) => (id as ObjectId).equals(majorId))).toBe(160);
    expect(apSetFor(calls, (id) => (id as ObjectId).equals(minorId))).toBe(80);
  });

  it("regenerates state-party AP using the owning party's tier", async () => {
    db.collection("politicalParties").find.mockReturnValue(
      cursorOf([
        {
          _id: new ObjectId(),
          sequentialId: 1,
          countryId: "US",
          tier: "major",
          politicalStrength: 10,
          treasury: 0,
          nppActionPoints: 160,
        },
      ])
    );
    db.collection("characters").find.mockReturnValue(cursorOf([]));
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([
        {
          _id: "TX_1",
          countryId: "US",
          stateId: "TX",
          partyId: "1", // owning party sequentialId 1 → major → state cap 40, regen 4
          politicalStrength: 5,
          treasury: 0,
          nppActionPoints: 38, // 38 + 4 → clamp 40
        },
      ])
    );

    const { processPartyActionGeneration } = await import("./partyActionGeneration");
    await processPartyActionGeneration(new Date("2026-06-10T00:00:00Z"), db as unknown as Db, 100);

    const calls = db.collectionMocks.statePartyOrg!.bulkWrite.mock.calls;
    expect(apSetFor(calls, (id) => id === "TX_1")).toBe(40);
  });

  it("scopes the owning party's tier by country (sequentialId collides across countries)", async () => {
    // `sequentialId` is unique per country, not globally: UK party 8 is Major
    // while BR party 8 is Minor. A country-blind tier lookup lets whichever row
    // is iterated last decide both parties' AP economy.
    db.collection("politicalParties").find.mockReturnValue(
      cursorOf([
        {
          _id: new ObjectId(),
          sequentialId: 8,
          countryId: "UK",
          tier: "major",
          politicalStrength: 10,
          treasury: 0,
          nppActionPoints: 160,
        },
        {
          _id: new ObjectId(),
          sequentialId: 8,
          countryId: "BR",
          tier: "minor",
          politicalStrength: 10,
          treasury: 0,
          nppActionPoints: 80,
        },
      ])
    );
    db.collection("characters").find.mockReturnValue(cursorOf([]));
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([
        {
          _id: "NIR_8",
          countryId: "UK",
          stateId: "NIR",
          partyId: "8", // UK party 8 → major → regen 4
          politicalStrength: 5,
          treasury: 0,
          nppActionPoints: 9,
        },
        {
          _id: "SP_8",
          countryId: "BR",
          stateId: "SP",
          partyId: "8", // BR party 8 → minor → regen 3
          politicalStrength: 5,
          treasury: 0,
          nppActionPoints: 9,
        },
      ])
    );

    const { processPartyActionGeneration } = await import("./partyActionGeneration");
    await processPartyActionGeneration(new Date("2026-06-10T00:00:00Z"), db as unknown as Db, 100);

    const calls = db.collectionMocks.statePartyOrg!.bulkWrite.mock.calls;
    expect(apSetFor(calls, (id) => id === "NIR_8")).toBe(13); // 9 + 4 (major)
    expect(apSetFor(calls, (id) => id === "SP_8")).toBe(12); // 9 + 3 (minor)
  });
});
