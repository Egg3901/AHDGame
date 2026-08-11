import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { NATIONAL_GEOGRAPHY_SENTINEL, spendPoliticalStrength } from "./spendPoliticalStrength";
import {
  PRESSURE_LADDER_INCREMENT,
  PRESSURE_LADDER_MAX_VALUE,
} from "@/lib/turn/politicalStrength/strengthConstants";

interface FakeStateRow {
  _id: string;
  countryId: "US";
  stateId: string;
  partyId: string;
  politicalStrength: number;
}

interface FakeNationalRow {
  _id: ObjectId;
  countryId: "US";
  sequentialId: number;
  politicalStrength: number;
}

interface FakePressureRow {
  _id: string;
  countryId: "US";
  partyId: string;
  stateId: string;
  value: number;
  lastUpdatedTurn: number;
}

interface FakeLedgerRow {
  partyId: string;
  stateId?: string;
  source: string;
  delta: number;
  action?: string;
  geography?: string;
}

function makeFakeDb({
  stateRows = [],
  nationalRows = [],
  pressureRows = [],
}: {
  stateRows?: FakeStateRow[];
  nationalRows?: FakeNationalRow[];
  pressureRows?: FakePressureRow[];
}) {
  const ledger: FakeLedgerRow[] = [];
  return {
    stateRows,
    nationalRows,
    pressureRows,
    ledger,
    collection<T>(name: string) {
      if (name === "statePartyOrg") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            stateRows.find(
              (r) =>
                r.countryId === filter.countryId &&
                r.partyId === filter.partyId &&
                r.stateId === filter.stateId
            ) ?? null,
          findOneAndUpdate: async (
            filter: Record<string, unknown>,
            update: { $inc: { politicalStrength: number } }
          ) => {
            const row = stateRows.find(
              (r) =>
                r.countryId === filter.countryId &&
                r.partyId === filter.partyId &&
                r.stateId === filter.stateId
            );
            if (!row) return null;
            const cond = (filter.politicalStrength as { $gte: number }).$gte;
            if (row.politicalStrength < cond) return null;
            row.politicalStrength += update.$inc.politicalStrength;
            return row;
          },
        } as unknown as ReturnType<T extends never ? never : never>;
      }
      if (name === "politicalParties") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            nationalRows.find(
              (r) => r.countryId === filter.countryId && r.sequentialId === filter.sequentialId
            ) ?? null,
          findOneAndUpdate: async (
            filter: Record<string, unknown>,
            update: { $inc: { politicalStrength: number } }
          ) => {
            const row = nationalRows.find(
              (r) => r.countryId === filter.countryId && r.sequentialId === filter.sequentialId
            );
            if (!row) return null;
            const cond = (filter.politicalStrength as { $gte: number }).$gte;
            if (row.politicalStrength < cond) return null;
            row.politicalStrength += update.$inc.politicalStrength;
            return row;
          },
        } as unknown as ReturnType<T extends never ? never : never>;
      }
      if (name === "partyStrengthPressure") {
        return {
          findOne: async (filter: Record<string, unknown>) =>
            pressureRows.find((r) => r._id === filter._id) ?? null,
          updateOne: async (
            filter: { _id: string },
            update: {
              $set?: { value?: number; lastUpdatedTurn: number };
              $setOnInsert?: Partial<FakePressureRow>;
            }
          ) => {
            const idx = pressureRows.findIndex((r) => r._id === filter._id);
            if (idx >= 0) {
              const cur = pressureRows[idx];
              pressureRows[idx] = {
                ...cur,
                value: update.$set?.value ?? cur.value,
                lastUpdatedTurn: update.$set?.lastUpdatedTurn ?? cur.lastUpdatedTurn,
              };
            } else {
              pressureRows.push({
                _id: filter._id,
                value: update.$set?.value ?? 0,
                lastUpdatedTurn: update.$set?.lastUpdatedTurn ?? 0,
                countryId: (update.$setOnInsert?.countryId ?? "US") as "US",
                partyId: update.$setOnInsert?.partyId ?? "",
                stateId: update.$setOnInsert?.stateId ?? "",
              });
            }
            return { modifiedCount: 1 };
          },
        } as unknown as ReturnType<T extends never ? never : never>;
      }
      if (name === "partyPoliticalStrengthLedger") {
        return {
          insertOne: async (row: FakeLedgerRow) => {
            ledger.push(row);
            return { insertedId: new ObjectId() };
          },
        } as unknown as ReturnType<T extends never ? never : never>;
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
}

describe("spendPoliticalStrength — state scope", () => {
  it("debits PS, increments pressure, writes ledger row", async () => {
    const db = makeFakeDb({
      stateRows: [
        { _id: "US_dem_CA", countryId: "US", partyId: "1", stateId: "CA", politicalStrength: 20 },
      ],
    });
    const result = await spendPoliticalStrength(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateId: "CA",
        baseCost: 5,
        action: "org-building",
        now: new Date(),
        turn: 100,
      },
      db as unknown as never
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectiveCost).toBe(5); // no prior pressure
    expect(result.newPoliticalStrength).toBe(15);
    expect(result.newPressure).toBe(PRESSURE_LADDER_INCREMENT);
    expect(db.pressureRows.length).toBe(1);
    expect(db.ledger.length).toBe(1);
    expect(db.ledger[0].source).toBe("spend");
  });

  it("escalates effective cost via pressure ladder on repeat", async () => {
    const db = makeFakeDb({
      stateRows: [
        { _id: "x", countryId: "US", partyId: "1", stateId: "CA", politicalStrength: 50 },
      ],
      pressureRows: [
        {
          _id: "US_1_CA",
          countryId: "US",
          partyId: "1",
          stateId: "CA",
          value: 3,
          lastUpdatedTurn: 99,
        },
      ],
    });
    const result = await spendPoliticalStrength(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateId: "CA",
        baseCost: 2,
        action: "contest",
        now: new Date(),
        turn: 100,
      },
      db as unknown as never
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effectiveCost).toBe(2 + 3); // base + pressure
    expect(result.newPressure).toBe(4);
  });

  it("clamps stored pressure at PRESSURE_LADDER_MAX_VALUE (ticket #945 runaway)", async () => {
    const db = makeFakeDb({
      stateRows: [
        { _id: "x", countryId: "US", partyId: "3", stateId: "FL", politicalStrength: 50 },
      ],
      pressureRows: [
        {
          _id: "US_3_FL",
          countryId: "US",
          partyId: "3",
          stateId: "FL",
          value: PRESSURE_LADDER_MAX_VALUE, // already at the ceiling
          lastUpdatedTurn: 99,
        },
      ],
    });
    const result = await spendPoliticalStrength(
      {
        countryId: "US",
        partyId: "3",
        scope: "state",
        stateId: "FL",
        baseCost: 1,
        action: "build-org",
        now: new Date(),
        turn: 100,
      },
      db as unknown as never
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pressure does not climb past the ceiling, so it can decay back down within
    // a few turns instead of staying pinned at max cost for dozens of turns.
    expect(result.newPressure).toBe(PRESSURE_LADDER_MAX_VALUE);
    expect(db.pressureRows[0].value).toBe(PRESSURE_LADDER_MAX_VALUE);
  });

  it("returns insufficient-ps when reserve too low", async () => {
    const db = makeFakeDb({
      stateRows: [{ _id: "x", countryId: "US", partyId: "1", stateId: "CA", politicalStrength: 1 }],
    });
    const result = await spendPoliticalStrength(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateId: "CA",
        baseCost: 5,
        action: "contest",
        now: new Date(),
        turn: 100,
      },
      db as unknown as never
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("insufficient-ps");
    expect(result.currentPoliticalStrength).toBe(1);
  });

  it("returns missing-row when party has no row in this state", async () => {
    const db = makeFakeDb({});
    const result = await spendPoliticalStrength(
      {
        countryId: "US",
        partyId: "1",
        scope: "state",
        stateId: "CA",
        baseCost: 5,
        action: "contest",
        now: new Date(),
        turn: 100,
      },
      db as unknown as never
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-row");
  });
});

describe("spendPoliticalStrength — national-targeted scope", () => {
  it("debits national PS, escalates per-state pressure", async () => {
    const db = makeFakeDb({
      nationalRows: [
        { _id: new ObjectId(), countryId: "US", sequentialId: 1, politicalStrength: 100 },
      ],
    });
    const result = await spendPoliticalStrength(
      {
        countryId: "US",
        partyId: "1",
        scope: "national-targeted",
        stateId: "AZ",
        baseCost: 4,
        action: "endorse",
        now: new Date(),
        turn: 100,
      },
      db as unknown as never
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newPoliticalStrength).toBe(96);
    expect(result.effectiveCost).toBe(4);
    expect(db.pressureRows[0].stateId).toBe("AZ");
  });
});

describe("spendPoliticalStrength — pure national scope", () => {
  it("uses sentinel geography key", async () => {
    const db = makeFakeDb({
      nationalRows: [
        { _id: new ObjectId(), countryId: "US", sequentialId: 1, politicalStrength: 50 },
      ],
    });
    const result = await spendPoliticalStrength(
      {
        countryId: "US",
        partyId: "1",
        scope: "national",
        stateId: "anything-ignored",
        baseCost: 3,
        action: "national-rally",
        now: new Date(),
        turn: 100,
      },
      db as unknown as never
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.pressureRows[0].stateId).toBe(NATIONAL_GEOGRAPHY_SENTINEL);
    expect(db.ledger[0].stateId).toBeUndefined();
  });
});
